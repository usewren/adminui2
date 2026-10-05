// Shared helpers for the Admin UI browser tests: accounts via the API, a headless
// Chrome per test file, JS coverage collection and small DOM wait helpers.
//
// Environment:
//   WREN_URL      server under test (default http://localhost:4801) — never a live instance
//   CHROME_PATH   Chrome/Chromium executable (default: the usual install location)
//   COVERAGE_DIR  where per-file coverage JSON is written (default tests/coverage/raw)
//   SCREENSHOT_DIR where bug screenshots go (default tests/coverage/screenshots)
//   WREN_DB_CONTAINER  test Postgres container, for marking emails confirmed (optional)
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Coverage } from "./coverage.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const BASE = (process.env.WREN_URL ?? "http://localhost:4801").replace(/\/$/, "");
export const COVERAGE_DIR = process.env.COVERAGE_DIR ?? join(HERE, "..", "..", "coverage", "raw");
export const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? join(HERE, "..", "..", "coverage", "screenshots");
export const PASSWORD = "secret-pass-123";

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return candidates.find(p => existsSync(p)) ?? candidates[0];
}

/** Unique, lowercase, URL-safe name for test data. */
export function uniq(prefix = "t") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** JSON request against the server with an optional session cookie. */
export async function request(method, path, { cookie, body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json", Origin: BASE, ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 200)}`), { status: res.status, body: json });
  return json;
}

/**
 * Create (sign up) an account through Better Auth and return its session cookie,
 * user id, org slug and a bound `api(method, path, body)` helper.
 */
export async function account(label = "user", { name } = {}) {
  const email = `${uniq(label)}@e2e.test`;
  const displayName = name ?? `${label[0].toUpperCase()}${label.slice(1)} Tester`;
  const res = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email, password: PASSWORD, name: displayName }),
  });
  if (!res.ok) throw new Error(`sign-up ${email} failed: ${res.status} ${await res.text()}`);
  const raw = res.headers.getSetCookie().map(c => c.split(";")[0]);
  const cookie = raw.join("; ");
  const me = await request("GET", "/api/v1/me", { cookie });
  const api = (method, path, body) => request(method, path, { cookie, body });
  return {
    email, name: displayName, password: PASSWORD, cookie, raw,
    userId: me.user.id, orgId: me.org.id, slug: me.org.slug, api,
  };
}

/**
 * Create an account and make it a member of `owner`'s org (invite + accept by token).
 * `groups` are group names (e.g. ["Viewers"]); role is "member" or "admin".
 */
export async function addMember(owner, label = "member", { name, role = "member", groups = [] } = {}) {
  const member = await account(label, { name });
  const all = (await owner.api("GET", "/api/v1/groups")).groups;
  const groupIds = groups.map(g => all.find(x => x.name === g)?.id).filter(Boolean);
  const inv = await owner.api("POST", "/api/v1/invites", { email: member.email, role, groupIds });
  await member.api("POST", "/api/v1/invites/accept", { token: inv.token });
  return member;
}

/**
 * Mark the account's email as confirmed, directly in the throwaway server's database
 * (there's no mail server to click a link from). Needs WREN_DB_CONTAINER, the name of
 * the test Postgres container (run-local.sh sets it); returns false without it.
 */
export const DB_CONTAINER = process.env.WREN_DB_CONTAINER;
export function verifyEmail(acct) {
  if (!DB_CONTAINER) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(acct.userId)) throw new Error(`unexpected user id ${acct.userId}`);
  execFileSync("docker", ["exec", DB_CONTAINER, "psql", "-U", "wren", "-d", "wren", "-qc",
    `UPDATE "user" SET email_verified = true WHERE id = '${acct.userId}'`], { stdio: "pipe" });
  return true;
}

/** Upload a file into a binary collection through the API. */
export async function uploadAsset(acct, collection, filename, content, type = "application/octet-stream") {
  const form = new FormData();
  form.append("file", new Blob([content], { type }), filename);
  const res = await fetch(`${BASE}/api/v1/${collection}`, { method: "POST", headers: { Cookie: acct.cookie, Origin: BASE }, body: form });
  if (!res.ok) throw new Error(`upload ${filename} → ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Connect an OAuth (MCP) client for this account, the way Claude/Cursor do it, so it
 * appears under "Connected apps". Returns { clientId, accessToken }.
 */
export async function connectApp(acct, clientName, redirect = "http://localhost:8091/callback") {
  const reg = await request("POST", "/api/auth/mcp/register", {
    body: { client_name: clientName, redirect_uris: [redirect], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] },
  });
  const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url");
  const q = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: redirect, scope: "openid offline_access", code_challenge: challenge, code_challenge_method: "S256", state: "s", prompt: "consent" });
  const loc = (await fetch(`${BASE}/api/auth/mcp/authorize?${q}`, { headers: { Cookie: acct.cookie }, redirect: "manual" })).headers.get("location");
  const consentCode = new URL(loc, BASE).searchParams.get("consent_code");
  const ok = await request("POST", "/mcp/consent/approve", { cookie: acct.cookie, body: { consent_code: consentCode, client_id: reg.client_id, org_id: acct.orgId, accept: true } });
  const code = new URL(ok.redirectURI).searchParams.get("code");
  const tok = await (await fetch(`${BASE}/api/auth/mcp/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect, client_id: reg.client_id, code_verifier: verifier }),
  })).json();
  return { clientId: reg.client_id, accessToken: tok.access_token };
}

