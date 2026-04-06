import * as api from "../api.js";
import { render, spinner, alert as alertHtml, escHtml, fmtDate, applyDisplayRule } from "../ui.js";

// ── Trees list ────────────────────────────────────────────────────────────────
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

// ── Tree browser ──────────────────────────────────────────────────────────────
export async function mountTree(el, name, params) {
  const label = params.label || "";
  render(el, `
    <div class="page">
      <div class="page-header">
        <div>
          <div class="breadcrumb"><a class="link" href="#/trees">Trees</a> / ${escHtml(name)}</div>
          <h1 class="page-title">${escHtml(name)}</h1>
        </div>
        <div class="row-actions">
          <input class="input" id="label-input" placeholder="label (optional)" value="${escHtml(label)}" style="width:160px">
          <button class="btn btn-sm" id="label-btn">Filter</button>
        </div>
      </div>
      <div id="tree-content"></div>
    </div>`);

  el.querySelector("#label-btn").addEventListener("click", () => {
    const lbl = el.querySelector("#label-input").value.trim();
    location.hash = `#/trees/${encodeURIComponent(name)}${lbl ? `?label=${encodeURIComponent(lbl)}` : ""}`;
  });

  await renderTree(el.querySelector("#tree-content"), name, label);
}

async function renderTree(el, name, label) {
  render(el, spinner());
  try {
    const nodes = await api.getFullTree(name, label || undefined);
    if (!nodes || nodes.length === 0) {
      render(el, `<div class="empty-state">Tree is empty.</div>`);
      return;
    }
    render(el, `
      <div class="card">
        <div class="card-body">
          <div class="tree-view" id="tree-view"></div>
        </div>
      </div>`);
    const treeEl = el.querySelector("#tree-view");
    treeEl.innerHTML = renderNodes(nodes, "");
    bindTreeActions(el, name, label);
  } catch (err) {
    render(el, alertHtml(err.message));
  }
}

function renderNodes(nodes, prefix) {
  const sorted = [...nodes].sort((a, b) => (a.path ?? a.name ?? "").localeCompare(b.path ?? b.name ?? ""));
  return sorted.map(node => {
    const path = node.path ?? (prefix + "/" + (node.name ?? ""));
    const hasChildren = node.children && node.children.length > 0;
    const docId = node.documentId ?? node.document_id;
    return `
      <div class="tree-node" data-tree-path="${escHtml(path)}">
        <div class="tree-node-row">
          <span class="tree-node-path mono">${escHtml(path)}</span>
          ${docId ? `<span class="muted mono" style="font-size:11px">${escHtml(docId)}</span>` : ""}
          <div class="row-actions tree-node-actions">
            <button class="btn btn-sm" data-set-path="${escHtml(path)}">Set doc</button>
            <button class="btn btn-sm btn-danger" data-del-path="${escHtml(path)}">Remove</button>
          </div>
        </div>
        <div class="doc-picker" id="picker-${CSS.escape(path)}" style="display:none"></div>
        ${hasChildren ? `<div class="tree-children">${renderNodes(node.children, path)}</div>` : ""}
      </div>`;
  }).join("");
}

function bindTreeActions(el, treeName, label) {
  el.querySelectorAll("[data-set-path]").forEach(btn => {
    btn.addEventListener("click", () => {
      const path = btn.dataset.setPath;
      const pickerId = `picker-${CSS.escape(path)}`;
      const pickerEl = el.querySelector(`#${pickerId}`);
      if (!pickerEl) return;

      // Toggle: close if already open
      if (pickerEl.style.display !== "none") {
        pickerEl.style.display = "none";
        pickerEl.innerHTML = "";
        return;
      }

      // Close any other open pickers
      el.querySelectorAll(".doc-picker").forEach(p => {
        p.style.display = "none";
        p.innerHTML = "";
      });

      pickerEl.style.display = "";
      mountDocPicker(pickerEl, path, treeName, label, el);
    });
  });

  el.querySelectorAll("[data-del-path]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const path = btn.dataset.delPath;
      if (!confirm(`Remove path "${path}" from tree?`)) return;
      try {
        await api.deleteTreePath(treeName, path);
        await renderTree(el, treeName, label);
      } catch (err) {
        window.alert(err.message);
      }
    });
  });
}

// ── DocPicker ─────────────────────────────────────────────────────────────────
async function mountDocPicker(el, path, treeName, label, treeContainer) {
  let pickerTab = "browse";
  let selectedCollection = "";
  let collections = [];
  let collectionDocs = [];
  let collectionSchema = null;

  async function loadCollections() {
    try {
      collections = await api.listCollections();
    } catch {
      collections = [];
    }
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

  async function setDoc(docId) {
    try {
      await api.setTreePath(treeName, path, docId);
      el.style.display = "none";
      el.innerHTML = "";
      await renderTree(treeContainer, treeName, label);
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
                <td class="mono" style="font-size:11px">${escHtml(d.id)}</td>
                <td>${displayName ? escHtml(displayName) : `<span class="muted">—</span>`}</td>
                <td><button class="btn btn-sm btn-primary" data-pick-doc="${escHtml(d.id)}">Select</button></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>`;

    el.innerHTML = `
      <div class="doc-picker-inner">
        <div class="doc-picker-header">
          <span class="doc-picker-title">Set document for <code>${escHtml(path)}</code></span>
          <button class="doc-picker-close" id="picker-close">✕</button>
        </div>
        <div class="doc-picker-tabs">
          <button class="doc-picker-tab${pickerTab === "browse" ? " active" : ""}" data-picker-tab="browse">Browse</button>
          <button class="doc-picker-tab${pickerTab === "direct" ? " active" : ""}" data-picker-tab="direct">Direct ID</button>
        </div>
        <div class="doc-picker-body">
          ${pickerTab === "browse" ? `
            <div class="field-row" style="margin-bottom:.5rem">
              <div class="field" style="flex:1">
                <select class="input" id="picker-col-select" style="font-size:13px">
                  <option value="">— select collection —</option>
                  ${colOptions}
                </select>
              </div>
            </div>
            <div id="picker-doc-list">
              ${selectedCollection ? (collectionDocs.length === 0 && !collectionSchema ? `<div class="loading"><span class="spinner"></span></div>` : docRows) : `<div class="empty-state" style="padding:.75rem">Select a collection above.</div>`}
            </div>
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
        </div>
      </div>`;

    el.querySelector("#picker-close").addEventListener("click", () => {
      el.style.display = "none";
      el.innerHTML = "";
    });

    el.querySelectorAll(".doc-picker-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        pickerTab = btn.dataset.pickerTab;
        renderPicker();
      });
    });

    el.querySelector("#picker-col-select")?.addEventListener("change", async e => {
      selectedCollection = e.target.value;
      if (selectedCollection) {
        el.querySelector("#picker-doc-list").innerHTML = `<div class="loading"><span class="spinner"></span> Loading…</div>`;
        await loadDocs(selectedCollection);
      } else {
        collectionDocs = [];
        collectionSchema = null;
      }
      renderPicker();
    });

    el.querySelectorAll("[data-pick-doc]").forEach(btn => {
      btn.addEventListener("click", () => setDoc(btn.dataset.pickDoc));
    });

    el.querySelector("#picker-direct-form")?.addEventListener("submit", async e => {
      e.preventDefault();
      const docId = el.querySelector("#picker-direct-id").value.trim();
      if (!docId) return;
      await setDoc(docId);
    });
  }

  el.innerHTML = `<div class="loading" style="padding:.5rem"><span class="spinner"></span> Loading…</div>`;
  await loadCollections();
  renderPicker();
}
