// Sign-up, sign-in, sign-out, forgot-password link and auth error display.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { BASE, PASSWORD, account, launch, openAdmin, text, uniq, waitText, request } from "./lib/harness.mjs";

let ctx;
before(async () => { ctx = await launch(); });
after(async () => { await ctx.close(); });

test("login screen: tabs switch between sign-in and register, forgot-password link", async () => {
  const page = await ctx.newPage();
  await openAdmin(page);
  assert.equal(await text(page, ".login-logo"), "WREN Admin");
  assert.equal(await page.$eval("#login-form", f => f.style.display), "");
  assert.equal(await page.$eval("#register-form", f => f.style.display), "none");

  await page.click('#auth-tabs [data-tab="register"]');
  assert.equal(await page.$eval("#login-form", f => f.style.display), "none");
  assert.equal(await page.$eval("#register-form", f => f.style.display), "");
  assert.ok(await page.$eval('#auth-tabs [data-tab="register"]', b => b.classList.contains("active")));

  await page.click('#auth-tabs [data-tab="login"]');
  assert.equal(await page.$eval("#login-form", f => f.style.display), "");

  // Clicking the tab bar outside a tab does nothing
  await page.$eval("#auth-tabs", el => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  assert.equal(await page.$eval("#login-form", f => f.style.display), "");

  // Forgot password goes to the server's login page in "forgot" mode
  const href = await page.$eval("#login-form a", a => a.getAttribute("href"));
  assert.equal(href, "/login?mode=forgot");
  await Promise.all([page.waitForNavigation(), page.click("#login-form a")]);
  assert.equal(new URL(page.url()).pathname, "/login");
  const res = await fetch(`${BASE}/login?mode=forgot`);
  assert.equal(res.status, 200);
  assert.equal(page.errors.length, 0, page.errors.join("\n"));
});

test("register through the UI, sign out, sign back in", async () => {
  const page = await ctx.newPage();
  await openAdmin(page);
  const email = `${uniq("reg")}@e2e.test`;
  await page.click('#auth-tabs [data-tab="register"]');
  await page.type('#register-form [name="name"]', "Regina Register");
  await page.type('#register-form [name="email"]', email);
  await page.type('#register-form [name="password"]', PASSWORD);
  await page.click('#register-form button[type="submit"]');
  await page.waitForSelector("#sidebar");
  assert.equal(await text(page, ".sidebar-user"), email);
  assert.equal(await text(page, ".sidebar-org-name"), "My workspace");
  await waitText(page, ".page-title", "Collections");
  assert.match(await text(page, ".empty-state"), /No collections yet/);
  assert.match(await text(page, "#sidebar-trees"), /No trees/);

  // Sign out → back to the login screen, session gone
  await page.click("#sign-out-btn");
  await page.waitForSelector("#login-form");
  const session = await page.evaluate(() => fetch("/api/auth/get-session", { credentials: "include" }).then(r => r.json()));
  assert.ok(!session?.user, "session cleared after sign-out");

  // Sign in again with the same credentials
  await page.type('#login-form [name="email"]', email);
  await page.type('#login-form [name="password"]', PASSWORD);
  await page.click('#login-form button[type="submit"]');
  await page.waitForSelector("#sidebar");
  assert.equal(await text(page, ".sidebar-user"), email);
  assert.equal(page.errors.length, 0, page.errors.join("\n"));
});

test("wrong password and duplicate registration show errors", async () => {
  const acct = await account("auth");
  const page = await ctx.newPage();
  await openAdmin(page);
  await page.type('#login-form [name="email"]', acct.email);
  await page.type('#login-form [name="password"]', "not-the-password");
  await page.click('#login-form button[type="submit"]');
  const msg = await waitText(page, "#login-error .alert-error", "");
  assert.match(msg, /invalid|password/i);
  assert.equal(await page.$("#sidebar"), null);

  await page.click('#auth-tabs [data-tab="register"]');
  await page.type('#register-form [name="name"]', "Dupe");
  await page.type('#register-form [name="email"]', acct.email);
  await page.type('#register-form [name="password"]', PASSWORD);
  await page.click('#register-form button[type="submit"]');
  const dupe = await waitText(page, "#register-error .alert-error", "");
  assert.match(dupe, /exist|already/i);
});

test("custom server URL (localStorage wren_url) is shown on the login screen", async () => {
  const page = await ctx.newPage();
  await openAdmin(page);
  await page.evaluate(url => localStorage.setItem("wren_url", url), BASE);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#login-form");
  assert.equal(await page.$eval("#server-hint", e => e.style.display), "");
  assert.equal(await text(page, "#server-url"), BASE);
  // API calls go to the configured server
  const acct = await account("custom");
  await page.type('#login-form [name="email"]', acct.email);
  await page.type('#login-form [name="password"]', PASSWORD);
  await page.click('#login-form button[type="submit"]');
  await page.waitForSelector("#sidebar");
  await page.evaluate(() => localStorage.removeItem("wren_url"));
});

test("servers that require email confirmation: register and sign-in messages", async () => {
  // This throwaway server doesn't require confirmation, so the two answers such a
  // server gives are simulated: no session after sign-up, and 403 on sign-in.
  const page = await ctx.newPage();
  await page.setRequestInterception(true);
  let signedUp = false;
  page.on("request", req => {
    const path = new URL(req.url()).pathname;
    if (path === "/api/auth/sign-up/email") {
      signedUp = true;
      return req.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ token: null, user: { id: "x" } }) });
    }
    if (path === "/api/auth/get-session" && signedUp) return req.respond({ status: 200, contentType: "application/json", body: "null" });
    if (path === "/api/auth/sign-in/email") return req.respond({ status: 403, contentType: "application/json", body: JSON.stringify({ code: "EMAIL_NOT_VERIFIED", message: "Email not verified" }) });
    return req.continue();
  });
  await openAdmin(page);
  await page.click('#auth-tabs [data-tab="register"]');
  await page.type('#register-form [name="name"]', "Una Confirmed");
  await page.type('#register-form [name="email"]', `${uniq("unconf")}@e2e.test`);
  await page.type('#register-form [name="password"]', PASSWORD);
  await page.click('#register-form button[type="submit"]');
  await waitText(page, "#register-error .alert-success", "Account created. Check your email and click the confirmation link, then sign in.");
  assert.equal(await page.$eval('#register-form [name="email"]', i => i.value), "", "form is reset");

  await page.click('#auth-tabs [data-tab="login"]');
  await page.type('#login-form [name="email"]', "someone@e2e.test");
  await page.type('#login-form [name="password"]', PASSWORD);
  await page.click('#login-form button[type="submit"]');
  await waitText(page, "#login-error .alert-error", "Please confirm your email first. We've just sent you a new confirmation link.");
});

