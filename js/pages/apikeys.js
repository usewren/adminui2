import * as api from "../api.js";
import { render, spinner, alert as alertHtml, escHtml, fmtDate, bindConfirm, orgContextBadge } from "../ui.js";

export async function mountApiKeys(el, orgInfo) {
  const orgBadge = orgContextBadge(orgInfo);
  await load();

  async function load() {
    render(el, spinner());
    try {
      const keys = await api.listKeys();
      render(el, `
        <div class="page">
          <div class="page-header">
            <div>
              <h1 class="page-title">API Keys</h1>
              ${orgBadge}
            </div>
            <button class="btn btn-primary" id="new-key-btn">Create key</button>
          </div>
          <div id="new-key-form" class="card" style="display:none;margin-bottom:1rem">
            <div class="card-body">
              <form id="create-key-form">
                <div class="field">
                  <label class="field-label">Key name</label>
                  <input class="input" name="name" placeholder="e.g. production-reader" required>
                </div>
                <div id="key-created" style="display:none">
                  <div class="alert alert-success">
                    <strong>Key created!</strong> Copy the secret now — it won't be shown again.<br>
                    <code id="key-secret" class="mono" style="word-break:break-all;display:block;margin-top:.5rem;user-select:all;cursor:pointer" title="Click to select"></code>
                  </div>
                  <div class="row-actions" style="margin-top:.75rem">
                    <button class="btn btn-sm" type="button" id="copy-key-btn">Copy to clipboard</button>
                    <button class="btn btn-sm btn-primary" type="button" id="done-key-btn">Done — I've copied it</button>
                  </div>
                </div>
                <div id="create-key-error"></div>
                <div id="create-key-actions" class="row-actions">
                  <button class="btn btn-primary" type="submit">Create</button>
                  <button class="btn" type="button" id="cancel-key-btn">Cancel</button>
                </div>
              </form>
            </div>
          </div>
          <div class="card">
            ${keys.length === 0
              ? `<div class="card-body"><div class="empty-state">No API keys yet.</div></div>`
              : `<table class="table">
                  <thead><tr><th>Name</th><th>Prefix</th><th>Created</th><th>Expires</th><th></th></tr></thead>
                  <tbody>
                    ${keys.map(k => `
                      <tr>
                        <td><strong>${escHtml(k.name)}</strong></td>
                        <td class="mono muted">${escHtml(k.keyPrefix ?? k.prefix ?? "")}…</td>
                        <td class="muted">${fmtDate(k.createdAt ?? k.created_at)}</td>
                        <td class="muted">${k.expiresAt ?? k.expires_at ? fmtDate(k.expiresAt ?? k.expires_at) : "Never"}</td>
                        <td>
                          <button class="btn btn-sm btn-danger confirm-btn" data-revoke="${k.id}" data-confirm="Revoke?">Revoke</button>
                        </td>
                      </tr>`).join("")}
                  </tbody>
                </table>`}
          </div>
        </div>`);

      el.querySelector("#new-key-btn").addEventListener("click", () => {
        el.querySelector("#new-key-form").style.display = "";
      });
      el.querySelector("#cancel-key-btn").addEventListener("click", () => {
        el.querySelector("#new-key-form").style.display = "none";
      });
      el.querySelector("#create-key-form").addEventListener("submit", async e => {
        e.preventDefault();
        const name = new FormData(e.target).get("name");
        const errEl = el.querySelector("#create-key-error");
        errEl.innerHTML = "";
        try {
          const res = await api.createKey(name);
          const secret = res.secret ?? res.key ?? res.apiKey;
          el.querySelector("#key-secret").textContent = secret;
          el.querySelector("#key-created").style.display = "";
          el.querySelector("#create-key-actions").style.display = "none";
          e.target.querySelector("[name=name]").disabled = true;
        } catch (err) {
          errEl.innerHTML = alertHtml(err.message);
        }
      });

      el.querySelector("#copy-key-btn")?.addEventListener("click", () => {
        const secret = el.querySelector("#key-secret").textContent;
        navigator.clipboard.writeText(secret).then(() => {
          el.querySelector("#copy-key-btn").textContent = "Copied!";
        }).catch(() => {
          // Fallback: select the text
          const range = document.createRange();
          range.selectNodeContents(el.querySelector("#key-secret"));
          window.getSelection().removeAllRanges();
          window.getSelection().addRange(range);
        });
      });

      el.querySelector("#done-key-btn")?.addEventListener("click", () => load());

      bindConfirm(el, ".confirm-btn", async btn => {
        const id = btn.dataset.revoke;
        try {
          await api.revokeKey(id);
          await load();
        } catch (err) {
          window.alert(err.message);
        }
      });
    } catch (err) {
      render(el, alertHtml(err.message));
    }
  }
}
