import * as api from "./api.js";
import { render, spinner, alert, escHtml } from "./ui.js";

// ── Page modules (lazy-ish, just import them all up front) ────────────────────
import { mountCollections, mountCollection } from "./pages/collections.js";
import { mountDocument } from "./pages/document.js";
import { mountTrees, mountTree } from "./pages/trees.js";
import { mountApiKeys } from "./pages/apikeys.js";
import { mountCollaborators } from "./pages/collaborators.js";
import { mountPermissions } from "./pages/permissions.js";

// ── State ─────────────────────────────────────────────────────────────────────
let currentUser = null;
let collections = [];

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  const session = await api.getSession();
  if (!session?.user) {
    renderLogin();
    return;
  }
  currentUser = session.user;
  await renderApp();
}

// ── Login ─────────────────────────────────────────────────────────────────────
function renderLogin() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="login-wrap">
      <div class="login-box">
        <div class="login-logo">Wren Admin</div>
        <div id="login-error"></div>
        <form id="login-form">
          <div class="field">
            <label class="field-label">Email</label>
            <input class="input" type="email" name="email" autocomplete="email" required>
          </div>
          <div class="field">
            <label class="field-label">Password</label>
            <input class="input" type="password" name="password" autocomplete="current-password" required>
          </div>
          <button class="btn btn-primary" type="submit" style="width:100%">Sign in</button>
        </form>
        <p class="login-hint">Server: <code id="server-url"></code></p>
      </div>
    </div>`;
  document.getElementById("server-url").textContent = localStorage.getItem("wren_url") || "http://localhost:4000";
  document.getElementById("login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errEl = document.getElementById("login-error");
    errEl.innerHTML = "";
    try {
      await api.signIn(fd.get("email"), fd.get("password"));
      const session = await api.getSession();
      currentUser = session.user;
      await renderApp();
    } catch (err) {
      errEl.innerHTML = alert(err.message);
    }
  });
}

// ── App shell ─────────────────────────────────────────────────────────────────
async function renderApp() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-logo">Wren</div>
      <nav class="sidebar-nav">
        <div class="sidebar-section-label">Data</div>
        <a class="sidebar-link" href="#/" data-route="collections">Collections</a>
        <a class="sidebar-link" href="#/trees" data-route="trees">Trees</a>
        <div id="sidebar-collections"></div>
        <div class="sidebar-section-label" style="margin-top:1rem">Settings</div>
        <a class="sidebar-link" href="#/settings/apikeys" data-route="apikeys">API Keys</a>
        <a class="sidebar-link" href="#/settings/collaborators" data-route="collaborators">Collaborators</a>
        <a class="sidebar-link" href="#/settings/permissions" data-route="permissions">Permissions</a>
      </nav>
      <div class="sidebar-footer">
        <span class="sidebar-user">${escHtml(currentUser.email ?? currentUser.name ?? "")}</span>
        <button class="btn btn-sm" id="sign-out-btn">Sign out</button>
      </div>
    </aside>
    <main class="main" id="main">
      <div class="loading"><span class="spinner"></span> Loading…</div>
    </main>`;

  document.getElementById("sign-out-btn").addEventListener("click", async () => {
    await api.signOut();
    currentUser = null;
    renderLogin();
  });

  await refreshCollections();

  window.addEventListener("hashchange", route);
  route();
}

async function refreshCollections() {
  try {
    collections = await api.listCollections();
  } catch {
    collections = [];
  }
  const el = document.getElementById("sidebar-collections");
  if (!el) return;
  if (collections.length === 0) {
    el.innerHTML = `<span class="sidebar-empty">No collections</span>`;
    return;
  }
  el.innerHTML = collections.map(c =>
    `<a class="sidebar-link sidebar-link--indent" href="#/collections/${encodeURIComponent(c)}" data-col="${escHtml(c)}">${escHtml(c)}</a>`
  ).join("");
}

// ── Router ────────────────────────────────────────────────────────────────────
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "") || "";
  const [pathPart, queryPart] = raw.split("?");
  const parts = pathPart ? pathPart.split("/") : [];
  const params = Object.fromEntries(new URLSearchParams(queryPart || ""));
  return { parts, params };
}

function route() {
  const main = document.getElementById("main");
  if (!main) return;

  const { parts, params } = parseHash();
  const [p0, p1, p2] = parts;

  // Update active sidebar link
  document.querySelectorAll(".sidebar-link").forEach(a => a.classList.remove("active"));

  if (p0 === "collections" && p1 && p2) {
    // Document view: #/collections/:col/:id
    highlightSidebar(`[data-col="${CSS.escape(decodeURIComponent(p1))}"]`);
    mountDocument(main, decodeURIComponent(p1), decodeURIComponent(p2), params);
  } else if (p0 === "collections" && p1) {
    // Collection view: #/collections/:col
    highlightSidebar(`[data-col="${CSS.escape(decodeURIComponent(p1))}"]`);
    mountCollection(main, decodeURIComponent(p1), params, { refreshCollections });
  } else if (p0 === "trees" && p1) {
    // Tree view: #/trees/:name
    highlightSidebar(`[data-route="trees"]`);
    mountTree(main, decodeURIComponent(p1), params);
  } else if (p0 === "trees") {
    highlightSidebar(`[data-route="trees"]`);
    mountTrees(main);
  } else if (p0 === "settings" && p1 === "apikeys") {
    highlightSidebar(`[data-route="apikeys"]`);
    mountApiKeys(main);
  } else if (p0 === "settings" && p1 === "collaborators") {
    highlightSidebar(`[data-route="collaborators"]`);
    mountCollaborators(main, currentUser);
  } else if (p0 === "settings" && p1 === "permissions") {
    highlightSidebar(`[data-route="permissions"]`);
    mountPermissions(main);
  } else {
    // Default: collections list
    highlightSidebar(`[data-route="collections"]`);
    mountCollections(main, collections, { refreshCollections });
  }
}

function highlightSidebar(selector) {
  const el = document.querySelector(`.sidebar-link${selector}`);
  if (el) el.classList.add("active");
}

// ── Start ─────────────────────────────────────────────────────────────────────
boot();
