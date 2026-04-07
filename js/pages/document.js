import * as api from "../api.js";
import { render, spinner, alert as alertHtml, escHtml, fmtDate, fmtBytes } from "../ui.js";

export async function mountDocument(el, collection, id, params) {
  const tab = params.tab || "view";
  render(el, spinner());

  // Load schema to detect binary collections
  let isBinary = false;
  try {
    const schema = await api.getSchema(collection);
    isBinary = schema?.collectionType === "binary";
  } catch { /* ignore */ }

  render(el, `
    <div class="page">
      <div class="page-header">
        <div>
          <div class="breadcrumb">
            <a class="link" href="#/">Collections</a> /
            <a class="link" href="#/collections/${encodeURIComponent(collection)}">${escHtml(collection)}</a> /
            ${escHtml(id)}
          </div>
          <h1 class="page-title mono">${escHtml(id)}</h1>
        </div>
        <button class="btn btn-danger" id="delete-doc-btn">Delete</button>
      </div>
      <div class="tabs" id="doc-tabs">
        <button class="tab${tab === "view" ? " active" : ""}" data-tab="view">${isBinary ? "Asset" : "Document"}</button>
        <button class="tab${tab === "history" ? " active" : ""}" data-tab="history">History</button>
        <button class="tab${tab === "labels" ? " active" : ""}" data-tab="labels">Labels</button>
        <button class="tab${tab === "paths" ? " active" : ""}" data-tab="paths">Paths</button>
      </div>
      <div id="tab-content"></div>
    </div>`);

  el.querySelector("#doc-tabs").addEventListener("click", e => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    location.hash = `#/collections/${encodeURIComponent(collection)}/${encodeURIComponent(id)}?tab=${btn.dataset.tab}`;
  });

  el.querySelector("#delete-doc-btn").addEventListener("click", async () => {
    if (!confirm(`Delete document "${id}" permanently?`)) return;
    try {
      await api.deleteDocument(collection, id);
      location.hash = `#/collections/${encodeURIComponent(collection)}`;
    } catch (err) {
      window.alert(err.message);
    }
  });

  const content = el.querySelector("#tab-content");
  if (tab === "view") {
    if (isBinary) await renderAsset(content, collection, id);
    else await renderView(content, collection, id);
  } else if (tab === "history") await renderHistory(content, collection, id, isBinary);
  else if (tab === "labels") await renderLabels(content, collection, id);
  else if (tab === "paths") await renderPaths(content, collection, id);
}

// ── Asset tab (binary collections) ───────────────────────────────────────────
async function renderAsset(el, collection, id) {
  render(el, spinner());
  try {
    const doc = await api.getDocument(collection, id);
    const data = doc.data ?? doc.document?.data ?? doc;
    const version = doc.version ?? doc.document?.version;
    const filename = data.filename ?? id;
    const mimeType = data.mimeType ?? data.contentType ?? "";
    const size = data.size;
    const rawUrl = api.assetUrl(collection, id);

    const preview = renderAssetPreview(rawUrl, mimeType, filename);

    render(el, `
      <div style="margin-top:1rem">
        <div class="card" style="margin-bottom:1rem">
          <div class="card-header">
            <div class="row-actions">
              <div>
                <strong>${escHtml(filename)}</strong>
                ${mimeType ? `<span class="muted" style="margin-left:.5rem">${escHtml(mimeType)}</span>` : ""}
                ${size != null ? `<span class="muted" style="margin-left:.5rem">${fmtBytes(size)}</span>` : ""}
                <span class="muted" style="margin-left:.5rem">v${escHtml(String(version ?? ""))}</span>
              </div>
              <a class="btn btn-sm btn-primary" href="${escHtml(rawUrl)}" download="${escHtml(filename)}" target="_blank">Download</a>
            </div>
          </div>
          <div class="card-body" style="padding:1rem">
            ${preview}
          </div>
        </div>

        <div class="card">
          <div class="card-header">Replace file</div>
          <div class="card-body">
            <div id="replace-error"></div>
            <form id="replace-form">
              <div class="field-row">
                <div class="field">
                  <label class="field-label">New file</label>
                  <input class="input" type="file" name="file" required>
                </div>
                <div class="field" style="align-self:flex-end">
                  <button class="btn btn-primary" type="submit">Upload</button>
                </div>
              </div>
            </form>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="row-actions">
              <span>Metadata</span>
              <button class="btn btn-sm btn-primary" id="meta-save-btn">Save</button>
            </div>
          </div>
          <div class="card-body">
            <div id="meta-error"></div>
            <textarea class="input mono" id="meta-editor" rows="10" style="width:100%">${escHtml(JSON.stringify(data, null, 2))}</textarea>
          </div>
        </div>
      </div>`);

    el.querySelector("#replace-form").addEventListener("submit", async e => {
      e.preventDefault();
      const errEl = el.querySelector("#replace-error");
      errEl.innerHTML = "";
      const file = e.target.file.files[0];
      if (!file) return;
      try {
        await api.updateAsset(collection, id, file);
        errEl.innerHTML = `<div class="alert alert-success">File replaced successfully.</div>`;
        await renderAsset(el, collection, id);
      } catch (err) {
        errEl.innerHTML = alertHtml(err.message);
      }
    });

    el.querySelector("#meta-save-btn").addEventListener("click", async () => {
      const errEl = el.querySelector("#meta-error");
      errEl.innerHTML = "";
      let body;
      try { body = JSON.parse(el.querySelector("#meta-editor").value); }
      catch { errEl.innerHTML = alertHtml("Invalid JSON"); return; }
      try {
        await api.updateDocument(collection, id, body);
        errEl.innerHTML = `<div class="alert alert-success">Saved.</div>`;
      } catch (err) {
        errEl.innerHTML = alertHtml(err.message);
      }
    });
  } catch (err) {
    render(el, alertHtml(err.message));
  }
}

