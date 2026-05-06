import * as api from "./api.js";
import { render, spinner, alert as alertHtml, escHtml } from "./ui.js";

// ── Page modules (lazy-ish, just import them all up front) ────────────────────
import { mountCollections, mountCollection } from "./pages/collections.js";
import { mountDocument } from "./pages/document.js";
import { mountTrees, mountTree } from "./pages/trees.js";
import { mountApiKeys } from "./pages/apikeys.js";
import { mountCollaborators } from "./pages/collaborators.js";
import { mountPermissions } from "./pages/permissions.js";
import { mountAccept } from "./pages/accept.js";

// ── State ─────────────────────────────────────────────────────────────────────
let currentUser = null;
let collections = [];
let orgInfo = null; // { current, orgs: [{id, name, own}] }

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  const session = await api.getSession();
  if (!session?.user) {
    renderLogin();
    return;
  }
  currentUser = session.user;
  orgInfo = await api.getOrg().catch(() => null);
  await renderApp();
}

// Save accept token from hash so login can redirect back
function getPendingAcceptToken() {
  const raw = location.hash.replace(/^#\/?/, "");
  const parts = raw.split("?")[0].split("/");
  if (parts[0] === "accept" && parts[1]) return decodeURIComponent(parts[1]);
  return null;
}

// ── Login ─────────────────────────────────────────────────────────────────────
function renderLogin() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="login-wrap">
      <div class="login-box">
        <div class="login-logo"><img src="/wren-logo.svg" alt="WREN" style="width:28px;height:28px;vertical-align:middle;margin-right:8px;border-radius:6px">WREN Admin</div>
        <div class="tabs" id="auth-tabs" style="margin-bottom:1rem">
          <button class="tab active" data-tab="login">Sign in</button>
          <button class="tab" data-tab="register">Register</button>
        </div>
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
        <div id="register-error" style="display:none"></div>
        <form id="register-form" style="display:none">
          <div class="field">
            <label class="field-label">Name</label>
            <input class="input" type="text" name="name" autocomplete="name" required>
          </div>
          <div class="field">
            <label class="field-label">Email</label>
            <input class="input" type="email" name="email" autocomplete="email" required>
          </div>
          <div class="field">
            <label class="field-label">Password</label>
            <input class="input" type="password" name="password" autocomplete="new-password" required>
          </div>
          <button class="btn btn-primary" type="submit" style="width:100%">Create account</button>
        </form>
        <p class="login-hint" id="server-hint" style="display:none">Server: <code id="server-url"></code></p>
      </div>
    </div>`;
  const customUrl = localStorage.getItem("wren_url");
  if (customUrl) {
    document.getElementById("server-url").textContent = customUrl;
    document.getElementById("server-hint").style.display = "";
  }

  // Tab switching
  document.getElementById("auth-tabs").addEventListener("click", e => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    document.querySelectorAll("#auth-tabs .tab").forEach(t => t.classList.remove("active"));
    btn.classList.add("active");
    const isLogin = btn.dataset.tab === "login";
    document.getElementById("login-form").style.display = isLogin ? "" : "none";
    document.getElementById("login-error").style.display = isLogin ? "" : "none";
    document.getElementById("register-form").style.display = isLogin ? "none" : "";
    document.getElementById("register-error").style.display = isLogin ? "none" : "";
  });

  // Sign in
  document.getElementById("login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errEl = document.getElementById("login-error");
    errEl.innerHTML = "";
    try {
      const pendingToken = getPendingAcceptToken();
      await api.signIn(fd.get("email"), fd.get("password"));
      const session = await api.getSession();
      currentUser = session.user;
      orgInfo = await api.getOrg().catch(() => null);
      await renderApp();
      if (pendingToken) {
        location.hash = `#/accept/${encodeURIComponent(pendingToken)}`;
      }
    } catch (err) {
      errEl.innerHTML = alertHtml(err.message);
    }
  });

  // Register
  document.getElementById("register-form").addEventListener("submit", async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errEl = document.getElementById("register-error");
    errEl.innerHTML = "";
    try {
      const pendingToken = getPendingAcceptToken();
      await api.signUp(fd.get("name"), fd.get("email"), fd.get("password"));
      const session = await api.getSession();
      currentUser = session.user;
      orgInfo = await api.getOrg().catch(() => null);
      await renderApp();
      if (pendingToken) {
        location.hash = `#/accept/${encodeURIComponent(pendingToken)}`;
      }
    } catch (err) {
      errEl.innerHTML = alertHtml(err.message);
    }
  });
}

