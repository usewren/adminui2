import * as api from "../api.js";
import { render, spinner, alert as alertHtml, escHtml, fmtDate, bindConfirm } from "../ui.js";

// Apps (MCP clients like Claude or Cursor) you signed in to WREN with "Sign in with
// WREN". Personal, across all your orgs; revoking stops the app immediately.
export async function mountConnectedApps(el) {
  await load();

  async function load() {
    render(el, spinner());
    try {
      const apps = await api.listConnectedApps();
      render(el, `
        <div class="page">
          <div class="page-header">
            <div>
              <h1 class="page-title">Connected apps</h1>
              <div class="muted" style="margin-top:4px">AI apps you signed in to WREN (via <code>/mcp/login</code>). Each acts as you, in the org you chose when you allowed it.</div>
            </div>
          </div>
          <div class="card">
            ${apps.length === 0
              ? `<div class="card-body"><div class="empty-state">No connected apps. Apps you allow from the WREN sign-in page appear here.</div></div>`
              : `<table class="table">
                  <thead><tr><th>App</th><th>Org</th><th>Receives access at</th><th>Connected</th><th>Last renewed</th><th></th></tr></thead>
                  <tbody>
                    ${apps.map(a => `
                      <tr>
                        <td><strong>${escHtml(a.name)}</strong></td>
                        <td>${a.org ? `${escHtml(a.org.name ?? "")} <span class="muted">${escHtml(a.org.slug ?? "")}</span>` : `<span class="muted">none chosen</span>`}</td>
                        <td class="muted">${a.redirectHosts.map(escHtml).join(", ")}</td>
                        <td class="muted">${fmtDate(a.connectedAt)}</td>
                        <td class="muted">${fmtDate(a.lastRenewedAt)}</td>
                        <td><button class="btn btn-sm btn-danger confirm-btn" data-revoke="${escHtml(a.clientId)}" data-confirm="Revoke ${escHtml(a.name)}? It stops working right away and has to ask again.">Revoke</button></td>
                      </tr>`).join("")}
                  </tbody>
                </table>`}
          </div>
          <div id="apps-error"></div>
        </div>`);

      bindConfirm(el, ".confirm-btn", async btn => {
        try { await api.revokeConnectedApp(btn.dataset.revoke); await load(); }
        catch (err) { el.querySelector("#apps-error").innerHTML = alertHtml(err.message); }
      });
    } catch (err) {
      render(el, alertHtml(err.message));
    }
  }
}