function renderAssetPreview(url, mimeType, filename) {
  if (!mimeType) return `<a class="link" href="${escHtml(url)}" target="_blank">${escHtml(filename)}</a>`;
  if (mimeType.startsWith("image/")) {
    return `<img src="${escHtml(url)}" alt="${escHtml(filename)}" style="max-width:100%;max-height:480px;display:block;border-radius:4px">`;
  }
  if (mimeType.startsWith("video/")) {
    return `<video controls style="max-width:100%;max-height:360px;display:block"><source src="${escHtml(url)}" type="${escHtml(mimeType)}">Your browser does not support video.</video>`;
  }
  if (mimeType.startsWith("audio/")) {
    return `<audio controls style="width:100%"><source src="${escHtml(url)}" type="${escHtml(mimeType)}">Your browser does not support audio.</audio>`;
  }
  if (mimeType === "application/pdf") {
    return `<iframe src="${escHtml(url)}" style="width:100%;height:500px;border:none;border-radius:4px"></iframe>`;
  }
  if (mimeType.startsWith("text/")) {
    return `<div id="text-preview"><span class="muted">Loading…</span></div>
      <script>
        fetch(${JSON.stringify(url)}, {credentials:"include"})
          .then(r=>r.text())
          .then(t=>{ document.getElementById("text-preview").innerHTML = '<pre class="code-block" style="max-height:400px;overflow:auto">' + t.replace(/&/g,"&amp;").replace(/</g,"&lt;") + '</pre>'; })
          .catch(()=>{ document.getElementById("text-preview").textContent = "Could not load preview."; });
      </script>`;
  }
  return `<a class="btn btn-sm btn-primary" href="${escHtml(url)}" download="${escHtml(filename)}" target="_blank">Download ${escHtml(filename)}</a>`;
}

