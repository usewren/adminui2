// Collaborators: members, groups, invites (with the link shown when the server has no
// mail), "View as" impersonation with its banner, org switching.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { BASE, PASSWORD, DB_CONTAINER, account, addMember, verifyEmail, launch, openAdmin, go, text, waitText, confirmClick, clickText, waitDialog, waitDialogCount, screenshot } from "./lib/harness.mjs";

let ctx;
before(async () => { ctx = await launch(); });
after(async () => { await ctx.close(); });

const tab = async (page, name) => {
  await page.waitForSelector(`#collab-tabs [data-tab="${name}"]`);
  await page.click(`#collab-tabs [data-tab="${name}"]`);
};

test("members tab: roles and groups, remove a member; members see \"Access restricted\"", async () => {
  const owner = await account("lead", { name: "Lea Lead" });
  const anna = await addMember(owner, "anna", { name: "Anna Viewer", groups: ["Viewers"] });
  const bob = await addMember(owner, "bob", { name: "Bob Nogroup", role: "admin" });
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/settings/collaborators");
  await waitText(page, "#collab-tab-content", anna.email);
  assert.ok(await page.$eval('[data-route="collaborators"]', a => a.classList.contains("active")));
  assert.equal(await text(page, '#collab-tabs [data-tab="members"] .count-badge'), "2");
  assert.equal(await text(page, '#collab-tabs [data-tab="groups"] .count-badge'), "2");

  const rows = await page.$$eval("#collab-tab-content tbody tr", trs => trs.map(t => t.textContent.replace(/\s+/g, " ").trim()));
  assert.ok(rows.some(r => r.startsWith(`Anna Viewer ${anna.email} member Viewers View as Remove`)), rows.join("\n"));
  assert.ok(rows.some(r => r.startsWith(`Bob Nogroup ${bob.email} admin none: sees no data`)), rows.join("\n"));

  // Remove Bob (two clicks)
  await confirmClick(page, `[data-remove="${bob.userId}"]`);
  await page.waitForFunction(() => document.querySelector('#collab-tabs [data-tab="members"] .count-badge')?.textContent === "1");
  assert.equal(await page.$(`[data-remove="${bob.userId}"]`), null);
  assert.equal((await owner.api("GET", "/api/v1/members")).members.length, 1);

  // A member sees themselves as "(you)"
  await owner.api("POST", "/api/v1/permissions", { principal: `member:${anna.userId}`, resource: "*", access: "read" });
  const annaPage = await ctx.newPage({ acct: anna });
  await anna.api("PUT", "/api/v1/org", { orgId: owner.orgId });
  await openAdmin(annaPage, "#/settings/collaborators");
  // Members can't list members (admin-only): the page says so instead of showing empty lists
  await waitText(annaPage, ".callout", "Access restricted.");
  assert.match(await text(annaPage, ".callout"), new RegExp(`Members, groups and invites of ${owner.name} can only be managed`));
  assert.equal(await annaPage.$("#collab-tabs"), null);
  assert.match(await text(annaPage, ".page-header"), new RegExp(`Collaborators ${owner.name} member`));
  await anna.api("PUT", "/api/v1/org", { orgId: anna.orgId });
});

test("members tab: remove and View-as errors are reported", async () => {
  const owner = await account("lead2");
  const carl = await addMember(owner, "carl", { name: "Carl" });
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/settings/collaborators");
  await page.waitForSelector(`[data-remove="${carl.userId}"]`);
  await owner.api("DELETE", `/api/v1/members/${carl.userId}`);
  await confirmClick(page, `[data-remove="${carl.userId}"]`);
  await waitDialog(page, "");
  page.dialogs.length = 0;
  // View as someone who is no longer a member → the confirm, then the server error
  await page.click(`[data-view-as="${carl.userId}"]`);
  await waitDialog(page, "View this org as Carl?");
  const dialogs = await waitDialogCount(page, 2);
  assert.equal(dialogs[1].type, "alert");
});

