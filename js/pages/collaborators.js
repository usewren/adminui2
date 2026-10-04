import * as api from "../api.js";
import { render, spinner, alert as alertHtml, escHtml, fmtDate, bindConfirm, accessBadge, statusBadge, orgContextBadge } from "../ui.js";

export async function mountCollaborators(el, currentUser, orgInfo) {
  let tab = "members";
  // Result of the last invite (incl. the link to share). Kept across the reload
  // that follows, which re-renders the page and would otherwise wipe it.
  let inviteNotice = "";

  async function load() {
    render(el, spinner());
    try {
      const [members, invites, receivedAll, groups] = await Promise.all([
        api.listMembers().catch(() => []),
        api.listInvites().catch(() => []),
        api.listReceivedInvites().catch(() => []),
        api.listGroups().catch(() => []),
      ]);
      // Only show pending received invites (not already accepted, revoked, or expired)
      const now = new Date();
      const received = receivedAll.filter(inv =>
        !inv.acceptedAt && !inv.revokedAt &&
        (!inv.expiresAt || new Date(inv.expiresAt) > now)
      );
      renderAll(members, invites, received, groups);
    } catch (err) {
      render(el, alertHtml(err.message));
    }
  }

  function renderAll(members, invites, received, groups) {
    // Role = what someone may manage; groups = which data they can see and change
    const roleOpts = [["member", "Member"], ["admin", "Admin (manages people, keys, rules)"]].map(([v, l]) =>
      `<option value="${v}">${l}</option>`).join("");
    const ruleText = g => g.rules.length
      ? g.rules.map(r => `${escHtml(r.access)} on ${r.resource === "*" ? "everything" : escHtml(r.resource)}${r.labelFilter ? ` (${escHtml(r.labelFilter)})` : ""}`).join(", ")
      : "no access rules yet";

    const now = new Date();
    const pendingSent = invites.filter(inv =>
      !inv.acceptedAt && !inv.revokedAt && (!inv.expiresAt || new Date(inv.expiresAt) > now)
    );

    // If tab was "received" (old state), reset to members
    if (tab === "received") tab = "members";

    // Personal pending invites callout — shown above the org-scoped tabs
    const receivedCallout = received.length === 0 ? "" : `
      <div class="card" style="margin-bottom:1.25rem;border-left:3px solid #3b82f6;background:#eff6ff">
        <div class="card-body" style="padding:12px 16px">
          <div style="font-weight:600;margin-bottom:8px">
            You have ${received.length} pending invitation${received.length > 1 ? "s" : ""} to join another workspace
          </div>
          <div id="received-accept-error"></div>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${received.map(inv => `
              <div style="display:flex;align-items:center;gap:12px">
                <span>${escHtml(inv.orgName ?? inv.orgId ?? "Unknown")} — ${accessBadge(inv.role ?? "read")} — <span class="muted">${fmtDate(inv.createdAt)}</span></span>
                <button class="btn btn-sm btn-primary" data-accept-invite="${escHtml(inv.id)}">Accept</button>
              </div>`).join("")}
          </div>
        </div>
      </div>`;

    render(el, `
      <div class="page">
        <div class="page-header">
          <div>
            <h1 class="page-title">Collaborators</h1>
            ${orgContextBadge(orgInfo)}
          </div>
        </div>

        ${receivedCallout}

        <div class="tabs" id="collab-tabs">
          <button class="tab${tab === "members" ? " active" : ""}" data-tab="members">
            Members <span class="count-badge">${members.length}</span>
          </button>
          <button class="tab${tab === "groups" ? " active" : ""}" data-tab="groups">
            Groups <span class="count-badge">${groups.length}</span>
          </button>
          <button class="tab${tab === "invites" ? " active" : ""}" data-tab="invites">
            Sent invites${pendingSent.length > 0 ? ` <span class="count-badge">${pendingSent.length} pending</span>` : ""}
          </button>
        </div>

        <div id="collab-tab-content"></div>
      </div>`);

    // Accept invite buttons in the callout
    el.querySelectorAll("[data-accept-invite]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const errEl = el.querySelector("#received-accept-error");
        errEl.innerHTML = "";
        btn.disabled = true;
        btn.textContent = "Accepting…";
        try {
          await api.acceptInviteById(btn.dataset.acceptInvite);
          location.reload();
        } catch (err) {
          btn.disabled = false;
          btn.textContent = "Accept";
          errEl.innerHTML = alertHtml(err.message);
        }
      });
    });

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
      else if (tab === "groups") renderGroupsTab(content, groups, members);
      else if (tab === "invites") renderInvitesTab(content, invites, roleOpts);
    }

    function renderMembersTab(content, members) {
      content.innerHTML = `
        <div style="margin-top:1rem" class="card">
          ${members.length === 0
            ? `<div class="card-body"><div class="empty-state">No members yet.</div></div>`
            : `<table class="table">
                <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Groups</th><th></th></tr></thead>
                <tbody>
                  ${members.map(m => `
                    <tr>
                      <td>${escHtml(m.name ?? "")}</td>
                      <td class="muted">${escHtml(m.email ?? "")}</td>
                      <td>${accessBadge(m.role ?? m.access ?? "read")}</td>
                      <td>${(m.groups ?? []).length ? m.groups.map(g => `<span class="badge">${escHtml(g.name)}</span>`).join(" ") : `<span class="muted">none: sees no data</span>`}</td>
                      <td style="white-space:nowrap">
                        ${m.userId !== (currentUser?.id ?? currentUser?.userId)
                          ? `<button class="btn btn-sm" data-view-as="${m.userId}" data-name="${escHtml(m.name ?? m.email ?? "")}" title="See WREN exactly as this member does, for up to 1 hour">View as</button>
                             <button class="btn btn-sm btn-danger confirm-btn" data-remove="${m.userId}" data-confirm="Remove?">Remove</button>`
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

      content.querySelectorAll("[data-view-as]").forEach(btn => btn.addEventListener("click", async () => {
        const name = btn.dataset.name;
        if (!window.confirm(`View this org as ${name}?\n\nFor up to 1 hour you'll see exactly what ${name} sees. Anything you change is saved as made by ${name} on your behalf, and recorded with your name. People, keys and permissions can't be managed while viewing as someone.`)) return;
        try {
          await api.startImpersonation(btn.dataset.viewAs);
          location.hash = "#/";
          location.reload();
        } catch (err) {
          window.alert(err.message);
        }
      }));
    }

    function renderGroupsTab(content, groups, members) {
      content.innerHTML = `
        <div style="margin-top:1rem">
          <p class="muted" style="margin:0 0 1rem">Groups decide what people can see and change. Everyone in a group gets its access; invite people straight into the right groups.</p>
          ${groups.map(g => {
            const inGroup = new Set(g.members.map(m => m.userId));
            const addable = members.filter(m => !inGroup.has(m.userId));
            return `
            <div class="card" style="margin-bottom:1rem">
              <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
                <span><strong>${escHtml(g.name)}</strong> <span class="muted">· ${ruleText(g)}</span></span>
                <button class="btn btn-sm btn-danger confirm-btn" data-delete-group="${g.id}" data-confirm="Delete group ${escHtml(g.name)}?">Delete</button>
              </div>
              <div class="card-body">
                ${g.description ? `<p class="muted" style="margin-top:0">${escHtml(g.description)}</p>` : ""}
                <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
                  ${g.members.length ? g.members.map(m => `
                    <span class="badge">${escHtml(m.name || m.email)}
                      <a href="#" data-group-remove="${g.id}" data-user="${m.userId}" title="Remove from group" style="margin-left:4px;text-decoration:none">×</a>
                    </span>`).join("") : `<span class="muted">No members</span>`}
                </div>
                ${addable.length ? `
                <div style="display:flex;gap:6px">
                  <select class="input" data-group-add-select="${g.id}" style="max-width:260px">
                    ${addable.map(m => `<option value="${m.userId}">${escHtml(m.name || m.email)}</option>`).join("")}
                  </select>
                  <button class="btn btn-sm" data-group-add="${g.id}">Add</button>
                </div>` : ""}
              </div>
            </div>`;
          }).join("")}
          <div class="card">
            <div class="card-header">New group</div>
            <div class="card-body">
              <form id="group-form" class="field-row">
                <div class="field"><label class="field-label">Name</label><input class="input" name="name" required placeholder="Results team"></div>
                <div class="field"><label class="field-label">Access to everything</label>
                  <select class="input" name="access">
                    <option value="">none (add specific rules under Permissions)</option>
                    <option value="read">read</option><option value="write">read + write</option>
                  </select></div>
                <div class="field" style="align-self:flex-end"><button class="btn btn-primary" type="submit">Create</button></div>
              </form>
              <div id="group-error"></div>
            </div>
          </div>
        </div>`;

      content.querySelector("#group-form").addEventListener("submit", async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try { await api.createGroup(fd.get("name"), "", fd.get("access")); tab = "groups"; await load(); }
        catch (err) { content.querySelector("#group-error").innerHTML = alertHtml(err.message); }
      });
      content.querySelectorAll("[data-group-add]").forEach(btn => btn.addEventListener("click", async () => {
        const sel = content.querySelector(`[data-group-add-select="${btn.dataset.groupAdd}"]`);
        try { await api.addGroupMember(btn.dataset.groupAdd, sel.value); tab = "groups"; await load(); }
        catch (err) { window.alert(err.message); }
      }));
      content.querySelectorAll("[data-group-remove]").forEach(a => a.addEventListener("click", async e => {
        e.preventDefault();
        try { await api.removeGroupMember(a.dataset.groupRemove, a.dataset.user); tab = "groups"; await load(); }
        catch (err) { window.alert(err.message); }
      }));
      bindConfirm(content, ".confirm-btn", async btn => {
        try { await api.deleteGroup(btn.dataset.deleteGroup); tab = "groups"; await load(); }
        catch (err) { window.alert(err.message); }
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
                <div class="field">
                  <label class="field-label">Groups (what they can see and change)</label>
                  <div style="display:flex;flex-wrap:wrap;gap:12px">
                    ${groups.map(g => `
                      <label style="display:flex;gap:6px;align-items:center;font-weight:normal" title="${ruleText(g)}">
                        <input type="checkbox" name="groupIds" value="${g.id}" ${g.name === "Viewers" ? "checked" : ""}>
                        ${escHtml(g.name)} <span class="muted">(${ruleText(g)})</span>
                      </label>`).join("")}
                  </div>
                </div>
                <div id="invite-error"></div>
              </form>
            </div>
          </div>
          <div class="card">
            ${invites.length === 0
              ? `<div class="card-body"><div class="empty-state">No invites sent yet.</div></div>`
              : `<table class="table">
                  <thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Sent</th><th></th></tr></thead>
                  <tbody>
                    ${invites.map(inv => {
                      const isPending  = !inv.acceptedAt && !inv.revokedAt && (!inv.expiresAt || new Date(inv.expiresAt) > new Date());
                      const isAccepted = !!inv.acceptedAt;
                      const isRevoked  = !!inv.revokedAt;
                      const isExpired  = !isAccepted && !isRevoked && inv.expiresAt && new Date(inv.expiresAt) <= new Date();
                      const statusHtml = isAccepted ? statusBadge("accepted", "badge-blue")
                                       : isRevoked  ? statusBadge("revoked",  "badge-gray")
                                       : isExpired  ? statusBadge("expired",  "badge-gray")
                                       :              statusBadge("pending",  "badge-amber");
                      return `
                      <tr>
                        <td>${escHtml(inv.email ?? "")}</td>
                        <td>${accessBadge(inv.role ?? "read")}</td>
                        <td>${statusHtml}</td>
                        <td class="muted">${fmtDate(inv.createdAt ?? inv.created_at)}</td>
                        <td>
                          ${isPending ? `<button class="btn btn-sm btn-danger confirm-btn" data-revoke-invite="${inv.id}" data-confirm="Revoke?">Revoke</button>` : ""}
                        </td>
                      </tr>`;
                    }).join("")}
                  </tbody>
                </table>`}
          </div>
        </div>`;

      content.querySelector("#invite-error").innerHTML = inviteNotice;
      content.querySelector("#invite-form").addEventListener("submit", async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const errEl = content.querySelector("#invite-error");
        errEl.innerHTML = "";
        try {
          const inv = await api.createInvite(fd.get("email"), fd.get("role"), fd.getAll("groupIds"));
          // emailSent is false when the server has no mail transport configured:
          // then the inviter has to pass the link on themselves.
          inviteNotice = inv.emailSent
            ? `<div class="alert alert-success">Invite emailed to ${escHtml(fd.get("email"))}.</div>`
            : `<div class="alert alert-success">Invite created for ${escHtml(fd.get("email"))}. This server doesn't send email, so share this link with them (only ${escHtml(fd.get("email"))} can use it):<br><code style="word-break:break-all;user-select:all">${escHtml(inv.acceptUrl ?? "")}</code></div>`;
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

    renderTab();
  }

  await load();
}
