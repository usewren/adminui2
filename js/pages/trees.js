import * as api from "../api.js";
import { render, spinner, alert as alertHtml, escHtml, fmtDate, applyDisplayRule } from "../ui.js";

// ── Trees list (fallback overview) ───────────────────────────────────────────
export async function mountTrees(el) {
  render(el, spinner());
  try {
    const trees = await api.listTrees();
    render(el, `
      <div class="page">
        <div class="page-header">
          <h1 class="page-title">Trees</h1>
        </div>
        ${trees.length === 0
          ? `<div class="empty-state">No trees found.</div>`
          : `<div class="card">
              <table class="table">
                <thead><tr><th>Name</th><th>Actions</th></tr></thead>
                <tbody>
                  ${trees.map(t => `
                    <tr>
                      <td><a class="link" href="#/trees/${encodeURIComponent(t.name ?? t)}">${escHtml(t.name ?? t)}</a></td>
                      <td><a class="btn btn-sm" href="#/trees/${encodeURIComponent(t.name ?? t)}">Browse</a></td>
                    </tr>`).join("")}
                </tbody>
              </table>
            </div>`}
      </div>`);
  } catch (err) {
    render(el, alertHtml(err.message));
  }
}

// ── Tree file browser ────────────────────────────────────────────────────────
export async function mountTree(el, name, params) {
  const treePath = params.path || "/";
  const label = params.label || "";

  // Build breadcrumb segments
  const segments = treePath.split("/").filter(Boolean);
  const breadcrumb = [
    `<a class="link" href="#/trees/${encodeURIComponent(name)}">${escHtml(name)}:/</a>`,
    ...segments.map((seg, i) => {
      const path = "/" + segments.slice(0, i + 1).join("/");
      const isLast = i === segments.length - 1;
      return isLast
        ? `<span>${escHtml(seg)}</span>`
        : `<a class="link" href="#/trees/${encodeURIComponent(name)}?path=${encodeURIComponent(path)}">${escHtml(seg)}</a>`;
    }),
  ].join(` <span class="muted" style="margin:0 4px">›</span> `);

  render(el, `
    <div class="page">
      <div class="page-header">
        <div>
          <div class="breadcrumb"><a class="link" href="#/trees">Trees</a> / ${escHtml(name)}</div>
          <h1 class="page-title" style="font-size:1.1rem;margin-top:4px">${breadcrumb}</h1>
        </div>
        <div class="row-actions">
          <input class="input" id="label-input" placeholder="label filter" value="${escHtml(label)}" style="width:140px">
          <button class="btn btn-sm" id="label-btn">Filter</button>
        </div>
      </div>
      <div id="tree-content"></div>
    </div>`);

  el.querySelector("#label-btn").addEventListener("click", () => {
    const lbl = el.querySelector("#label-input").value.trim();
    const base = `#/trees/${encodeURIComponent(name)}?path=${encodeURIComponent(treePath)}`;
    location.hash = lbl ? `${base}&label=${encodeURIComponent(lbl)}` : base;
  });

  await renderPathView(el.querySelector("#tree-content"), name, treePath, label);
}