test("groups tab: create, add and remove members, delete", async () => {
  const owner = await account("grouper", { name: "Gro Uper" });
  const dana = await addMember(owner, "dana", { name: "Dana Member" });
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/settings/collaborators");
  await tab(page, "groups");
  await waitText(page, "#collab-tab-content", "Groups decide what people can see and change.");
  const headers = await page.$$eval("#collab-tab-content .card-header", h => h.map(e => e.textContent.replace(/\s+/g, " ").trim()));
  assert.ok(headers.some(h => h.startsWith("Editors · write on everything")), headers.join("\n"));
  assert.ok(headers.some(h => h.startsWith("Viewers · read on everything")), headers.join("\n"));
  assert.match(await text(page, "#collab-tab-content"), /Read and write all collections and trees/);

  // Create "Results team" with read access to everything
  await page.type('#group-form [name="name"]', "Results team");
  await page.select('#group-form [name="access"]', "read");
  await page.click('#group-form button[type="submit"]');
  await waitText(page, "#collab-tab-content", "Results team · read on everything");
  // …and one without access rules
  await page.type('#group-form [name="name"]', "Nothing yet");
  await page.click('#group-form button[type="submit"]');
  await waitText(page, "#collab-tab-content", "Nothing yet · no access rules yet");
  assert.ok(await page.$eval('#collab-tabs [data-tab="groups"]', b => b.classList.contains("active")), "stays on the Groups tab");

  const groups = (await owner.api("GET", "/api/v1/groups")).groups;
  const results = groups.find(g => g.name === "Results team");
  // Add Dana
  await page.select(`[data-group-add-select="${results.id}"]`, dana.userId);
  await page.click(`[data-group-add="${results.id}"]`);
  await page.waitForSelector(`[data-group-remove="${results.id}"][data-user="${dana.userId}"]`);
  // Duplicate name → server error
  await page.type('#group-form [name="name"]', "Results team");
  await page.click('#group-form button[type="submit"]');
  await page.waitForSelector("#group-error .alert-error");
  // Remove Dana from the group
  await page.click(`[data-group-remove="${results.id}"][data-user="${dana.userId}"]`);
  await page.waitForFunction(id => document.querySelector(`[data-delete-group="${id}"]`) && !document.querySelector(`[data-group-remove="${id}"]`), {}, results.id);
  // Delete the group (two clicks)
  await confirmClick(page, `[data-delete-group="${results.id}"]`);
  await page.waitForFunction(id => !document.querySelector(`[data-delete-group="${id}"]`), {}, results.id);
  assert.ok(!(await owner.api("GET", "/api/v1/groups")).groups.some(g => g.name === "Results team"));
});

test("groups tab: add/remove/delete errors are reported", async () => {
  const owner = await account("grouperr");
  const eve = await addMember(owner, "eve", { name: "Eve", groups: ["Viewers"] });
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/settings/collaborators");
  await tab(page, "groups");
  const viewers = (await owner.api("GET", "/api/v1/groups")).groups.find(g => g.name === "Viewers");
  const editors = (await owner.api("GET", "/api/v1/groups")).groups.find(g => g.name === "Editors");
  await page.waitForSelector(`[data-group-add="${editors.id}"]`);
  await page.browserContext().deleteCookie(...(await page.browserContext().cookies()));
  await page.click(`[data-group-add="${editors.id}"]`);
  await waitDialog(page, "nauthorized");
  page.dialogs.length = 0;
  await page.click(`[data-group-remove="${viewers.id}"][data-user="${eve.userId}"]`);
  await waitDialog(page, "nauthorized");
  page.dialogs.length = 0;
  await confirmClick(page, `[data-delete-group="${editors.id}"]`);
  await waitDialog(page, "nauthorized");
});

