import * as api from "../api.js";
import { render, spinner, alert as alertHtml, escHtml, fmtDate, fmtBytes, bindConfirm, orgContextBadge } from "../ui.js";

// Retention policies: rules that remove old versions to save storage. One org default
// ("*") and per-collection policies that replace it. A document's current version and
// every labeled version are always kept. Org owners and admins only.

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Plain-language list of a policy's rules ([] = keeps everything). */
function describeRules(p) {
  return [
    p.labeledOnly ? "Keep only labeled versions" : "",
    p.maxVersions != null ? `Keep the newest ${p.maxVersions} versions` : "",
    p.maxAgeDays != null ? `Remove versions older than ${plural(p.maxAgeDays, "day")}` : "",
    p.afterLabel ? `Remove versions older than the version labeled “${p.afterLabel}”` : "",
  ].filter(Boolean);
}

function rulesHtml(p, emptyText) {
  const rules = describeRules(p);
  return rules.length ? rules.map(escHtml).join("<br>") : `<span class="muted">${emptyText}</span>`;
}

function summary(r, verb) {
  const t = r.total;
  if (!t.versions) return verb === "would" ? "Nothing would be removed right now." : "Nothing to remove: no version matches a rule.";
  return `${verb === "would" ? "Would remove" : "Removed"} ${plural(t.versions, "version")} in ${plural(t.documents, "document")}, freeing ${fmtBytes(t.bytes)}.`;
}