test("invite link opened while signed out: sign in, then the invite is accepted", async () => {
  const owner = await account("inviter", { name: "Ina Inviter" });
  const guest = await account("guest");
  const inv = await owner.api("POST", "/api/v1/invites", { email: guest.email, role: "member", groupIds: [] });
  const token = inv.acceptUrl.split("/accept/")[1];

  const page = await ctx.newPage();
  await page.goto(`${BASE}/admin/#/accept/${token}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#login-form");
  await page.type('#login-form [name="email"]', guest.email);
  await page.type('#login-form [name="password"]', PASSWORD);
  await page.click('#login-form button[type="submit"]');
  await waitText(page, "#accept-content", "Invite accepted");
  // Now a member of two orgs → the org switcher appears after the next load
  const orgs = await request("GET", "/api/v1/org", { cookie: guest.cookie });
  assert.equal(orgs.orgs.length, 2);
  await page.click("#accept-content a.btn");
  await waitText(page, ".page-title", "Collections");
});

test("invite link opened while signing up: register, then the invite is accepted", async () => {
  const owner = await account("inviter2");
  const email = `${uniq("newbie")}@e2e.test`;
  const inv = await owner.api("POST", "/api/v1/invites", { email, role: "member", groupIds: [] });
  const token = inv.acceptUrl.split("/accept/")[1];

  const page = await ctx.newPage();
  await page.goto(`${BASE}/admin/#/accept/${token}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#login-form");
  await page.click('#auth-tabs [data-tab="register"]');
  await page.type('#register-form [name="name"]', "New Bie");
  await page.type('#register-form [name="email"]', email);
  await page.type('#register-form [name="password"]', PASSWORD);
  await page.click('#register-form button[type="submit"]');
  await waitText(page, "#accept-content", "Invite accepted");
});

test("accept page: bad token shows the server error; expired session asks to sign in", async () => {
  const acct = await account("acceptor");
  const page = await ctx.newPage({ acct });
  await openAdmin(page, "#/accept/inv_not-a-real-token");
  const msg = await waitText(page, "#accept-content .alert-error", "");
  assert.ok(msg.length > 0);
  assert.equal(await page.$eval("#accept-content a.btn", a => a.textContent.trim()), "Back to app");

  // Session disappears while the app is open → 401 → sign-in prompt
  await page.browserContext().deleteCookie(...(await page.browserContext().cookies()));
  await page.evaluate(() => { location.hash = "#/accept/inv_other-token"; });
  await waitText(page, "#accept-content", "You need to be signed in");
});
