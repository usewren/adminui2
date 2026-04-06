import * as api from "../api.js";
import { render, spinner, alert, escHtml, fmtDate, statusBadge } from "../ui.js";

// ── Collections list ──────────────────────────────────────────────────────────
export async function mountCollections(el, collections, { refreshCollections }) {
  render(el, spinner());

  let cols = collections;
  if (!cols || cols.length === 0) {
    try { cols = await api.listCollections(); } catch { cols = []; }
  }

  render(el, `
    <div class="page">
      <div class="page-header">
        <h1 class="page-title">Collections</h1>
        <button class="btn btn-primary" id="new-col-btn">New collection</button>
      </div>
      <div id="new-col-form" class="card" style="display:none;margin-bottom:1rem">
        <div class="card-body">
          <form id="create-col-form">
            <div class="field">
              <label class="field-label">Collection name</label>
              <input class="input" name="name" placeholder="e.g. products" required pattern="[a-z0-9_-]+">
            </div>
            <div class="row-actions">
              <button class="btn btn-primary" type="submit">Create</button>
              <button class="btn" type="button" id="cancel-col-btn">Cancel</button>
            </div>
          </form>
        </div>
      </div>
      <div id="col-error"></div>
      ${cols.length === 0
        ? `<div class="empty-state">No collections yet. Create one to get started.</div>`
        : `<div class="card">
            <table class="table">
              <thead><tr><th>Name</th><th>Actions</th></tr></thead>
              <tbody>
                ${cols.map(c => `
                  <tr>
                    <td><a class="link" href="#/collections/${encodeURIComponent(c)}">${escHtml(c)}</a></td>
                    <td><a class="btn btn-sm" href="#/collections/${encodeURIComponent(c)}">Open</a></td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>`
      }
    </div>`);

  el.querySelector("#new-col-btn").addEventListener("click", () => {
    el.querySelector("#new-col-form").style.display = "";
  });
  el.querySelector("#cancel-col-btn").addEventListener("click", () => {
    el.querySelector("#new-col-form").style.display = "none";
  });
  el.querySelector("#create-col-form").addEventListener("submit", async e => {
    e.preventDefault();
    const name = new FormData(e.target).get("name");
    const errEl = el.querySelector("#col-error");
    errEl.innerHTML = "";
    try {
      // Create the collection by creating a schema placeholder
      await api.setSchema(name, { type: "object" });
      await refreshCollections();
      location.hash = `#/collections/${encodeURIComponent(name)}`;
    } catch (err) {
      errEl.innerHTML = alert(err.message);
    }
  });
}

// ── Collection view ───────────────────────────────────────────────────────────
export async function mountCollection(el, collection, params, { refreshCollections }) {
  const tab = params.tab || "documents";
  render(el, spinner());

  render(el, `
    <div class="page">
      <div class="page-header">
        <div>
          <div class="breadcrumb"><a class="link" href="#/">Collections</a> / ${escHtml(collection)}</div>
          <h1 class="page-title">${escHtml(collection)}</h1>
        </div>
      </div>
      <div class="tabs" id="col-tabs">
        <button class="tab${tab === "documents" ? " active" : ""}" data-tab="documents">Documents</button>
        <button class="tab${tab === "schema" ? " active" : ""}" data-tab="schema">Schema</button>
        <button class="tab${tab === "access" ? " active" : ""}" data-tab="access">Access</button>
      </div>
      <div id="tab-content"></div>
    </div>`);

  el.querySelector("#col-tabs").addEventListener("click", e => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    const t = btn.dataset.tab;
    location.hash = `#/collections/${encodeURIComponent(collection)}?tab=${t}`;
  });

  const content = el.querySelector("#tab-content");
  if (tab === "documents") await renderDocuments(content, collection);
  else if (tab === "schema") await renderSchema(content, collection);
  else if (tab === "access") await renderAccess(content, collection);
}

// ── Documents tab ─────────────────────────────────────────────────────────────
const PAGE_SIZE = 20;