test("invites: groups preselected, link shown without mail, pending count, revoke", async () => {
  const owner = await account("inviter", { name: "In Viter" });
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/settings/collaborators");
  await tab(page, "invites");
  await page.waitForSelector("#invite-form");
  assert.match(await text(page, "#collab-tab-content .empty-state"), /No invites sent yet/);
  const boxes = await page.$$eval('#invite-form [name="groupIds"]', els => els.map(e => ({ label: e.parentElement.textContent.trim().split(/\s/)[0], checked: e.checked })));
  assert.deepEqual(boxes.map(b => `${b.label}:${b.checked}`).sort(), ["Editors:false", "Viewers:true"]);
  assert.deepEqual(await page.$$eval('#invite-form [name="role"] option', os => os.map(o => o.value)), ["member", "admin"]);

  const email = `fred-${Date.now()}@e2e.test`;
  await page.type('#invite-form [name="email"]', email);
  await page.select('#invite-form [name="role"]', "admin");
  // Also put them into Editors
  await page.$$eval('#invite-form [name="groupIds"]', els => els.forEach(e => { if (!e.checked) e.click(); }));
  await page.click('#invite-form button[type="submit"]');
  const notice = await waitText(page, "#invite-error code", "/admin/#/accept/inv_");
  assert.match(await text(page, "#invite-error"), new RegExp(`Invite created for ${email.replace(/[.]/g, "\\.")}\\. This server doesn't send email, so share this link`));
  assert.ok(notice.startsWith(`${BASE}/admin/#/accept/`), notice);
  assert.match(await text(page, '#collab-tabs [data-tab="invites"]'), /1 pending/);
  const row = await text(page, "#collab-tab-content tbody tr");
  assert.match(row, new RegExp(`${email.replace(/[.]/g, "\\.")}\\s+admin\\s+pending`));
  const inv = (await owner.api("GET", "/api/v1/invites")).invites[0];
  assert.equal(inv.groupIds?.length ?? 2, 2);

  // Revoke (two clicks) → status "revoked", no pending count
  await confirmClick(page, `[data-revoke-invite="${inv.id}"]`);
  await waitText(page, "#collab-tab-content tbody", "revoked");
  assert.doesNotMatch(await text(page, '#collab-tabs [data-tab="invites"]'), /pending/);
});

test("invites: accepted and expired invites show their status; revoke errors are reported", async () => {
  const owner = await account("inviter2");
  const gina = await account("gina");
  const a = await owner.api("POST", "/api/v1/invites", { email: gina.email, role: "member", groupIds: [] });
  await gina.api("POST", "/api/v1/invites/accept", { token: a.token });
  const pending = await owner.api("POST", "/api/v1/invites", { email: "later@e2e.test", role: "member", groupIds: [] });
  const page = await ctx.newPage({ acct: owner });
  // Pretend the clock is 8 days later, so pending invites count as expired
  await page.evaluateOnNewDocument(() => {
    const RealDate = Date, shift = 8 * 24 * 3600 * 1000;
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [RealDate.now() + shift])); } static now() { return RealDate.now() + shift; } };
  });
  await openAdmin(page, "#/settings/collaborators");
  await tab(page, "invites");
  await waitText(page, "#collab-tab-content tbody", "accepted");
  const rows = await page.$$eval("#collab-tab-content tbody tr", trs => trs.map(t => t.textContent.replace(/\s+/g, " ").trim()));
  assert.ok(rows.some(r => r.startsWith(gina.email) && r.includes("accepted")), rows.join("\n"));
  assert.ok(rows.some(r => r.startsWith("later@e2e.test") && r.includes("expired")), rows.join("\n"));

  // Invite and revoke failures (a fresh page with real time, session gone)
  const p2 = await ctx.newPage({ acct: owner });
  await openAdmin(p2, "#/settings/collaborators");
  await tab(p2, "invites");
  await p2.waitForSelector(`[data-revoke-invite="${pending.id}"]`);
  await p2.browserContext().deleteCookie(...(await p2.browserContext().cookies()));
  await confirmClick(p2, `[data-revoke-invite="${pending.id}"]`);
  await waitDialog(p2, "nauthorized");
  await p2.type('#invite-form [name="email"]', "too-late@e2e.test");
  await p2.click('#invite-form button[type="submit"]');
  await waitText(p2, "#invite-error .alert-error", "nauthorized");
});