// ── Browser ───────────────────────────────────────────────────────────────────

/**
 * Launch headless Chrome for one test file. Every page opened with `newPage()`
 * records JS coverage (snapshotted before every navigation, see coverage.mjs), auto-answers
 * confirm()/alert() dialogs (messages are kept in page.dialogs) and collects
 * uncaught page errors in page.errors. `close()` writes the coverage file.
 */
export async function launch({ coverageFilter = url => url.includes("/admin/js/") } = {}) {
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    defaultViewport: { width: 1280, height: 900 },
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const pages = [];

  async function newPage({ acct, dialog = "accept" } = {}) {
    // Each account gets its own cookie jar via a separate browser context
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.dialogs = [];
    page.errors = [];
    page.dialogMode = dialog;
    page.on("dialog", async d => {
      page.dialogs.push({ type: d.type(), message: d.message() });
      if (page.dialogMode === "dismiss") await d.dismiss(); else await d.accept();
    });
    page.on("pageerror", e => page.errors.push(e.message));
    page.jsCoverage = new Coverage(page, coverageFilter);
    await page.jsCoverage.start();
    if (acct) await signInCookie(page, acct);
    pages.push(page);
    return page;
  }

  async function close() {
    const entries = [];
    for (const page of pages) entries.push(...(await page.jsCoverage.stop()));
    mkdirSync(COVERAGE_DIR, { recursive: true });
    writeFileSync(join(COVERAGE_DIR, `${randomUUID()}.json`), JSON.stringify(entries));
    await browser.close();
  }

  return { browser, newPage, close };
}

/** Put the account's session cookie into the page's context (no UI sign-in). */
export async function signInCookie(page, acct) {
  const cookies = acct.raw.map(c => {
    const i = c.indexOf("=");
    return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE };
  });
  await page.browserContext().setCookie(...cookies);
}

/** Open an Admin UI route (hash) and wait until the app shell has rendered. */
export async function openAdmin(page, hash = "#/") {
  await page.goto(`${BASE}/admin/${hash}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#sidebar, #login-form", { timeout: 15000 });
}

/** Change the hash route of an already open Admin UI. */
export async function go(page, hash) {
  await page.evaluate(h => { location.hash = h; }, hash);
}

/** Wait until the given selector's text includes `text`; returns that text. */
export async function waitText(page, selector, text, timeout = 10000) {
  try {
    const handle = await page.waitForFunction(
      (s, t) => [...document.querySelectorAll(s)].find(e => e.textContent.includes(t))?.textContent,
      { timeout }, selector, text,
    );
    return handle.jsonValue();
  } catch (err) {
    const actual = await page.$$eval(selector, els => els.map(e => e.textContent.replace(/\s+/g, " ").trim()).join(" | ")).catch(() => "(none)");
    throw new Error(`Timed out waiting for "${text}" in ${selector}; got: ${actual.slice(0, 500)}`);
  }
}

/** Normalized text of the first element matching selector ("" when missing). */
export async function text(page, selector) {
  return page.$eval(selector, e => e.textContent.replace(/\s+/g, " ").trim()).catch(() => "");
}

/** Click the first element matching selector whose text includes `label`. */
export async function clickText(page, selector, label) {
  const handle = await page.waitForFunction(
    (s, l) => [...document.querySelectorAll(s)].find(e => e.textContent.includes(l)),
    { timeout: 10000 }, selector, label,
  );
  await handle.asElement().click();
}

/**
 * Click and wait for the response to a request whose URL path ends with `pathEnd`
 * (and method), e.g. the reload a page does after saving.
 */
export async function clickAndWait(page, selector, pathEnd, method = "GET") {
  const [res] = await Promise.all([
    page.waitForResponse(r => new URL(r.url()).pathname.endsWith(pathEnd) && r.request().method() === method),
    page.click(selector),
  ]);
  return res;
}

/** Click a bindConfirm button twice (first click arms it, second fires). */
export async function confirmClick(page, selector) {
  await page.click(selector);
  await page.waitForFunction(s => document.querySelector(s)?.dataset.confirming === "1", {}, selector);
  await page.click(selector);
}

/** Replace an input's/textarea's value and fire input events. */
export async function setValue(page, selector, value) {
  await page.$eval(selector, (e, v) => {
    e.value = v;
    e.dispatchEvent(new Event("input", { bubbles: true }));
    e.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

/** Wait for a dialog (alert/confirm) whose message includes `text`. */
export async function waitDialog(page, text, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const d = page.dialogs.find(x => x.message.includes(text));
    if (d) return d;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error(`No dialog containing "${text}"; got ${JSON.stringify(page.dialogs)}`);
}

/** Wait until at least `count` dialogs have been seen; returns them. */
export async function waitDialogCount(page, count, timeout = 10000) {
  const start = Date.now();
  while (page.dialogs.length < count && Date.now() - start < timeout) await new Promise(r => setTimeout(r, 50));
  if (page.dialogs.length < count) throw new Error(`Expected ${count} dialogs, got ${JSON.stringify(page.dialogs)}`);
  return page.dialogs;
}

/** Save a screenshot under SCREENSHOT_DIR and return its path. */
export async function screenshot(page, name) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const path = join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}
