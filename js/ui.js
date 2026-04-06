/** Shared UI helpers — no framework, just functions that build DOM strings. */

export function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function accessBadge(access) {
  const map = { none: "badge-gray", read: "badge-blue", write: "badge-amber", admin: "badge-red" };
  return `<span class="badge ${map[access] ?? "badge-gray"}">${escHtml(access)}</span>`;
}

export function statusBadge(text, cls = "badge-gray") {
  return `<span class="badge ${cls}">${escHtml(text)}</span>`;
}

export function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function fmtDateShort(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function spinner() {
  return `<div class="loading"><span class="spinner"></span> Loading…</div>`;
}

export function alert(msg, type = "error") {
  return msg ? `<div class="alert alert-${type}">${escHtml(msg)}</div>` : "";
}

/** Returns a small subtitle showing which org is currently active.
 *  orgInfo = { current, orgs: [{id, name, own}] } from api.getOrg() */
export function orgContextBadge(orgInfo) {
  if (!orgInfo) return "";
  const org = orgInfo.orgs?.find(o => o.id === orgInfo.current);
  if (!org) return "";
  return `<span class="muted" style="font-size:12px">
    ${org.own ? "My workspace" : escHtml(org.name)}
    ${!org.own ? `<span class="badge badge-gray" style="margin-left:4px">member</span>` : ""}
  </span>`;
}

/** Render HTML into el, return el for chaining */
export function render(el, html) {
  el.innerHTML = html;
  return el;
}

/** Simple confirm-button: first click shows warning state, second click fires callback */
export function bindConfirm(el, selector, callback) {
  el.querySelectorAll(selector).forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.confirming) {
        callback(btn);
      } else {
        const orig = btn.textContent;
        btn.dataset.confirming = "1";
        btn.classList.add("btn-danger");
        btn.textContent = btn.dataset.confirm || "Confirm?";
        setTimeout(() => {
          btn.dataset.confirming = "";
          btn.classList.remove("btn-danger");
          btn.textContent = orig;
        }, 3000);
      }
    });
  });
}

export function jsonPreview(data, maxLen = 120) {
  const s = JSON.stringify(data);
  return escHtml(s.length > maxLen ? s.slice(0, maxLen) + "…" : s);
}

export function prettyJson(data) {
  return JSON.stringify(data, null, 2);
}

export function tabs(items, active, onSelect) {
  return `<div class="tabs">${items.map(t =>
    `<button class="tab${t.key === active ? " active" : ""}" data-tab="${t.key}">${escHtml(t.label)}</button>`
  ).join("")}</div>`;
}

export function bindTabs(el, onSelect) {
  el.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => onSelect(btn.dataset.tab));
  });
}

export function fieldRow(label, inputHtml, hint = "") {
  return `<div class="field">
    <label>${escHtml(label)}${hint ? ` <span class="hint">${escHtml(hint)}</span>` : ""}</label>
    ${inputHtml}
  </div>`;
}

export function notesText(p) {
  return [
    p.labelFilter ? `label: ${p.labelFilter}` : "",
    p.filterExpr  ? `${p.filterLang}: ${p.filterExpr}` : "",
    p.auditReads  ? "audit reads" : "",
    p.auditWrites ? "audit writes" : "",
  ].filter(Boolean).join(" · ") || "—";
}

/** Apply a display name rule like "{title}" or "{first} {last}" to document data */
export function applyDisplayRule(rule, data) {
  if (!rule || !data || typeof data !== "object") return null;
  return rule.replace(/\{(\w+)\}/g, (_, key) => {
    const val = data[key];
    return val !== undefined && val !== null ? String(val) : `{${key}}`;
  });
}

/** Format bytes to human-readable string */
export function fmtBytes(n) {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function principalLabel(principal, members = [], keys = []) {
  if (principal.startsWith("member:")) {
    const uid = principal.slice(7);
    const m = members.find(m => m.userId === uid);
    return m ? `${m.name} <${m.email}>` : principal;
  }
  if (principal.startsWith("key:")) {
    const kid = principal.slice(4);
    const k = keys.find(k => k.id === kid);
    return k ? `key: ${k.name} (${k.keyPrefix}…)` : principal;
  }
  return principal;
}