// ── View / edit tab ───────────────────────────────────────────────────────────
async function renderView(el, collection, id) {
  render(el, spinner());
  try {
    const doc = await api.getDocument(collection, id);
    const data = doc.data ?? doc.document?.data ?? doc;

    // Fall back to data-level binary detection (catches collections that have no schema set)
    if (data?._binary === true) {
      // Relabel the tab so it reads "Asset" not "Document"
      const viewTab = document.querySelector(".tab[data-tab='view']");
      if (viewTab) viewTab.textContent = "Asset";
      await renderAsset(el, collection, id);
      return;
    }
    render(el, `
      <div style="margin-top:1rem" class="card">
        <div class="card-header">
          <div class="row-actions">
            <span class="muted">Version ${escHtml(String(doc.version ?? doc.document?.version ?? ""))}</span>
            <button class="btn btn-sm btn-primary" id="save-btn">Save</button>
          </div>
        </div>
        <div class="card-body">
          <div id="view-error"></div>
          <textarea class="input mono" id="doc-editor" rows="24" style="width:100%">${escHtml(JSON.stringify(data, null, 2))}</textarea>
        </div>
      </div>`);

    el.querySelector("#save-btn").addEventListener("click", async () => {
      const errEl = el.querySelector("#view-error");
      errEl.innerHTML = "";
      let body;
      try { body = JSON.parse(el.querySelector("#doc-editor").value); }
      catch { errEl.innerHTML = alertHtml("Invalid JSON"); return; }
      try {
        await api.updateDocument(collection, id, body);
        errEl.innerHTML = `<div class="alert alert-success">Saved.</div>`;
        await renderView(el, collection, id);
      } catch (err) {
        errEl.innerHTML = alertHtml(err.message);
      }
    });
  } catch (err) {
    render(el, alertHtml(err.message));
  }
}

// ── History tab ───────────────────────────────────────────────────────────────
async function renderHistory(el, collection, id, isBinary = false) {
  render(el, spinner());
  try {
    const res = await api.listVersions(collection, id);
    const versions = res.versions ?? res;

    let diffMode = false;

    function renderVersionList() {
      render(el, `
        <div style="margin-top:1rem">
          <div class="page-header" style="margin-bottom:.75rem">
            <span class="muted">${versions.length} version${versions.length !== 1 ? "s" : ""}</span>
            ${!isBinary ? `<button class="btn btn-sm" id="diff-toggle-btn">${diffMode ? "Cancel diff" : "Compare versions"}</button>` : ""}
          </div>
          ${!isBinary && diffMode ? `
            <div class="card" style="margin-bottom:1rem">
              <div class="card-body">
                <div class="field-row">
                  <div class="field">
                    <label class="field-label">From version</label>
                    <select class="input" id="v1-sel">
                      ${versions.map(v => `<option value="${v.version}">${v.version} — ${fmtDate(v.createdAt ?? v.created_at)}</option>`).join("")}
                    </select>
                  </div>
                  <div class="field">
                    <label class="field-label">To version</label>
                    <select class="input" id="v2-sel">
                      ${versions.map(v => `<option value="${v.version}">${v.version} — ${fmtDate(v.createdAt ?? v.created_at)}</option>`).join("")}
                    </select>
                  </div>
                  <div class="field" style="align-self:flex-end">
                    <button class="btn btn-primary" id="diff-btn">Show diff</button>
                  </div>
                </div>
                <div id="diff-output"></div>
              </div>
            </div>` : ""}
          <div class="card">
            <div class="timeline">
              ${versions.map(v => `
                <div class="timeline-item">
                  <div class="timeline-dot"></div>
                  <div class="timeline-body">
                    <div class="timeline-header">
                      <strong>v${escHtml(String(v.version))}</strong>
                      <span class="muted">${fmtDate(v.createdAt ?? v.created_at)}</span>
                    </div>
                    <div class="row-actions" style="margin-top:.5rem">
                      ${isBinary
                        ? `<a class="btn btn-sm" href="${escHtml(api.assetUrl(collection, id, v.version))}" target="_blank" download>Download v${escHtml(String(v.version))}</a>`
                        : `<button class="btn btn-sm" data-view-ver="${v.version}">View</button>`}
                      <button class="btn btn-sm btn-danger" data-rollback="${v.version}">Rollback here</button>
                    </div>
                    ${!isBinary ? `<div class="ver-preview" id="ver-preview-${v.version}" style="display:none"></div>` : ""}
                  </div>
                </div>`).join("")}
            </div>
          </div>
        </div>`);

      el.querySelector("#diff-toggle-btn")?.addEventListener("click", () => {
        diffMode = !diffMode;
        renderVersionList();
      });

      el.querySelector("#diff-btn")?.addEventListener("click", async () => {
        const v1 = el.querySelector("#v1-sel").value;
        const v2 = el.querySelector("#v2-sel").value;
        const out = el.querySelector("#diff-output");
        out.innerHTML = spinner();
        try {
          const diff = await api.diffVersions(collection, id, v1, v2);
          out.innerHTML = `<pre class="diff-output">${escHtml(JSON.stringify(diff, null, 2))}</pre>`;
        } catch (err) {
          out.innerHTML = alertHtml(err.message);
        }
      });

      el.querySelectorAll("[data-view-ver]").forEach(btn => {
        btn.addEventListener("click", async () => {
          const v = btn.dataset.viewVer;
          const preview = el.querySelector(`#ver-preview-${v}`);
          if (preview.style.display === "none") {
            preview.innerHTML = spinner();
            preview.style.display = "";
            try {
              const verDoc = await api.getVersion(collection, id, v);
              const data = verDoc.data ?? verDoc.document?.data ?? verDoc;
              preview.innerHTML = `<pre class="code-block">${escHtml(JSON.stringify(data, null, 2))}</pre>`;
            } catch (err) {
              preview.innerHTML = alertHtml(err.message);
            }
          } else {
            preview.style.display = "none";
          }
        });
      });

      el.querySelectorAll("[data-rollback]").forEach(btn => {
        btn.addEventListener("click", async () => {
          const v = btn.dataset.rollback;
          if (!confirm(`Roll back to version ${v}?`)) return;
          try {
            await api.rollback(collection, id, v);
            location.hash = `#/collections/${encodeURIComponent(collection)}/${encodeURIComponent(id)}?tab=history`;
            renderHistory(el, collection, id, isBinary);
          } catch (err) {
            window.alert(err.message);
          }
        });
      });
    }

    renderVersionList();
  } catch (err) {
    render(el, alertHtml(err.message));
  }
}

