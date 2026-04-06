import * as api from "../api.js";
import { render, spinner, alert as alertHtml, escHtml, fmtDate, bindConfirm, accessBadge, orgContextBadge } from "../ui.js";

export async function mountCollaborators(el, currentUser, orgInfo) {
  let tab = "members";

  async function load() {
    render(el, spinner());
    try {
      const [members, invites, receivedAll] = await Promise.all([
        api.listMembers().catch(() => []),
        api.listInvites().catch(() => []),
        api.listReceivedInvites().catch(() => []),
      ]);
      // Only show pending received invites (not already accepted, revoked, or expired)
      const now = new Date();
      const received = receivedAll.filter(inv =>
        !inv.acceptedAt && !inv.revokedAt &&
        (!inv.expiresAt || new Date(inv.expiresAt) > now)
      );
      renderAll(members, invites, received);
    } catch (err) {
      render(el, alertHtml(err.message));
    }
  }

  function renderAll(members, invites, received) {
    const roleOpts = ["viewer", "editor", "admin"].map(r =>
      `<option value="${r}">${r}</option>`).join("");

    render(el, `
      <div class="page">
        <div class="page-header">
          <div>
            <h1 class="page-title">Collaborators</h1>
            ${orgContextBadge(orgInfo)}
          </div>
        </div>
        <div class="tabs" id="collab-tabs">
          <button class="tab${tab === "members" ? " active" : ""}" data-tab="members">
            Members <span class="count-badge">${members.length}</span>
          </button>
          <button class="tab${tab === "invites" ? " active" : ""}" data-tab="invites">
            Sent invites <span class="count-badge">${invites.length}</span>
          </button>
          ${received.length > 0 ? `
            <button class="tab${tab === "received" ? " active" : ""}" data-tab="received">
              Pending invites <span class="count-badge">${received.length}</span>
            </button>` : ""}
        </div>

        <div id="collab-tab-content"></div>
      </div>`);

    el.querySelector("#collab-tabs").addEventListener("click", e => {
      const btn = e.target.closest(".tab");
      if (!btn) return;
      tab = btn.dataset.tab;
      el.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
      renderTab();
    });

    function renderTab() {
      const content = el.querySelector("#collab-tab-content");
      if (tab === "members") renderMembersTab(content, members);
      else if (tab === "invites") renderInvitesTab(content, invites, roleOpts);
      else if (tab === "received") renderReceivedTab(content, received);
    }

    function renderMembersTab(content, members) {
      content.innerHTML = `
        <div style="margin-top:1rem" class="card">
          ${members.length === 0
            ? `<div class="card-body"><div class="empty-state">No members yet.</div></div>`
            : `<table class="table">
                <thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead>
                <tbody>
                  ${members.map(m => `
                    <tr>
                      <td>${escHtml(m.name ?? "")}</td>
                      <td class="muted">${escHtml(m.email ?? "")}</td>
                      <td>${accessBadge(m.role ?? m.access ?? "read")}</td>
                      <td>
                        ${m.userId !== (currentUser?.id ?? currentUser?.userId)
                          ? `<button class="btn btn-sm btn-danger confirm-btn" data-remove="${m.userId}" data-confirm="Remove?">Remove</button>`
                          : `<span class="muted">(you)</span>`}
                      </td>
                    </tr>`).join("")}
                </tbody>
              </table>`}
        </div>`;

      bindConfirm(content, ".confirm-btn", async btn => {
        try {
          await api.removeMember(btn.dataset.remove);
          await load();
        } catch (err) {
          window.alert(err.message);
        }
      });
    }

    function renderInvitesTab(content, invites, roleOpts) {
      content.innerHTML = `
        <div style="margin-top:1rem">
          <div class="card" style="margin-bottom:1rem">
            <div class="card-header">Send invite</div>
            <div class="card-body">
              <form id="invite-form">
                <div class="field-row">
                  <div class="field">
                    <label class="field-label">Email</label>
                    <input class="input" type="email" name="email" required placeholder="colleague@example.com">
                  </div>
                  <div class="field">
                    <label class="field-label">Role</label>
                    <select class="input" name="role">${roleOpts}</select>
                  </div>
                  <div class="field" style="align-self:flex-end">
                    <button class="btn btn-primary" type="submit">Send invite</button>
                  </div>
                </div>
                <div id="invite-error"></div>
              </form>
            </div>
          </div>
          <div class="card">
            ${invites.length === 0
              ? `<div class="card-body"><div class="empty-state">No pending invites.</div></div>`
              : `<table class="table">
                  <thead><tr><th>Email</th><th>Role</th><th>Sent</th><th></th></tr></thead>
                  <tbody>
                    ${invites.map(inv => `
                      <tr>
                        <td>${escHtml(inv.email ?? "")}</td>
                        <td>${accessBadge(inv.role ?? "read")}</td>
                        <td class="muted">${fmtDate(inv.createdAt ?? inv.created_at)}</td>
                        <td>
                          <button class="btn btn-sm btn-danger confirm-btn" data-revoke-invite="${inv.id}" data-confirm="Revoke?">Revoke</button>
                        </td>
                      </tr>`).join("")}
                  </tbody>
                </table>`}
          </div>
        </div>`;

      content.querySelector("#invite-form").addEventListener("submit", async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const errEl = content.querySelector("#invite-error");
        errEl.innerHTML = "";
        try {
          await api.createInvite(fd.get("email"), fd.get("role"));
          errEl.innerHTML = `<div class="alert alert-success">Invite sent to ${escHtml(fd.get("email"))}.</div>`;
          e.target.reset();
          await load();
        } catch (err) {
          errEl.innerHTML = alertHtml(err.message);
        }
      });

      bindConfirm(content, ".confirm-btn", async btn => {
        try {
          await api.revokeInvite(btn.dataset.revokeInvite);
          await load();
        } catch (err) {
          window.alert(err.message);
        }
      });
    }

    function renderReceivedTab(content, received) {
      content.innerHTML = `
        <div style="margin-top:1rem" class="card">
          <div class="card-header">Invites to join other organisations</div>
          <div id="accept-error"></div>
          ${received.length === 0
            ? `<div class="card-body"><div class="empty-state">No pending invites.</div></div>`
            : `<table class="table">
                <thead><tr><th>Organisation</th><th>Role</th><th>Sent</th><th></th></tr></thead>
                <tbody>
                  ${received.map(inv => `
                    <tr>
                      <td>${escHtml(inv.orgName ?? inv.orgId ?? "")}</td>
                      <td>${accessBadge(inv.role ?? "read")}</td>
                      <td class="muted">${fmtDate(inv.createdAt ?? inv.created_at)}</td>
                      <td>
                        <button class="btn btn-sm btn-primary" data-accept="${escHtml(inv.id)}">Accept</button>
                      </td>
                    </tr>`).join("")}
                </tbody>
              </table>`}
        </div>`;

      content.querySelectorAll("[data-accept]").forEach(btn => {
        btn.addEventListener("click", async () => {
          const errEl = content.querySelector("#accept-error");
          errEl.innerHTML = "";
          btn.disabled = true;
          btn.textContent = "Accepting…";
          try {
            await api.acceptInviteById(btn.dataset.accept);
            // Reload full page — now a member of a new org, sidebar needs refreshing
            location.reload();
          } catch (err) {
            btn.disabled = false;
            btn.textContent = "Accept";
            errEl.innerHTML = alertHtml(err.message);
          }
        });
      });
    }

    renderTab();
  }

  await load();
}
