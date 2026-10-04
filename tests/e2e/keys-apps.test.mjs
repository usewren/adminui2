// API keys (create, copy, revoke) and Connected apps (list, revoke).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { BASE, account, connectApp, launch, openAdmin, text, waitText, confirmClick, go, waitDialog } from "./lib/harness.mjs";

let ctx, owner;
before(async () => {
  ctx = await launch();
  owner = await account("keyholder", { name: "Key Holder" });
});
after(async () => { await ctx.close(); });

test("API keys: empty state, create (cancel first), secret shown once, copy, done", async () => {
  const page = await ctx.newPage({ acct: owner });
  await page.browserContext().overridePermissions(BASE, ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
  await openAdmin(page, "#/settings/apikeys");
  await waitText(page, ".page-title", "API Keys");
  assert.match(await text(page, ".empty-state"), /No API keys yet/);
  assert.equal(await text(page, ".page-header .muted"), "My workspace");
  assert.ok(await page.$eval('[data-route="apikeys"]', a => a.classList.contains("active")));

  await page.click("#new-key-btn");
  await page.click("#cancel-key-btn");
  assert.equal(await page.$eval("#new-key-form", e => e.style.display), "none");
  await page.click("#new-key-btn");
  await page.type('#create-key-form [name="name"]', "ci-deploy");
  await page.click('#create-key-form button[type="submit"]');
  const secret = (await waitText(page, "#key-secret", "wren_")).trim();
  assert.match(secret, /^wren_[A-Za-z0-9_-]{20,}$/);
  assert.equal(await page.$eval("#create-key-actions", e => e.style.display), "none");
  assert.ok(await page.$eval('#create-key-form [name="name"]', e => e.disabled));

  // The key works against the API
  const me = await (await fetch(`${BASE}/api/v1/me`, { headers: { Authorization: `Bearer ${secret}` } })).json();
  assert.equal(me.authMethod, "api_key");
  assert.equal(me.apiKey.name, "ci-deploy");

  await page.click("#copy-key-btn");
  await waitText(page, "#copy-key-btn", "Copied!");
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), secret);

  await page.click("#done-key-btn");
  await waitText(page, ".table tbody", "ci-deploy");
  const row = await text(page, ".table tbody tr");
  assert.match(row, new RegExp(`ci-deploy\\s+${secret.slice(0, 8)}`));
  assert.match(row, /Never/);
});

test("API keys: copy falls back to selecting the secret when the clipboard is blocked", async () => {
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/settings/apikeys");
  await page.waitForSelector("#new-key-btn");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("blocked")) } });
  });
  await page.click("#new-key-btn");
  await page.type('#create-key-form [name="name"]', "fallback-key");
  await page.click('#create-key-form button[type="submit"]');
  const secret = (await waitText(page, "#key-secret", "wren_")).trim();
  await page.click("#copy-key-btn");
  await page.waitForFunction(s => window.getSelection().toString() === s, {}, secret);
  assert.equal(await text(page, "#copy-key-btn"), "Copy to clipboard");
});

test("API keys: revoke needs a second click; the key stops working", async () => {
  const key = await owner.api("POST", "/api/v1/keys", { name: "to-revoke" });
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/settings/apikeys");
  await waitText(page, ".table tbody", "to-revoke");
  const sel = `[data-revoke="${key.id}"]`;
  await page.click(sel);
  assert.equal(await text(page, sel), "Revoke?");
  assert.ok(await page.$eval(sel, b => b.classList.contains("btn-danger")));
  await page.click(sel);
  await page.waitForFunction(s => !document.querySelector(s), {}, sel);
  const res = await fetch(`${BASE}/api/v1/me`, { headers: { Authorization: `Bearer ${key.key}` } });
  assert.equal(res.status, 401);
});

test("API keys: errors are shown (create, revoke, load)", async () => {
  const acct = await account("keyerr");
  const key = await acct.api("POST", "/api/v1/keys", { name: "doomed" });
  const page = await ctx.newPage({ acct });
  await openAdmin(page, "#/settings/apikeys");
  await waitText(page, ".table tbody", "doomed");
  await page.browserContext().deleteCookie(...(await page.browserContext().cookies()));
  await page.click("#new-key-btn");
  await page.type('#create-key-form [name="name"]', "nope");
  await page.click('#create-key-form button[type="submit"]');
  await page.waitForSelector("#create-key-error .alert-error");
  await confirmClick(page, `[data-revoke="${key.id}"]`);
  await waitDialog(page, "nauthorized");
  await go(page, "#/settings/connected-apps");
  await page.waitForSelector("#main .alert-error");
  await go(page, "#/settings/apikeys");
  await page.waitForSelector("#main .alert-error");
});

test("connected apps: empty, listed with org and redirect host, revoke", async () => {
  const acct = await account("appuser");
  const page = await ctx.newPage({ acct });
  await openAdmin(page, "#/settings/connected-apps");
  await waitText(page, ".empty-state", "No connected apps");
  assert.ok(await page.$eval('[data-route="connected-apps"]', a => a.classList.contains("active")));

  const claude = await connectApp(acct, "Claude Desktop");
  await connectApp(acct, "Cursor", "http://127.0.0.1:9123/cb");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitText(page, ".table tbody", "Cursor");
  const rows = await page.$$eval(".table tbody tr", trs => trs.map(t => t.textContent.replace(/\s+/g, " ").trim()));
  assert.equal(rows.length, 2);
  const row = rows.find(r => r.includes("Claude Desktop"));
  assert.ok(row.includes(`My workspace ${acct.slug}`) && row.includes("localhost:8091"), row);

  const sel = `[data-revoke="${claude.clientId}"]`;
  await confirmClick(page, sel);
  await page.waitForFunction(s => !document.querySelector(s) && document.querySelectorAll(".table tbody tr").length === 1, {}, sel);

  // Revoke failure (session gone) is shown below the table
  await page.browserContext().deleteCookie(...(await page.browserContext().cookies()));
  await confirmClick(page, "[data-revoke]");
  await page.waitForSelector("#apps-error .alert-error");
});