// ── Labels tab ────────────────────────────────────────────────────────────────
async function renderLabels(el, collection, id) {
  render(el, spinner());
  try {
    const res = await api.listVersions(collection, id);
    const versions = res.versions ?? res;

    render(el, `
      <div style="margin-top:1rem">
        <div class="card" style="margin-bottom:1rem">
          <div class="card-header">Set label</div>
          <div class="card-body">
            <form id="label-form">
              <div class="field-row">
                <div class="field">
                  <label class="field-label">Label name</label>
                  <input class="input" name="label" placeholder="e.g. stable" required>
                </div>
                <div class="field">
                  <label class="field-label">Version <span class="field-hint">(blank = current)</span></label>
                  <select class="input" name="version">
                    <option value="">Current</option>
                    ${versions.map(v => `<option value="${v.version}">v${v.version} — ${fmtDate(v.createdAt ?? v.created_at)}</option>`).join("")}
                  </select>
                </div>
                <div class="field" style="align-self:flex-end">
                  <button class="btn btn-primary" type="submit">Set label</button>
                </div>
              </div>
              <div id="label-error"></div>
            </form>
          </div>
        </div>
      </div>`);

    el.querySelector("#label-form").addEventListener("submit", async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const label = fd.get("label");
      const version = fd.get("version") ? Number(fd.get("version")) : undefined;
      const errEl = el.querySelector("#label-error");
      errEl.innerHTML = "";
      try {
        await api.setLabel(collection, id, label, version);
        errEl.innerHTML = `<div class="alert alert-success">Label "${label}" set.</div>`;
      } catch (err) {
        errEl.innerHTML = alertHtml(err.message);
      }
    });
  } catch (err) {
    render(el, alertHtml(err.message));
  }
}

// ── Paths tab ─────────────────────────────────────────────────────────────────
async function renderPaths(el, collection, id) {
  render(el, spinner());
  try {
    const res = await api.listPaths(collection, id);
    const paths = res.paths ?? res;
    render(el, `
      <div style="margin-top:1rem" class="card">
        <div class="card-header">Tree paths referencing this document</div>
        ${paths.length === 0
          ? `<div class="card-body"><div class="empty-state">This document is not referenced in any tree.</div></div>`
          : `<table class="table">
              <thead><tr><th>Tree</th><th>Path</th></tr></thead>
              <tbody>
                ${paths.map(p => `
                  <tr>
                    <td><a class="link" href="#/trees/${encodeURIComponent(p.tree)}">${escHtml(p.tree)}</a></td>
                    <td class="mono">${escHtml(p.path)}</td>
                  </tr>`).join("")}
              </tbody>
            </table>`}
      </div>`);
  } catch (err) {
    render(el, alertHtml(err.message));
  }
}