export async function mountRetention(el, currentUser, orgInfo) {
  let editing = null; // { target: "*" | collection name | "" (new), policy }
  let data, collections, members;
  await load();

  async function load(notice = "") {
    render(el, spinner());
    try {
      [data, collections, members] = await Promise.all([
        api.getRetention(),
        api.listCollections().catch(() => []),
        api.listMembers().catch(() => []),
      ]);
      renderPage(notice);
    } catch (err) {
      if (err.status === 403) {
        render(el, `
          <div class="page">
            <div class="page-header"><h1 class="page-title">Retention</h1></div>
            <div class="callout callout--warn">
              <strong>Access restricted.</strong> Retention policies can only be managed by the org owner or admin members.
            </div>
          </div>`);
      } else {
        render(el, alertHtml(err.message));
      }
    }
  }

  // Who saved a policy or triggered a run (a user id, or "schedule")
  function who(id) {
    if (id === "schedule") return "Hourly schedule";
    if (id === currentUser?.id) return currentUser.name || currentUser.email;
    const m = members.find(m => m.userId === id);
    return m ? (m.name || m.email) : id;
  }

  function renderPage(notice) {
    const d = data.default;
    render(el, `
      <div class="page">
        <div class="page-header">
          <div>
            <h1 class="page-title">Retention</h1>
            ${orgContextBadge(orgInfo)}
          </div>
          <button class="btn" id="apply-btn" ${d || data.collections.length ? "" : "disabled"}>Apply now</button>
        </div>
        <p class="muted" style="margin-bottom:1rem">
          Retention policies remove old versions to save storage. They run every hour. Removed versions can't be restored.
        </p>
        <div class="callout callout--info" id="always-kept">
          <strong>Always kept:</strong> a document's current version and every version a label points to are never removed, whatever the rules say.
        </div>
        <div id="retention-notice">${alertHtml(notice, "success")}</div>
        <div id="retention-error"></div>
        <div id="editor"></div>

        <div class="card" id="default-card">
          <div class="card-header">
            Org default <span class="muted" style="font-weight:400">applies to every collection without a policy of its own</span>
          </div>
          <div class="card-body row-actions" style="justify-content:space-between">
            <div id="default-rules">${d ? rulesHtml(d, "Keeps everything") : `<span class="muted">No default: every version is kept.</span>`}</div>
            <div class="row-actions">
              <button class="btn btn-sm" data-edit="*">${d ? "Edit" : "Set a default"}</button>
              ${d ? `<button class="btn btn-sm confirm-btn" data-remove="*" data-confirm="Remove the default?">Remove</button>` : ""}
            </div>
          </div>
        </div>

        <div class="card" id="collections-card">
          <div class="card-header" style="justify-content:space-between">
            <span>Collection policies</span>
            <button class="btn btn-sm btn-primary" id="add-policy-btn">Add collection policy</button>
          </div>
          ${data.collections.length === 0
            ? `<div class="card-body"><div class="empty-state">No collection has a policy of its own; they all follow the org default.</div></div>`
            : `<table class="table">
                <thead><tr><th>Collection</th><th>Rules</th><th>Updated</th><th></th></tr></thead>
                <tbody>
                  ${data.collections.map(p => `
                    <tr data-collection="${escHtml(p.collection)}">
                      <td><strong>${escHtml(p.collection)}</strong></td>
                      <td>${rulesHtml(p, "Exempt: keeps everything")}</td>
                      <td class="muted">${fmtDate(p.updatedAt)}<br>${escHtml(who(p.updatedBy))}</td>
                      <td class="row-actions">
                        <button class="btn btn-sm" data-edit="${escHtml(p.collection)}">Edit</button>
                        <button class="btn btn-sm confirm-btn" data-remove="${escHtml(p.collection)}" data-confirm="Remove?">Remove</button>
                      </td>
                    </tr>`).join("")}
                </tbody>
              </table>`}
        </div>

        <div class="card" id="runs-card">
          <div class="card-header">Recent runs</div>
          ${data.runs.length === 0
            ? `<div class="card-body"><div class="empty-state">No versions have been removed yet.</div></div>`
            : `<table class="table">
                <thead><tr><th>When</th><th>Collection</th><th>Versions removed</th><th>Freed</th><th>Triggered by</th></tr></thead>
                <tbody>
                  ${data.runs.map(r => `
                    <tr>
                      <td class="muted">${fmtDate(r.ranAt)}</td>
                      <td>${escHtml(r.collection)}</td>
                      <td>${r.versionsRemoved}</td>
                      <td>${fmtBytes(r.bytesFreed)}</td>
                      <td class="muted">${escHtml(who(r.triggeredBy))}</td>
                    </tr>`).join("")}
                </tbody>
              </table>`}
        </div>
      </div>`);

    const errEl = el.querySelector("#retention-error");
    const policyOf = target => target === "*" ? data.default : data.collections.find(p => p.collection === target);

    el.querySelectorAll("[data-edit]").forEach(btn => btn.addEventListener("click", () => {
      openEditor(btn.dataset.edit, policyOf(btn.dataset.edit));
    }));
    el.querySelector("#add-policy-btn").addEventListener("click", () => openEditor("", null));

    bindConfirm(el, "[data-remove]", async btn => {
      try {
        await api.deleteRetention(btn.dataset.remove);
        await load(btn.dataset.remove === "*" ? "Default removed." : `Policy for ${btn.dataset.remove} removed.`);
      } catch (err) { errEl.innerHTML = alertHtml(err.message); }
    });

    el.querySelector("#apply-btn").addEventListener("click", async () => {
      if (!confirm("Apply all retention policies now? The versions they match are removed for good (current and labeled versions are kept).")) return;
      try {
        const r = await api.applyRetention();
        await load(summary(r, "did"));
      } catch (err) { errEl.innerHTML = alertHtml(err.message); }
    });

    if (editing) openEditor(editing.target, editing.policy);
  }

  function openEditor(target, policy) {
    editing = { target, policy };
    const p = policy ?? { labeledOnly: false, maxVersions: null, maxAgeDays: null, afterLabel: null };
    const isDefault = target === "*";
    const keepAll = !!policy && describeRules(policy).length === 0;
    const own = new Set(data.collections.map(c => c.collection));
    const box = el.querySelector("#editor");
    box.innerHTML = `
      <div class="card" style="border-color:var(--primary)">
        <div class="card-header">${isDefault ? "Org default" : target ? `Policy for ${escHtml(target)}` : "New collection policy"}</div>
        <div class="card-body">
          <form id="policy-form">
            ${target === "" ? `
              <div class="field" style="margin-bottom:12px">
                <label class="field-label">Collection</label>
                <input class="input" name="collection" list="retention-collections" placeholder="e.g. articles" required autocomplete="off">
                <datalist id="retention-collections">
                  ${collections.map(c => c.name ?? c).filter(n => !own.has(n)).map(n => `<option value="${escHtml(n)}">`).join("")}
                </datalist>
              </div>` : ""}
            ${isDefault ? "" : `
              <div class="row-actions" style="margin-bottom:12px">
                <label class="checkbox-label"><input type="radio" name="mode" value="rules" ${keepAll ? "" : "checked"}> Remove old versions by these rules</label>
                <label class="checkbox-label"><input type="radio" name="mode" value="keep" ${keepAll ? "checked" : ""}> Exempt this collection (keep everything, even if the org default would remove versions)</label>
              </div>`}
            <fieldset id="rules" class="retention-rules" ${keepAll ? "disabled" : ""}>
              <label class="checkbox-label"><input type="checkbox" name="labeledOnly" ${p.labeledOnly ? "checked" : ""}> Keep only labeled versions</label>
              <div>Keep the newest <input class="input input-inline" type="number" min="1" step="1" name="maxVersions" value="${p.maxVersions ?? ""}"> versions</div>
              <div>Remove versions older than <input class="input input-inline" type="number" min="1" step="1" name="maxAgeDays" value="${p.maxAgeDays ?? ""}"> days</div>
              <div>Remove versions older than the version labeled <input class="input input-inline" type="text" name="afterLabel" placeholder="e.g. published" value="${escHtml(p.afterLabel ?? "")}"></div>
              <div class="field-hint">Leave a box empty to skip that rule. A version is removed if any rule says so; the current version and labeled versions are always kept.</div>
            </fieldset>
            <div id="preview-result" style="margin-top:12px"></div>
            <div id="policy-error"></div>
            <div class="row-actions" style="margin-top:12px">
              <button class="btn" type="button" id="preview-btn">Preview</button>
              <button class="btn btn-primary" type="submit">Save</button>
              <button class="btn btn-ghost" type="button" id="cancel-policy-btn">Cancel</button>
            </div>
          </form>
        </div>
      </div>`;

    const form = box.querySelector("#policy-form");
    const policyErr = box.querySelector("#policy-error");
    const previewEl = box.querySelector("#preview-result");

    // Any change makes an earlier preview stale
    form.addEventListener("input", () => { previewEl.innerHTML = ""; });
    form.querySelectorAll('[name="mode"]').forEach(r => r.addEventListener("change", () => {
      box.querySelector("#rules").disabled = form.mode.value === "keep";
      previewEl.innerHTML = "";
    }));

    function read() {
      const name = target === "" ? form.collection.value.trim() : target;
      if (!name) throw new Error("Enter a collection name.");
      if (form.mode?.value === "keep") return { name, rules: { labeledOnly: false, maxVersions: null, maxAgeDays: null, afterLabel: null } };
      const num = k => form[k].value.trim() === "" ? null : Number(form[k].value);
      return {
        name,
        rules: {
          labeledOnly: form.labeledOnly.checked,
          maxVersions: num("maxVersions"),
          maxAgeDays: num("maxAgeDays"),
          afterLabel: form.afterLabel.value.trim() || null,
        },
      };
    }

    box.querySelector("#preview-btn").addEventListener("click", async () => {
      policyErr.innerHTML = "";
      previewEl.innerHTML = `<span class="muted">Counting…</span>`;
      try {
        const { name, rules } = read();
        const r = await api.previewRetention(name, rules);
        const many = r.collections.length > 1 || (isDefault && r.collections.length);
        previewEl.innerHTML = `
          <div class="callout callout--info" id="preview-summary">
            <strong>${escHtml(summary(r, "would"))}</strong>
            ${many ? `<ul style="margin:6px 0 0 18px">${r.collections.map(c =>
              `<li>${escHtml(c.collection)}: ${plural(c.versions, "version")} in ${plural(c.documents, "document")}, ${fmtBytes(c.bytes)}</li>`).join("")}</ul>` : ""}
            <div class="field-hint" style="margin-top:4px">Nothing has been removed or saved yet.</div>
          </div>`;
      } catch (err) {
        previewEl.innerHTML = "";
        policyErr.innerHTML = alertHtml(err.message);
      }
    });

    box.querySelector("#cancel-policy-btn").addEventListener("click", () => {
      editing = null;
      box.innerHTML = "";
    });

    form.addEventListener("submit", async e => {
      e.preventDefault();
      policyErr.innerHTML = "";
      try {
        const { name, rules } = read();
        await api.setRetention(name, rules);
        editing = null;
        await load(name === "*" ? "Default saved." : `Policy for ${name} saved.`);
      } catch (err) {
        policyErr.innerHTML = alertHtml(err.message);
      }
    });
  }
}