test("View as: banner while impersonating, restricted settings, stop viewing", async () => {
  const owner = await account("boss", { name: "Bo Boss" });
  const hank = await addMember(owner, "hank", { name: "Hank Viewer", groups: ["Viewers"] });
  await owner.api("POST", "/api/v1/secrets", { title: "visible to viewers" });
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/settings/collaborators");
  await page.waitForSelector(`[data-view-as="${hank.userId}"]`);

  // Dismissing the confirm does nothing
  page.dialogMode = "dismiss";
  await page.click(`[data-view-as="${hank.userId}"]`);
  page.dialogMode = "accept";
  assert.equal(await page.$("#impersonation-banner"), null);

  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.click(`[data-view-as="${hank.userId}"]`),
  ]);
  assert.ok(page.dialogs.some(d => d.message.startsWith("View this org as Hank Viewer?")));
  const banner = await waitText(page, "#impersonation-banner", "Viewing as");
  assert.match(banner.replace(/\s+/g, " "), new RegExp(`Viewing as Hank Viewer \\(${hank.email.replace(/[.]/g, "\\.")}\\)\\. Changes are saved as theirs and recorded as made by you\\. Ends at \\d`));
  assert.equal(await page.evaluate(() => location.hash), "#/");
  await screenshot(page, "view-as-banner");
  await waitText(page, "#sidebar-collections", "secrets");

  // Org management is off-limits while viewing as a member
  await go(page, "#/settings/permissions");
  await waitText(page, ".callout", "Access restricted.");
  await go(page, "#/settings/apikeys");
  await page.waitForSelector("#main .alert-error, #main .page-title");

  // Stop viewing → back on Collaborators as yourself
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.click("#end-impersonation"),
  ]);
  await page.waitForSelector("#sidebar");
  await page.waitForSelector("#collab-tabs");
  assert.equal(await page.evaluate(() => location.hash), "#/settings/collaborators");
  assert.equal(await page.$("#impersonation-banner"), null);
  assert.equal((await owner.api("GET", "/api/v1/impersonation")).impersonating, null);
});

test("org switcher: member of two orgs switches and sees the other org's data", async () => {
  const owner = await account("orgowner", { name: "Org Owner" });
  await owner.api("POST", "/api/v1/team-docs", { title: "shared" });
  const ivy = await addMember(owner, "ivy", { name: "Ivy Two-Orgs", groups: ["Viewers"] });
  await ivy.api("POST", "/api/v1/ivy-private", { title: "mine" });
  const page = await ctx.newPage({ acct: ivy });
  await openAdmin(page, "#/");
  await page.waitForSelector("#org-switcher");
  const opts = await page.$$eval("#org-switcher option", os => os.map(o => ({ v: o.value, t: o.textContent.trim(), s: o.selected })));
  assert.equal(opts.length, 2);
  assert.ok(opts.some(o => o.v === ivy.orgId && o.t === "My workspace ★" && o.s), JSON.stringify(opts));
  assert.ok(opts.some(o => o.v === owner.orgId && o.t === "Org Owner"), JSON.stringify(opts));
  await waitText(page, "#sidebar-collections", "ivy-private");

  await page.select("#org-switcher", owner.orgId);
  await waitText(page, "#sidebar-collections", "team-docs");
  assert.doesNotMatch(await text(page, "#sidebar-collections"), /ivy-private/);
  assert.equal(await page.$eval("#org-switcher", s => s.value), owner.orgId);
  // Pages show which org is active
  await go(page, "#/settings/apikeys");
  await waitText(page, ".page-header", "Org Owner");
  assert.match(await text(page, ".page-header .badge"), /member/);

  // Switch back
  await page.select("#org-switcher", ivy.orgId);
  await waitText(page, "#sidebar-collections", "ivy-private");
});

test("org switcher: a failed switch alerts and resets the selection", async () => {
  const owner = await account("orgowner2");
  const jo = await addMember(owner, "jo", { name: "Jo" });
  const page = await ctx.newPage({ acct: jo });
  await openAdmin(page, "#/");
  await page.waitForSelector("#org-switcher");
  await page.browserContext().deleteCookie(...(await page.browserContext().cookies()));
  await page.select("#org-switcher", owner.orgId);
  const d = await waitDialog(page, "Failed to switch org:");
  assert.match(d.message, /nauthorized/);
  await page.waitForFunction(id => document.querySelector("#org-switcher").value === id, {}, jo.orgId);
});