async function renderDocuments(el, collection) {
  render(el, spinner());

  let offset = 0;
  let total = 0;

  async function load(off) {
    render(el, spinner());
    try {
      const res = await api.listDocuments(collection, PAGE_SIZE, off);
      const items = res.items ?? res.documents ?? [];
      total = res.total ?? items.length;
      offset = off;
      renderList(items, total, off);
    } catch (err) {
      render(el, alert(err.message));
    }
  }

  function renderList(items, total, off) {
    render(el, `
      <div style="margin-top:1rem">
        <div class="page-header" style="margin-bottom:.75rem">
          <span class="muted">${total} document${total !== 1 ? "s" : ""}</span>
          <button class="btn btn-primary" id="new-doc-btn">New document</button>
        </div>
        <div id="new-doc-form" class="card" style="display:none;margin-bottom:1rem">
          <div class="card-body">
            <form id="create-doc-form">
              <div class="field">
                <label class="field-label">Document ID <span class="field-hint">(leave blank to auto-generate)</span></label>
                <input class="input" name="id" placeholder="optional">
              </div>
              <div class="field">
                <label class="field-label">JSON data</label>
                <textarea class="input mono" name="data" rows="6" placeholder="{}">{}</textarea>
              </div>
              <div id="new-doc-error"></div>
              <div class="row-actions">
                <button class="btn btn-primary" type="submit">Create</button>
                <button class="btn" type="button" id="cancel-doc-btn">Cancel</button>
              </div>
            </form>
          </div>
        </div>
        <div id="doc-list-error"></div>
        ${items.length === 0
          ? `<div class="empty-state">No documents yet.</div>`
          : `<div class="card">
              <table class="table">
                <thead><tr><th>ID</th><th>Updated</th><th>Version</th></tr></thead>
                <tbody>
                  ${items.map(d => `
                    <tr class="clickable-row" data-href="#/collections/${encodeURIComponent(collection)}/${encodeURIComponent(d.id)}">
                      <td><a class="link" href="#/collections/${encodeURIComponent(collection)}/${encodeURIComponent(d.id)}">${escHtml(d.id)}</a></td>
                      <td class="muted">${fmtDate(d.updatedAt ?? d.updated_at)}</td>
                      <td class="muted">${escHtml(String(d.version ?? ""))}</td>
                    </tr>`).join("")}
                </tbody>
              </table>
            </div>
            <div class="pagination">
              <button class="btn btn-sm" id="prev-btn" ${off === 0 ? "disabled" : ""}>← Prev</button>
              <span class="muted">${off + 1}–${Math.min(off + PAGE_SIZE, total)} of ${total}</span>
              <button class="btn btn-sm" id="next-btn" ${off + PAGE_SIZE >= total ? "disabled" : ""}>Next →</button>
            </div>`
        }
      </div>`);

    el.querySelector("#new-doc-btn")?.addEventListener("click", () => {
      el.querySelector("#new-doc-form").style.display = "";
    });
    el.querySelector("#cancel-doc-btn")?.addEventListener("click", () => {
      el.querySelector("#new-doc-form").style.display = "none";
    });
    el.querySelector("#create-doc-form")?.addEventListener("submit", async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errEl = el.querySelector("#new-doc-error");
      errEl.innerHTML = "";
      let data;
      try { data = JSON.parse(fd.get("data") || "{}"); }
      catch { errEl.innerHTML = alert("Invalid JSON"); return; }
      try {
        const docId = fd.get("id")?.trim();
        if (docId) data = { ...data, id: docId };
        const res = await api.createDocument(collection, data);
        const id = res.id ?? res.document?.id;
        location.hash = `#/collections/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`;
      } catch (err) {
        errEl.innerHTML = alert(err.message);
      }
    });

    el.querySelector("#prev-btn")?.addEventListener("click", () => load(Math.max(0, off - PAGE_SIZE)));
    el.querySelector("#next-btn")?.addEventListener("click", () => load(off + PAGE_SIZE));

    // Clickable rows
    el.querySelectorAll(".clickable-row").forEach(row => {
      row.addEventListener("click", e => {
        if (e.target.tagName === "A") return;
        location.hash = row.dataset.href;
      });
    });
  }

  await load(0);
}

// ── Schema tab ────────────────────────────────────────────────────────────────
async function renderSchema(el, collection) {
  render(el, spinner());
  try {
    const schema = await api.getSchema(collection);
    render(el, `
      <div style="margin-top:1rem">
        <div class="card">
          <div class="card-header">
            <span>JSON Schema</span>
            <div class="row-actions">
              <button class="btn btn-sm btn-primary" id="save-schema-btn">Save</button>
              ${schema ? `<button class="btn btn-sm btn-danger" id="delete-schema-btn">Delete schema</button>` : ""}
            </div>
          </div>
          <div class="card-body">
            <div id="schema-error"></div>
            <textarea class="input mono" id="schema-editor" rows="20" style="width:100%">${escHtml(JSON.stringify(schema ?? {}, null, 2))}</textarea>
          </div>
        </div>
      </div>`);

    el.querySelector("#save-schema-btn").addEventListener("click", async () => {
      const errEl = el.querySelector("#schema-error");
      errEl.innerHTML = "";
      let body;
      try { body = JSON.parse(el.querySelector("#schema-editor").value); }
      catch { errEl.innerHTML = alert("Invalid JSON"); return; }
      try {
        await api.setSchema(collection, body);
        errEl.innerHTML = `<div class="alert alert-success">Schema saved.</div>`;
      } catch (err) {
        errEl.innerHTML = alert(err.message);
      }
    });

    el.querySelector("#delete-schema-btn")?.addEventListener("click", async () => {
      if (!confirm("Delete schema for this collection?")) return;
      try {
        await api.deleteSchema(collection);
        await renderSchema(el, collection);
      } catch (err) {
        el.querySelector("#schema-error").innerHTML = alert(err.message);
      }
    });
  } catch (err) {
    render(el, alert(err.message));
  }
}

