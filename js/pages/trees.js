import * as api from "../api.js";
import { render, spinner, alert, escHtml, fmtDate } from "../ui.js";

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
    render(el, alert(err.message));
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
    treeEl.innerHTML = renderNodes(nodes, "", name);
    bindTreeActions(el, name, label);
  } catch (err) {
    render(el, alert(err.message));
  }
}

function renderNodes(nodes, prefix, treeName) {
  // nodes is a flat or nested list; handle both structures
  // If nested, nodes have .children; if flat, they have .path
  const sorted = [...nodes].sort((a, b) => (a.path ?? a.name ?? "").localeCompare(b.path ?? b.name ?? ""));
  return sorted.map(node => {
    const path = node.path ?? (prefix + "/" + (node.name ?? ""));
    const hasChildren = node.children && node.children.length > 0;
    const docId = node.documentId ?? node.document_id;
    return `
      <div class="tree-node">
        <div class="tree-node-row">
          <span class="tree-node-path mono">${escHtml(path)}</span>
          ${docId ? `<a class="link muted" href="#/collections/.../${encodeURIComponent(docId)}">${escHtml(docId)}</a>` : ""}
          <div class="row-actions tree-node-actions">
            <button class="btn btn-sm" data-set-path="${escHtml(path)}">Set</button>
            <button class="btn btn-sm btn-danger" data-del-path="${escHtml(path)}">Remove</button>
          </div>
        </div>
        ${hasChildren ? `<div class="tree-children">${renderNodes(node.children, path, treeName)}</div>` : ""}
      </div>`;
  }).join("");
}

function bindTreeActions(el, treeName, label) {
  el.querySelectorAll("[data-set-path]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const path = btn.dataset.setPath;
      const docId = prompt(`Set document ID for path "${path}":`, "");
      if (docId === null) return;
      try {
        await api.setTreePath(treeName, path, docId.trim());
        await renderTree(el, treeName, label);
      } catch (err) {
        alert(err.message);
      }
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
        alert(err.message);
      }
    });
  });
}