test("after switching org every route renders once", async () => {
  const owner = await account("orgowner3");
  const kim = await addMember(owner, "kim", { name: "Kim" });
  const page = await ctx.newPage({ acct: kim });
  await openAdmin(page, "#/");
  // Switch twice; wait each time until the app shell has been re-rendered and routed
  for (const orgId of [owner.orgId, kim.orgId]) {
    await page.waitForSelector("#org-switcher");
    const shell = await page.$("#sidebar");
    await page.select("#org-switcher", orgId);
    await page.waitForFunction(old => document.querySelector("#sidebar") !== old && document.querySelector("#new-col-btn"), {}, shell);
    await page.waitForNetworkIdle({ idleTime: 300 });
  }
  let calls = 0;
  page.on("request", r => { if (r.url().endsWith("/api/v1/keys") && r.method() === "GET") calls++; });
  await go(page, "#/settings/apikeys");
  await waitText(page, ".page-title", "API Keys");
  await page.waitForNetworkIdle({ idleTime: 300 });
  assert.equal(calls, 1);
});

test("received invitations: no callout for an unconfirmed account", async () => {
  // Without mail, accounts are unverified and the server returns no received invites,
  // so the callout must stay hidden even though an invite exists for this email.
  const owner = await account("calloutowner");
  const kai = await account("kai");
  await owner.api("POST", "/api/v1/invites", { email: kai.email, role: "member", groupIds: [] });
  const page = await ctx.newPage({ acct: kai });
  await openAdmin(page, "#/settings/collaborators");
  await page.waitForSelector("#collab-tabs");
  assert.doesNotMatch(await text(page, "#main"), /pending invitation/);
});

test("received invitations: callout for a confirmed account, accept, accept error", { skip: !DB_CONTAINER && "needs WREN_DB_CONTAINER to confirm the email" }, async () => {
  const owner = await account("calloutowner2", { name: "Callout Owner" });
  const other = await account("calloutowner3", { name: "Other Owner" });
  const mo = await account("mo");
  verifyEmail(mo);
  await owner.api("POST", "/api/v1/invites", { email: mo.email, role: "admin", groupIds: [] });
  const doomed = await other.api("POST", "/api/v1/invites", { email: mo.email, role: "member", groupIds: [] });
  const page = await ctx.newPage({ acct: mo });
  await openAdmin(page, "#/settings/collaborators");
  await waitText(page, "#main .card-body", "You have 2 pending invitations to join another workspace");
  const lines = await page.$$eval("[data-accept-invite]", bs => bs.map(b => b.parentElement.textContent.replace(/\s+/g, " ").trim()));
  assert.ok(lines.some(l => l.startsWith("Callout Owner — admin —")), lines.join("\n"));

  // Revoked meanwhile → the error is shown and the button is usable again
  await other.api("DELETE", `/api/v1/invites/${doomed.id}`);
  await page.click(`[data-accept-invite="${doomed.id}"]`);
  await page.waitForSelector("#received-accept-error .alert-error");
  assert.equal(await text(page, `[data-accept-invite="${doomed.id}"]`), "Accept");
  assert.ok(!(await page.$eval(`[data-accept-invite="${doomed.id}"]`, b => b.disabled)));

  // Accept the other one → page reloads; now a member of the owner's org
  const ownerInvite = await page.$eval("[data-accept-invite]:not([data-accept-invite=\"" + doomed.id + "\"])", b => b.dataset.acceptInvite);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.click(`[data-accept-invite="${ownerInvite}"]`),
  ]);
  await page.waitForSelector("#org-switcher");
  assert.ok((await page.$$eval("#org-switcher option", os => os.map(o => o.textContent.trim()))).includes("Callout Owner"));
  await page.waitForSelector("#collab-tabs");
  assert.doesNotMatch(await text(page, "#main"), /You have 2 pending/);
});

test("sign in through the form as an invited member and accept from the link", async () => {
  const owner = await account("linkowner", { name: "Link Owner" });
  const lu = await account("lu");
  const inv = await owner.api("POST", "/api/v1/invites", { email: lu.email, role: "member", groupIds: [] });
  const page = await ctx.newPage();
  await page.goto(inv.acceptUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#login-form");
  await page.type('#login-form [name="email"]', lu.email);
  await page.type('#login-form [name="password"]', PASSWORD);
  await page.click('#login-form button[type="submit"]');
  await waitText(page, "#accept-content", "Invite accepted");
  await clickText(page, "#accept-content a", "Go to dashboard");
  await page.waitForFunction(() => location.hash === "#/");
});