// ── Access tab ────────────────────────────────────────────────────────────────
async function renderAccess(el, collection) {
  render(el, spinner());
  const resource = `collection:${collection}`;

  async function load() {
    try {
      const [perms, members, keys] = await Promise.all([
        api.listPermissions(),
        api.listMembers().catch(() => []),
        api.listKeys().catch(() => []),
      ]);
      const direct = perms.filter(p => p.resource === resource);
      const inherited = perms.filter(p => p.resource === "collection:*" || p.resource === "*");
      renderAccessTab(direct, inherited, members, keys);
    } catch (err) {
      render(el, alert(err.message));
    }
  }

  function principalLabel(principal) {
    if (principal.startsWith("member:")) {
      const uid = principal.slice(7);
      return uid;
    }
    if (principal.startsWith("key:")) {
      const kid = principal.slice(4);
      return `key:${kid}`;
    }
    return principal;
  }

  function renderAccessTab(direct, inherited, members, keys) {
    const { importPrincipalLabel } = (() => {
      function pl(p) {
        if (p.startsWith("member:")) {
          const uid = p.slice(7);
          const m = members.find(m => m.userId === uid);
          return m ? `${m.name} <${m.email}>` : p;
        }
        if (p.startsWith("key:")) {
          const kid = p.slice(4);
          const k = keys.find(k => k.id === kid);
          return k ? `key: ${k.name}` : p;
        }
        return p;
      }
      return { importPrincipalLabel: pl };
    })();

    const accessOpts = ["none", "read", "write", "admin"].map(a =>
      `<option value="${a}">${a}</option>`).join("");

    const memberOpts = [
      `<option value="*">Everyone (*)</option>`,
      `<option value="member:*">All members (member:*)</option>`,
      ...members.map(m => `<option value="member:${m.userId}">${escHtml(m.name)} &lt;${escHtml(m.email)}&gt;</option>`),
      ...keys.map(k => `<option value="key:${k.id}">key: ${escHtml(k.name)}</option>`),
    ].join("");

    render(el, `
      <div style="margin-top:1rem">
        <div class="card" style="margin-bottom:1rem">
          <div class="card-header">Grant access</div>
          <div class="card-body">
            <form id="grant-form">
              <div class="field-row">
                <div class="field">
                  <label class="field-label">Who</label>
                  <select class="input" name="principal">${memberOpts}</select>
                </div>
                <div class="field">
                  <label class="field-label">Access</label>
                  <select class="input" name="access">${accessOpts}</select>
                </div>
                <div class="field" style="align-self:flex-end">
                  <button class="btn btn-primary" type="submit">Grant</button>
                </div>
              </div>
              <div id="grant-error"></div>
            </form>
          </div>
        </div>

        <div class="card">
          <div class="card-header">Direct rules <span class="count-badge">${direct.length}</span></div>
          ${direct.length === 0
            ? `<div class="card-body"><div class="empty-state">No direct rules for this collection.</div></div>`
            : `<table class="table">
                <thead><tr><th>Principal</th><th>Access</th><th>Notes</th><th></th></tr></thead>
                <tbody>
                  ${direct.map(p => `
                    <tr>
                      <td>${escHtml(importPrincipalLabel(p.principal))}</td>
                      <td>${accessBadge(p.access)}</td>
                      <td class="muted">${notesCell(p)}</td>
                      <td><button class="btn btn-sm btn-danger" data-delete="${p.id}">Revoke</button></td>
                    </tr>`).join("")}
                </tbody>
              </table>`}
        </div>

        ${inherited.length > 0 ? `
          <div class="card" style="margin-top:1rem">
            <div class="card-header">Inherited rules</div>
            <table class="table">
              <thead><tr><th>Principal</th><th>Resource</th><th>Access</th><th>Notes</th></tr></thead>
              <tbody>
                ${inherited.map(p => `
                  <tr class="muted-row">
                    <td>${escHtml(importPrincipalLabel(p.principal))}</td>
                    <td><span class="badge badge-gray">${escHtml(p.resource)}</span></td>
                    <td>${accessBadge(p.access)}</td>
                    <td class="muted">${notesCell(p)}</td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>` : ""}
      </div>`);

    el.querySelector("#grant-form").addEventListener("submit", async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errEl = el.querySelector("#grant-error");
      errEl.innerHTML = "";
      try {
        await api.createPermission({ principal: fd.get("principal"), resource, access: fd.get("access") });
        await load();
      } catch (err) {
        errEl.innerHTML = alert(err.message);
      }
    });

    el.querySelectorAll("[data-delete]").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Revoke this permission?")) return;
        try {
          await api.deletePermission(btn.dataset.delete);
          await load();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  function accessBadge(access) {
    const map = { none: "badge-gray", read: "badge-blue", write: "badge-amber", admin: "badge-red" };
    return `<span class="badge ${map[access] ?? "badge-gray"}">${escHtml(access)}</span>`;
  }

  function notesCell(p) {
    const parts = [];
    if (p.labelFilter) parts.push(`label: ${p.labelFilter}`);
    if (p.filterExpr) parts.push(`${p.filterLang}: ${p.filterExpr.slice(0, 30)}…`);
    if (p.auditReads) parts.push("audit reads");
    if (p.auditWrites) parts.push("audit writes");
    return escHtml(parts.join(" · ") || "—");
  }

  await load();
}
