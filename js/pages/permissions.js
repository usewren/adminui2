import * as api from "../api.js";
import { render, spinner, alert as alertHtml, escHtml, fmtDate, accessBadge, bindConfirm, notesText, principalLabel } from "../ui.js";

export async function mountPermissions(el) {
  await load();

  async function load() {
    render(el, spinner());
    try {
      const [perms, members, keys] = await Promise.all([
        api.listPermissions(),
        api.listMembers().catch(() => []),
        api.listKeys().catch(() => []),
      ]);
      renderPage(perms, members, keys);
    } catch (err) {
      render(el, alertHtml(err.message));
    }
  }

  function renderPage(perms, members, keys) {
    const pl = p => principalLabel(p, members, keys);

    const accessOpts = ["none", "read", "write", "admin"].map(a =>
      `<option value="${a}">${a}</option>`).join("");

    const memberOpts = [
      `<option value="*">Everyone (*)</option>`,
      `<option value="member:*">All members (member:*)</option>`,
      ...members.map(m => `<option value="member:${m.userId}">${escHtml(m.name)} &lt;${escHtml(m.email)}&gt;</option>`),
      ...keys.map(k => `<option value="key:${k.id}">key: ${escHtml(k.name)}</option>`),
    ].join("");

    const resourceOpts = [
      `<option value="*">Everything (*)</option>`,
      `<option value="collection:*">All collections</option>`,
      `<option value="tree:*">All trees</option>`,
      ...([...new Set(perms.map(p => p.resource).filter(r => r !== "*" && r !== "collection:*" && r !== "tree:*"))].map(r =>
        `<option value="${escHtml(r)}">${escHtml(r)}</option>`)),
    ].join("");

    render(el, `
      <div class="page">
        <div class="page-header">
          <h1 class="page-title">Permissions</h1>
          <button class="btn btn-primary" id="new-perm-btn">Add rule</button>
        </div>
        <p class="muted" style="margin-bottom:1.5rem">
          Access is deny-by-default. Rules are evaluated most-specific first. Org owners always have full access.
        </p>

        <div id="new-perm-form" class="card" style="display:none;margin-bottom:1.5rem">
          <div class="card-header">New permission rule</div>
          <div class="card-body">
            <form id="create-perm-form">
              <div class="field-row">
                <div class="field">
                  <label class="field-label">Who</label>
                  <select class="input" name="principal" id="new-principal">
                    ${memberOpts}
                    <option value="__custom__">Custom…</option>
                  </select>
                  <input class="input" name="principal_custom" id="new-principal-custom" placeholder="member:uuid or key:uuid" style="display:none;margin-top:.35rem">
                </div>
                <div class="field">
                  <label class="field-label">Resource</label>
                  <select class="input" name="resource" id="new-resource">
                    ${resourceOpts}
                    <option value="__custom__">Custom…</option>
                  </select>
                  <input class="input" name="resource_custom" id="new-resource-custom" placeholder="collection:name or tree:name" style="display:none;margin-top:.35rem">
                </div>
                <div class="field">
                  <label class="field-label">Access</label>
                  <select class="input" name="access">${accessOpts}</select>
                </div>
              </div>

              <details class="advanced-details">
                <summary class="advanced-summary">Advanced options</summary>
                <div class="advanced-body">
                  <div class="field-row">
                    <div class="field">
                      <label class="field-label">Label filter <span class="field-hint">Restrict reads to this label</span></label>
                      <input class="input" name="labelFilter" placeholder="e.g. stable">
                    </div>
                    <div class="field">
                      <label class="field-label">Data filter language</label>
                      <select class="input" name="filterLang">
                        <option value="">None</option>
                        <option value="jq">jq</option>
                        <option value="jmespath">JMESPath</option>
                        <option value="jsonata">JSONata</option>
                      </select>
                    </div>
                    <div class="field">
                      <label class="field-label">Data filter expression</label>
                      <input class="input mono" name="filterExpr" placeholder=".field">
                    </div>
                  </div>
                  <div class="field-row">
                    <label class="checkbox-label">
                      <input type="checkbox" name="auditReads"> Audit reads
                    </label>
                    <label class="checkbox-label">
                      <input type="checkbox" name="auditWrites"> Audit writes
                    </label>
                  </div>
                </div>
              </details>

              <div id="create-perm-error"></div>
              <div class="row-actions" style="margin-top:1rem">
                <button class="btn btn-primary" type="submit">Add rule</button>
                <button class="btn" type="button" id="cancel-perm-btn">Cancel</button>
              </div>
            </form>
          </div>
        </div>

        <div class="card">
          ${perms.length === 0
            ? `<div class="card-body"><div class="empty-state">No permission rules yet. All access is denied by default except for org owners.</div></div>`
            : `<table class="table">
                <thead>
                  <tr>
                    <th>Principal</th>
                    <th>Resource</th>
                    <th>Access</th>
                    <th>Notes</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${perms.map(p => `
                    <tr>
                      <td>${escHtml(pl(p.principal))}</td>
                      <td><span class="badge badge-gray">${escHtml(p.resource)}</span></td>
                      <td>${accessBadge(p.access)}</td>
                      <td class="muted">${escHtml(notesText(p))}</td>
                      <td>
                        <div class="row-actions">
                          <button class="btn btn-sm" data-edit="${p.id}">Edit</button>
                          <button class="btn btn-sm btn-danger confirm-btn" data-delete="${p.id}" data-confirm="Delete rule?">Delete</button>
                        </div>
                        <div class="inline-edit" id="edit-${p.id}" style="display:none"></div>
                      </td>
                    </tr>`).join("")}
                </tbody>
              </table>`}
        </div>
      </div>`);

    // ── New form wiring ──────────────────────────────────────────────────────
    el.querySelector("#new-perm-btn").addEventListener("click", () => {
      el.querySelector("#new-perm-form").style.display = "";
    });
    el.querySelector("#cancel-perm-btn").addEventListener("click", () => {
      el.querySelector("#new-perm-form").style.display = "none";
    });

    // Custom principal toggle
    el.querySelector("#new-principal").addEventListener("change", e => {
      el.querySelector("#new-principal-custom").style.display =
        e.target.value === "__custom__" ? "" : "none";
    });

    // Custom resource toggle
    el.querySelector("#new-resource").addEventListener("change", e => {
      el.querySelector("#new-resource-custom").style.display =
        e.target.value === "__custom__" ? "" : "none";
    });

    el.querySelector("#create-perm-form").addEventListener("submit", async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errEl = el.querySelector("#create-perm-error");
      errEl.innerHTML = "";

      const principal = fd.get("principal") === "__custom__"
        ? fd.get("principal_custom").trim()
        : fd.get("principal");
      const resource = fd.get("resource") === "__custom__"
        ? fd.get("resource_custom").trim()
        : fd.get("resource");

      if (!principal || !resource) {
        errEl.innerHTML = alertHtml("Principal and resource are required.");
        return;
      }

      const body = {
        principal,
        resource,
        access: fd.get("access"),
        labelFilter: fd.get("labelFilter") || undefined,
        filterLang: fd.get("filterLang") || undefined,
        filterExpr: fd.get("filterExpr") || undefined,
        auditReads: fd.get("auditReads") === "on",
        auditWrites: fd.get("auditWrites") === "on",
      };

      try {
        await api.createPermission(body);
        await load();
      } catch (err) {
        errEl.innerHTML = alertHtml(err.message);
      }
    });

    // ── Delete ───────────────────────────────────────────────────────────────
    bindConfirm(el, ".confirm-btn", async btn => {
      try {
        await api.deletePermission(btn.dataset.delete);
        await load();
      } catch (err) {
        window.alert(err.message);
      }
    });

    // ── Inline edit ──────────────────────────────────────────────────────────
    el.querySelectorAll("[data-edit]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.edit;
        const perm = perms.find(p => String(p.id) === String(id));
        if (!perm) return;

        const editEl = el.querySelector(`#edit-${id}`);
        const isOpen = editEl.style.display !== "none";
        // Close all other inline edits
        el.querySelectorAll(".inline-edit").forEach(e => { e.style.display = "none"; e.innerHTML = ""; });
        if (isOpen) return;

        editEl.innerHTML = `
          <div class="inline-edit-body">
            <form id="edit-form-${id}">
              <div class="field-row">
                <div class="field">
                  <label class="field-label">Access</label>
                  <select class="input" name="access">
                    ${["none","read","write","admin"].map(a =>
                      `<option value="${a}"${a === perm.access ? " selected" : ""}>${a}</option>`).join("")}
                  </select>
                </div>
                <div class="field">
                  <label class="field-label">Label filter</label>
                  <input class="input" name="labelFilter" value="${escHtml(perm.labelFilter ?? "")}">
                </div>
              </div>
              <div class="field-row">
                <label class="checkbox-label">
                  <input type="checkbox" name="auditReads"${perm.auditReads ? " checked" : ""}> Audit reads
                </label>
                <label class="checkbox-label">
                  <input type="checkbox" name="auditWrites"${perm.auditWrites ? " checked" : ""}> Audit writes
                </label>
              </div>
              <div id="edit-error-${id}"></div>
              <div class="row-actions" style="margin-top:.75rem">
                <button class="btn btn-primary btn-sm" type="submit">Save</button>
                <button class="btn btn-sm" type="button" data-close-edit="${id}">Cancel</button>
              </div>
            </form>
          </div>`;

        editEl.style.display = "";

        editEl.querySelector(`[data-close-edit]`).addEventListener("click", () => {
          editEl.style.display = "none";
          editEl.innerHTML = "";
        });

        editEl.querySelector(`#edit-form-${id}`).addEventListener("submit", async e => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const errEl = editEl.querySelector(`#edit-error-${id}`);
          errEl.innerHTML = "";
          try {
            await api.updatePermission(id, {
              access: fd.get("access"),
              labelFilter: fd.get("labelFilter") || undefined,
              auditReads: fd.get("auditReads") === "on",
              auditWrites: fd.get("auditWrites") === "on",
            });
            await load();
          } catch (err) {
            errEl.innerHTML = alertHtml(err.message);
          }
        });
      });
    });
  }
}