// ── App shell ─────────────────────────────────────────────────────────────────
async function renderApp() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <aside class="sidebar" id="sidebar">
      <a href="/" class="sidebar-logo"><img src="/wren-logo.svg" alt="WREN" style="width:22px;height:22px;vertical-align:middle;margin-right:6px;border-radius:4px">WREN</a>
      ${orgInfo && orgInfo.orgs && orgInfo.orgs.length > 1 ? `
      <div class="sidebar-org-switcher">
        <select class="sidebar-org-select" id="org-switcher">
          ${orgInfo.orgs.map(o => `
            <option value="${escHtml(o.id)}" ${o.id === orgInfo.current ? "selected" : ""}>
              ${escHtml(o.name)}${o.own ? " ★" : ""}
            </option>`).join("")}
        </select>
      </div>` : orgInfo?.orgs?.length === 1 ? `
      <div class="sidebar-org-name">${escHtml(orgInfo.orgs[0]?.name ?? "")}</div>` : ""}
      <nav class="sidebar-nav">
        <div class="sidebar-section-label">Data</div>
        <a class="sidebar-link sidebar-link--parent" href="#/trees" data-route="trees">
          <span class="sidebar-toggle" data-target="sidebar-trees">&#9654;</span> Trees</a>
        <div id="sidebar-trees" class="sidebar-sublist"></div>
        <a class="sidebar-link sidebar-link--parent" href="#/" data-route="collections">
          <span class="sidebar-toggle" data-target="sidebar-collections">&#9654;</span> Collections</a>
        <div id="sidebar-collections" class="sidebar-sublist"></div>
        <div class="sidebar-section-label" style="margin-top:1rem">Settings</div>
        <a class="sidebar-link" href="#/settings/apikeys" data-route="apikeys">API Keys</a>
        <a class="sidebar-link" href="#/settings/collaborators" data-route="collaborators">Collaborators</a>
        <a class="sidebar-link" href="#/settings/permissions" data-route="permissions">Permissions</a>
      </nav>
      <div class="sidebar-footer">
        <span class="sidebar-user">${escHtml(currentUser.email ?? currentUser.name ?? "")}</span>
        <div style="display:flex;gap:6px;align-items:center">
          <a class="btn btn-sm" id="old-admin-link" href="/oldadmin${location.hash}" target="_blank" title="Same page in old admin">Old UI ↗</a>
          <button class="btn btn-sm" id="sign-out-btn">Sign out</button>
        </div>
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

  document.getElementById("org-switcher")?.addEventListener("change", async e => {
    const orgId = e.target.value;
    try {
      await api.switchOrg(orgId);
      orgInfo = await api.getOrg().catch(() => null);
      collections = [];
      // Re-render the whole app shell with updated org
      window.removeEventListener("hashchange", route);
      await renderApp();
    } catch (err) {
      window.alert("Failed to switch org: " + err.message);
      // Reset select back to current
      e.target.value = orgInfo?.current ?? orgId;
    }
  });

  await Promise.all([refreshTrees(), refreshCollections()]);

  // Expand sublists by default, wire up toggle arrows
  document.querySelectorAll(".sidebar-toggle").forEach(toggle => {
    const target = document.getElementById(toggle.dataset.target);
    if (target) toggle.classList.add("open"); // start expanded
    toggle.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      toggle.classList.toggle("open");
      target?.classList.toggle("collapsed");
    });
  });

  window.addEventListener("hashchange", () => {
    route();
    const link = document.getElementById("old-admin-link");
    if (link) link.href = `/oldadmin${location.hash}`;
  });
  route();
}

async function refreshTrees() {
  let trees = [];
  try { trees = await api.listTrees(); } catch { trees = []; }
  const el = document.getElementById("sidebar-trees");
  if (!el) return;
  if (trees.length === 0) {
    el.innerHTML = `<span class="sidebar-empty">No trees</span>`;
    return;
  }
  el.innerHTML = trees.map(t => {
    const name = t.name ?? t;
    return `<a class="sidebar-link sidebar-link--indent" href="#/trees/${encodeURIComponent(name)}" data-tree="${escHtml(name)}">${escHtml(name)}</a>`;
  }).join("");
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
  el.innerHTML = collections.map(c => {
    const name = c.name ?? c;
    return `<a class="sidebar-link sidebar-link--indent" href="#/collections/${encodeURIComponent(name)}" data-col="${escHtml(name)}">${escHtml(name)}</a>`;
  }).join("");
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

  if (p0 === "accept" && p1) {
    // Invite acceptance: #/accept/:token
    mountAccept(main, decodeURIComponent(p1));
  } else if (p0 === "collections" && p1 && p2) {
    // Document view: #/collections/:col/:id
    highlightSidebar(`[data-col="${CSS.escape(decodeURIComponent(p1))}"]`);
    mountDocument(main, decodeURIComponent(p1), decodeURIComponent(p2), params);
  } else if (p0 === "collections" && p1) {
    // Collection view: #/collections/:col
    highlightSidebar(`[data-col="${CSS.escape(decodeURIComponent(p1))}"]`);
    mountCollection(main, decodeURIComponent(p1), params, { refreshCollections });
  } else if (p0 === "trees" && p1) {
    // Tree view: #/trees/:name
    highlightSidebar(`[data-tree="${CSS.escape(decodeURIComponent(p1))}"]`);
    mountTree(main, decodeURIComponent(p1), params);
  } else if (p0 === "trees") {
    highlightSidebar(`[data-route="trees"]`);
    mountTrees(main);
  } else if (p0 === "settings" && p1 === "apikeys") {
    highlightSidebar(`[data-route="apikeys"]`);
    mountApiKeys(main, orgInfo);
  } else if (p0 === "settings" && p1 === "collaborators") {
    highlightSidebar(`[data-route="collaborators"]`);
    mountCollaborators(main, currentUser, orgInfo);
  } else if (p0 === "settings" && p1 === "permissions") {
    highlightSidebar(`[data-route="permissions"]`);
    mountPermissions(main, orgInfo);
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