// ── Path view: document + children + assign ──────────────────────────────────
async function renderPathView(el, treeName, treePath, label) {
  render(el, spinner());
  try {
    // getTreeNode returns 404 for paths that don't exist yet — treat as empty
    let node;
    try { node = await api.getTreeNode(treeName, treePath); }
    catch (err) {
      if (err.status === 404) node = { path: treePath, document: null, children: [] };
      else throw err;
    }
    const doc = node.document;
    const rawChildren = node.children ?? [];

    // Group descendants into first-level children.
    // If current path is /sports and descendants are /sports/tennis/singles, /sports/tennis/doubles, /sports/football
    // → first-level children: "tennis" (folder, 2 items), "football" (has doc)
    const prefix = treePath === "/" ? "/" : treePath + "/";
    const childMap = new Map(); // segment → { path, hasDoc, documentId, descendantCount }
    for (const c of rawChildren) {
      const rel = c.path.startsWith(prefix) ? c.path.slice(prefix.length) : c.path.replace(/^\//, "");
      const segment = rel.split("/")[0];
      if (!segment) continue;
      const childPath = prefix === "/" ? "/" + segment : prefix + segment;
      if (!childMap.has(segment)) {
        // Check if this exact child path has a document (i.e. rel has no further segments)
        const isExact = !rel.includes("/");
        childMap.set(segment, { segment, path: childPath, hasDoc: isExact, documentId: isExact ? c.documentId : null, descendantCount: 1 });
      } else {
        const entry = childMap.get(segment);
        entry.descendantCount++;
        // If this exact path matches, mark it as having a doc
        if (rel === segment) { entry.hasDoc = true; entry.documentId = c.documentId; }
      }
    }
    const children = [...childMap.values()].sort((a, b) => a.segment.localeCompare(b.segment));

    let html = `<div style="margin-top:1rem">`;

    // ── Document at this path ──────────────────────────────────────────
    if (doc) {
      const data = doc.data ?? {};
      const jsonPreview = JSON.stringify(data, null, 2);
      const truncated = jsonPreview.length > 300 ? jsonPreview.slice(0, 300) + "…" : jsonPreview;
      html += `
        <div class="card" style="margin-bottom:1rem">
          <div class="card-header">
            <div class="row-actions" style="width:100%">
              <div style="flex:1">
                <strong>Document at this path</strong>
                <span class="muted" style="margin-left:.5rem;font-size:12px">${escHtml(doc.collection)} / ${escHtml(doc.id.slice(0, 12))}…</span>
                <span class="badge badge-blue" style="margin-left:.5rem">v${escHtml(String(doc.version))}</span>
              </div>
              <a class="btn btn-sm" href="#/collections/${encodeURIComponent(doc.collection)}/${encodeURIComponent(doc.id)}">Open</a>
              <button class="btn btn-sm" id="reassign-btn">Reassign</button>
              <button class="btn btn-sm btn-danger" id="unassign-btn">Unassign</button>
            </div>
          </div>
          <div class="card-body">
            <pre class="code-block" style="max-height:200px;overflow:auto;font-size:12px;margin:0">${escHtml(truncated)}</pre>
          </div>
        </div>`;
    }

    // ── Children ───────────────────────────────────────────────────────
    html += `
      <div class="card" style="margin-bottom:1rem">
        <div class="card-header">
          <div class="row-actions" style="width:100%">
            <div style="flex:1">
              <span>Contents</span>
              <span class="count-badge">${children.length}</span>
            </div>
            <button class="btn btn-sm" id="new-folder-btn">New folder</button>
            <button class="btn btn-sm btn-primary" id="add-child-doc-btn">Add document</button>
          </div>
        </div>
        <div id="new-folder-form" style="display:none;padding:12px 16px;border-bottom:1px solid var(--border,#e2e8f0)">
          <div class="field-row" style="align-items:flex-end">
            <div class="field" style="flex:1">
              <label class="field-label" style="font-size:12px">Folder name</label>
              <input class="input" id="new-folder-input" placeholder="e.g. sports, about, en" style="font-size:13px">
            </div>
            <button class="btn btn-sm btn-primary" id="new-folder-go">Create</button>
            <button class="btn btn-sm" id="new-folder-cancel">Cancel</button>
          </div>
        </div>
        <div id="add-child-doc-form" style="display:none;padding:12px 16px;border-bottom:1px solid var(--border,#e2e8f0)">
          <div class="field" style="margin-bottom:.5rem">
            <label class="field-label" style="font-size:12px">Path segment <span class="field-hint">(e.g. index, about)</span></label>
            <input class="input" id="add-child-name-input" placeholder="segment name" style="font-size:13px">
          </div>
          <div id="add-child-picker-container"></div>
          <div style="margin-top:.5rem">
            <button class="btn btn-sm" id="add-child-cancel">Cancel</button>
          </div>
        </div>`;

    if (children.length > 0) {
      html += `<table class="table" style="font-size:13px">
        <thead><tr><th>Name</th><th>Info</th><th></th></tr></thead>
        <tbody>
          ${children.map(c => {
            const childHref = `#/trees/${encodeURIComponent(treeName)}?path=${encodeURIComponent(c.path)}`;
            const isFolder = c.descendantCount > 1 || !c.hasDoc;
            const icon = isFolder ? "📁" : "📄";
            const info = c.hasDoc
              ? `<span class="mono" style="font-size:11px">${escHtml(c.documentId?.slice(0, 12) ?? "")}…</span>`
              : `<span class="muted" style="font-size:11px">${c.descendantCount > 1 ? c.descendantCount + " items" : "empty"}</span>`;
            return `<tr class="clickable-row" data-href="${childHref}">
              <td><a class="link" href="${childHref}">${icon} ${escHtml(c.segment)}${isFolder ? "/" : ""}</a></td>
              <td>${info}</td>
              <td style="text-align:right"><span class="muted" style="font-size:11px">→</span></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>`;
    } else {
      html += `<div class="card-body"><div class="empty-state">No children at this path.</div></div>`;
    }

    html += `</div>`;

    // ── Assign document (shown if no doc, or toggled via Reassign) ────
    if (!doc) {
      html += `
        <div class="card" id="assign-card">
          <div class="card-header">Assign document to <code>${escHtml(treePath)}</code></div>
          <div class="card-body" id="picker-container"></div>
        </div>`;
    } else {
      html += `
        <div class="card" id="assign-card" style="display:none">
          <div class="card-header">
            <span>Reassign document at <code>${escHtml(treePath)}</code></span>
            <button class="btn btn-sm" id="cancel-reassign-btn">Cancel</button>
          </div>
          <div class="card-body" id="picker-container"></div>
        </div>`;
    }

    html += `</div>`;
    render(el, html);

    // ── Wire up interactions ──────────────────────────────────────────

    // Clickable rows
    el.querySelectorAll(".clickable-row").forEach(row => {
      row.addEventListener("click", e => {
        if (e.target.tagName === "A") return;
        location.hash = row.dataset.href;
      });
    });

    // New folder
    el.querySelector("#new-folder-btn")?.addEventListener("click", () => {
      const form = el.querySelector("#new-folder-form");
      form.style.display = "";
      el.querySelector("#new-folder-input").focus();
    });
    el.querySelector("#new-folder-cancel")?.addEventListener("click", () => {
      el.querySelector("#new-folder-form").style.display = "none";
      el.querySelector("#new-folder-input").value = "";
    });
    el.querySelector("#new-folder-go")?.addEventListener("click", async () => {
      const seg = el.querySelector("#new-folder-input").value.trim().replace(/^\/+|\/+$/g, "");
      if (!seg) return;
      const childPath = (treePath === "/" ? "" : treePath) + "/" + seg;
      try {
        // Create the empty folder on the server (PUT with no documentId)
        await api.setTreePath(treeName, childPath);
        location.hash = `#/trees/${encodeURIComponent(treeName)}?path=${encodeURIComponent(childPath)}`;
      } catch (err) {
        window.alert(err.message);
      }
    });
    el.querySelector("#new-folder-input")?.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); el.querySelector("#new-folder-go").click(); }
    });

    // Add document as a child at a new path
    el.querySelector("#add-child-doc-btn")?.addEventListener("click", () => {
      const form = el.querySelector("#add-child-doc-form");
      form.style.display = "";
      const nameInput = el.querySelector("#add-child-name-input");
      nameInput.focus();
      // Mount a picker with a callback that derives the child path from either
      // the user's typed segment or the doc's filename/display/id.
      const pickerContainer = el.querySelector("#add-child-picker-container");
      mountDocPicker(pickerContainer, treePath, treeName, label, el, {
        getPath: (doc, displayRule) => {
          let seg = nameInput.value.trim().replace(/^\/+|\/+$/g, "");
          if (!seg) seg = deriveSegmentName(doc, displayRule);
          if (!seg) {
            nameInput.focus();
            window.alert("Enter a path segment or pick a document with a filename");
            return null;
          }
          return (treePath === "/" ? "" : treePath) + "/" + seg;
        },
      });
    });
    el.querySelector("#add-child-cancel")?.addEventListener("click", () => {
      el.querySelector("#add-child-doc-form").style.display = "none";
      el.querySelector("#add-child-name-input").value = "";
      el.querySelector("#add-child-picker-container").innerHTML = "";
    });

    // Unassign document (keep path as empty folder)
    el.querySelector("#unassign-btn")?.addEventListener("click", async () => {
      if (!confirm(`Unassign document from "${treePath}"? The path will remain as an empty folder.`)) return;
      try {
        await api.setTreePath(treeName, treePath); // PUT with no documentId → clears document
        await renderPathView(el, treeName, treePath, label);
      } catch (err) {
        window.alert(err.message);
      }
    });

    // Reassign toggle
    el.querySelector("#reassign-btn")?.addEventListener("click", () => {
      const card = el.querySelector("#assign-card");
      card.style.display = "";
      mountDocPicker(el.querySelector("#picker-container"), treePath, treeName, label, el);
    });
    el.querySelector("#cancel-reassign-btn")?.addEventListener("click", () => {
      el.querySelector("#assign-card").style.display = "none";
      el.querySelector("#picker-container").innerHTML = "";
    });

    // Auto-mount picker if no doc
    if (!doc) {
      mountDocPicker(el.querySelector("#picker-container"), treePath, treeName, label, el);
    }

  } catch (err) {
    render(el, alertHtml(err.message));
  }
}

// Sanitize a string for use as a URL path segment
function sanitizeSegment(s) {
  return String(s).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

// Derive a child segment name from document data
// Priority: filename (binary) → display rule → id prefix
function deriveSegmentName(doc, displayRule) {
  if (!doc) return "";
  const data = doc.data ?? {};
  if (data.filename) return sanitizeSegment(data.filename);
  if (displayRule) {
    const name = applyDisplayRule(displayRule, data);
    if (name) return sanitizeSegment(name);
  }
  return doc.id ? doc.id.slice(0, 8) : "";
}

// ── DocPicker: Browse / Create New / Direct ID ───────────────────────────────
// options.getPath(doc) — optional callback returning the target path dynamically.
//                       receives the full doc object so filename/name can be used.
async function mountDocPicker(el, path, treeName, label, treeContainer, options = {}) {
  let pickerTab = "browse";
  let selectedCollection = "";
  let collections = [];
  let collectionDocs = [];
  let collectionSchema = null;

  async function loadCollections() {
    try { collections = await api.listCollections(); } catch { collections = []; }
  }

  async function loadDocs(col) {
    try {
      const res = await api.listDocuments(col, 50, 0);
      collectionDocs = res.items ?? res.documents ?? [];
      collectionSchema = await api.getSchema(col).catch(() => null);
    } catch {
      collectionDocs = [];
      collectionSchema = null;
    }
  }

  async function assignDoc(docId, doc) {
    try {
      // Compute target path: either from options.getPath callback, or use the fixed path
      let targetPath = path;
      if (options.getPath) {
        const resolvedDoc = doc ?? { id: docId, data: {} };
        targetPath = options.getPath(resolvedDoc, collectionSchema?.displayName);
        if (!targetPath) return;
      }
      await api.setTreePath(treeName, targetPath, docId);
      // After a child assignment (getPath mode), reload the parent path so the new child shows up.
      // For direct assignments, reload the same path.
      const reloadPath = options.getPath ? path : targetPath;
      await renderPathView(treeContainer, treeName, reloadPath, label);
    } catch (err) {
      window.alert(err.message);
    }
  }

  function renderPicker() {
    const colOptions = collections.map(c => {
      const n = c.name ?? c;
      return `<option value="${escHtml(n)}" ${n === selectedCollection ? "selected" : ""}>${escHtml(n)}</option>`;
    }).join("");

    const displayRule = collectionSchema?.displayName ?? null;

    const docRows = collectionDocs.length === 0
      ? `<div class="empty-state" style="padding:.75rem">No documents found.</div>`
      : `<table class="table" style="font-size:13px">
          <thead><tr><th>ID</th><th>Name</th><th></th></tr></thead>
          <tbody>
            ${collectionDocs.map(d => {
              const displayName = displayRule ? applyDisplayRule(displayRule, d.data) : null;
              return `<tr>
                <td class="mono" style="font-size:11px">${escHtml(d.id.slice(0, 12))}…</td>
                <td>${displayName ? escHtml(displayName) : `<span class="muted">—</span>`}</td>
                <td><button class="btn btn-sm btn-primary" data-pick-doc="${escHtml(d.id)}">Select</button></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>`;

    el.innerHTML = `
      <div class="tabs" id="picker-tabs" style="margin-bottom:.75rem">
        <button class="tab${pickerTab === "browse" ? " active" : ""}" data-picker-tab="browse">Browse</button>
        <button class="tab${pickerTab === "create" ? " active" : ""}" data-picker-tab="create">Create new</button>
        <button class="tab${pickerTab === "direct" ? " active" : ""}" data-picker-tab="direct">Direct ID</button>
      </div>
      <div id="picker-body">
        ${pickerTab === "browse" ? `
          <div class="field" style="margin-bottom:.5rem">
            <select class="input" id="picker-col-select" style="font-size:13px">
              <option value="">— select collection —</option>
              ${colOptions}
            </select>
          </div>
          <div id="picker-doc-list">
            ${selectedCollection ? docRows : `<div class="empty-state" style="padding:.75rem">Select a collection above.</div>`}
          </div>
        ` : pickerTab === "create" ? `
          <div class="field" style="margin-bottom:.5rem">
            <select class="input" id="picker-create-col" style="font-size:13px">
              <option value="">— select collection —</option>
              ${colOptions}
            </select>
          </div>
          <div class="field" style="margin-bottom:.5rem">
            <textarea class="input mono" id="picker-create-json" rows="6" style="width:100%;font-size:13px" placeholder='{&#10;  "title": "New document"&#10;}'>{}</textarea>
          </div>
          <div id="picker-create-error"></div>
          <button class="btn btn-sm btn-primary" id="picker-create-btn">Create &amp; assign</button>
        ` : `
          <form id="picker-direct-form">
            <div class="field-row">
              <div class="field" style="flex:1">
                <input class="input" id="picker-direct-id" placeholder="Document ID" style="font-size:13px">
              </div>
              <div class="field" style="align-self:flex-end">
                <button class="btn btn-primary btn-sm" type="submit">Set</button>
              </div>
            </div>
          </form>
        `}
      </div>`;

    // Tab switching
    el.querySelectorAll("[data-picker-tab]").forEach(btn => {
      btn.addEventListener("click", () => {
        pickerTab = btn.dataset.pickerTab;
        renderPicker();
      });
    });

    // Browse tab: collection select
    el.querySelector("#picker-col-select")?.addEventListener("change", async e => {
      selectedCollection = e.target.value;
      if (selectedCollection) {
        el.querySelector("#picker-doc-list").innerHTML = spinner();
        await loadDocs(selectedCollection);
      } else {
        collectionDocs = [];
        collectionSchema = null;
      }
      renderPicker();
    });

    // Browse tab: pick doc — pass the full doc so getPath can use its data
    el.querySelectorAll("[data-pick-doc]").forEach(btn => {
      btn.addEventListener("click", () => {
        const docId = btn.dataset.pickDoc;
        const doc = collectionDocs.find(d => d.id === docId);
        assignDoc(docId, doc);
      });
    });

    // Create tab: create & assign
    el.querySelector("#picker-create-btn")?.addEventListener("click", async () => {
      const col = el.querySelector("#picker-create-col")?.value;
      const errEl = el.querySelector("#picker-create-error");
      errEl.innerHTML = "";
      if (!col) { errEl.innerHTML = alertHtml("Select a collection"); return; }
      let data;
      try { data = JSON.parse(el.querySelector("#picker-create-json").value); }
      catch { errEl.innerHTML = alertHtml("Invalid JSON"); return; }
      try {
        const doc = await api.createDocument(col, data);
        await assignDoc(doc.id, doc);
      } catch (err) {
        errEl.innerHTML = alertHtml(err.message);
      }
    });

    // Direct ID tab
    el.querySelector("#picker-direct-form")?.addEventListener("submit", async e => {
      e.preventDefault();
      const docId = el.querySelector("#picker-direct-id").value.trim();
      if (!docId) return;
      await assignDoc(docId);
    });
  }

  el.innerHTML = spinner();
  await loadCollections();
  renderPicker();
}
