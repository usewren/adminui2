// Permissions page: list, add (presets, custom principal/resource, advanced options),
// validation and server errors, inline edit, delete, and the 403 view for members.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { account, addMember, launch, openAdmin, text, waitText, setValue, confirmClick, waitDialog } from "./lib/harness.mjs";

let ctx, owner, member;
before(async () => {
  ctx = await launch();
  owner = await account("ruler", { name: "Ru Ler" });
  member = await addMember(owner, "ruled", { name: "Rudy Ruled", groups: ["Viewers"] });
});
after(async () => { await ctx.close(); });

const rows = page => page.$$eval(".table tbody tr", trs => trs.map(t => t.textContent.replace(/\s+/g, " ").trim()));

test("add rules: presets, custom principal and resource, advanced options", async () => {
  const key = await owner.api("POST", "/api/v1/keys", { name: "deploy-key" });
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/settings/permissions");
  await waitText(page, ".page-title", "Permissions");
  assert.ok(await page.$eval('[data-route="permissions"]', a => a.classList.contains("active")));
  assert.equal(await text(page, ".page-header .muted"), "My workspace");
  // The default group rules are listed, by group name
  const groupRows = (await rows(page)).filter(r => r.includes("(group)"));
  assert.deepEqual(groupRows.map(r => r.split(" (group)")[0]).sort(), ["Editors", "Viewers"]);

  await page.click("#new-perm-btn");
  await page.click("#cancel-perm-btn");
  assert.equal(await page.$eval("#new-perm-form", e => e.style.display), "none");
  await page.click("#new-perm-btn");

  const who = await page.$$eval("#new-principal option", os => os.map(o => o.textContent));
  assert.ok(who.includes(`${member.name} <${member.email}>`) && who.includes("key: deploy-key") && who.at(-1) === "Custom…", who.join());

  // 1) Everyone may read all collections, published only, with audit + jq filter
  await page.select("#new-principal", "*");
  await page.select("#new-resource", "collection:*");
  await page.select('#create-perm-form [name="access"]', "read");
  await page.click(".advanced-summary");
  await page.type('#create-perm-form [name="labelFilter"]', "published");
  await page.select('#create-perm-form [name="filterLang"]', "jq");
  await page.type('#create-perm-form [name="filterExpr"]', ".public == true");
  await page.click('#create-perm-form [name="auditReads"]');
  await page.click('#create-perm-form [name="auditWrites"]');
  await page.click('#create-perm-form button[type="submit"]');
  await waitText(page, ".table tbody", "collection:*");
  let r = (await rows(page)).find(x => x.startsWith("*"));
  assert.equal(r, "* collection:* read label: published · jq: .public == true · audit reads · audit writes Edit Delete");

  // 2) A member, with a custom resource
  await page.click("#new-perm-btn");
  await page.select("#new-principal", `member:${member.userId}`);
  await page.select("#new-resource", "__custom__");
  assert.equal(await page.$eval("#new-resource-custom", e => e.style.display), "");
  await page.select("#new-resource", "tree:*");
  assert.equal(await page.$eval("#new-resource-custom", e => e.style.display), "none");
  await page.select("#new-resource", "__custom__");
  await page.type("#new-resource-custom", "collection:reports");
  await page.select('#create-perm-form [name="access"]', "write");
  await page.click('#create-perm-form button[type="submit"]');
  await waitText(page, ".table tbody", "collection:reports");
  r = (await rows(page)).find(x => x.includes("collection:reports"));
  assert.equal(r, `${member.name} <${member.email}> collection:reports write — Edit Delete`);
  // The new resource is offered as a preset next time
  assert.ok((await page.$$eval("#new-resource option", o => o.map(x => x.value))).includes("collection:reports"));

  // 3) A custom principal (the key), resource "everything"
  await page.click("#new-perm-btn");
  await page.select("#new-principal", "__custom__");
  assert.equal(await page.$eval("#new-principal-custom", e => e.style.display), "");
  await page.select("#new-principal", "member:*");
  assert.equal(await page.$eval("#new-principal-custom", e => e.style.display), "none");
  await page.select("#new-principal", "__custom__");
  await page.type("#new-principal-custom", `key:${key.id}`);
  await page.select("#new-resource", "*");
  await page.select('#create-perm-form [name="access"]', "admin");
  await page.click('#create-perm-form button[type="submit"]');
  await waitText(page, ".table tbody", "key: deploy-key");
  r = (await rows(page)).find(x => x.startsWith("key: deploy-key"));
  assert.match(r, new RegExp(`^key: deploy-key \\(${key.keyPrefix}…\\) \\* admin`));
});

test("validation: custom principal/resource required; server errors shown", async () => {
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/settings/permissions");
  await page.waitForSelector("#new-perm-btn");
  await page.click("#new-perm-btn");
  await page.select("#new-principal", "__custom__");
  await page.click('#create-perm-form button[type="submit"]');
  await waitText(page, "#create-perm-error", "Principal and resource are required.");

  await page.type("#new-principal-custom", "bogus");
  await page.click('#create-perm-form button[type="submit"]');
  await waitText(page, "#create-perm-error .alert-error", "principal must be *, member:<userId>, key:<keyId> or group:<groupId>");

  // A data filter expression without a language → server error
  await setValue(page, "#new-principal-custom", "member:*");
  await page.click(".advanced-summary");
  await page.type('#create-perm-form [name="filterExpr"]', ".a");
  await page.click('#create-perm-form button[type="submit"]');
  await waitText(page, "#create-perm-error .alert-error", "filterLang is required when filterExpr is set");
});

test("inline edit: open/close, change access and audit flags, cancel; delete", async () => {
  const p = await owner.api("POST", "/api/v1/permissions", { principal: "member:*", resource: "tree:*", access: "read", labelFilter: "draft" });
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/settings/permissions");
  await page.waitForSelector(`[data-edit="${p.id}"]`);

  // Toggle open/closed; opening another closes the first
  await page.click(`[data-edit="${p.id}"]`);
  assert.equal(await page.$eval(`#edit-${p.id}`, e => e.style.display), "");
  assert.equal(await page.$eval(`#edit-form-${p.id} [name="access"]`, s => s.value), "read");
  assert.equal(await page.$eval(`#edit-form-${p.id} [name="labelFilter"]`, s => s.value), "draft");
  await page.click(`[data-edit="${p.id}"]`);
  assert.equal(await page.$eval(`#edit-${p.id}`, e => e.style.display), "none");
  await page.click(`[data-edit="${p.id}"]`);
  await page.click(`[data-close-edit="${p.id}"]`);
  assert.equal(await page.$eval(`#edit-${p.id}`, e => e.innerHTML), "");
  const other = await page.$eval(`[data-edit]:not([data-edit="${p.id}"])`, b => b.dataset.edit);
  await page.click(`[data-edit="${other}"]`);
  await page.click(`[data-edit="${p.id}"]`);
  assert.equal(await page.$eval(`#edit-${other}`, e => e.style.display), "none");
  // Editing an id that is not in the list does nothing
  await page.evaluate(() => { const b = document.querySelector("[data-edit]"); b.dataset.edit = "missing"; b.click(); });

  await page.select(`#edit-form-${p.id} [name="access"]`, "write");
  await setValue(page, `#edit-form-${p.id} [name="labelFilter"]`, "preview");
  await page.click(`#edit-form-${p.id} [name="auditWrites"]`);
  await page.click(`#edit-form-${p.id} button[type="submit"]`);
  await waitText(page, ".table tbody", "label: preview · audit writes");
  const saved = (await owner.api("GET", "/api/v1/permissions")).permissions.find(x => x.id === p.id);
  assert.equal(saved.access, "write");
  assert.equal(saved.labelFilter, "preview");
  assert.equal(saved.auditWrites, true);

  // Delete (two clicks)
  await confirmClick(page, `[data-delete="${p.id}"]`);
  await page.waitForFunction(id => !document.querySelector(`[data-delete="${id}"]`), {}, p.id);
  assert.ok(!(await owner.api("GET", "/api/v1/permissions")).permissions.some(x => x.id === p.id));
});

test("edit and delete errors are shown", async () => {
  const acct = await account("rulerr");
  const p = await acct.api("POST", "/api/v1/permissions", { principal: "*", resource: "tree:x", access: "read" });
  const page = await ctx.newPage({ acct });
  await openAdmin(page, "#/settings/permissions");
  await page.waitForSelector(`[data-edit="${p.id}"]`);
  await acct.api("DELETE", `/api/v1/permissions/${p.id}`);
  await page.click(`[data-edit="${p.id}"]`);
  await page.click(`#edit-form-${p.id} button[type="submit"]`);
  await page.waitForSelector(`#edit-error-${p.id} .alert-error`);
  await confirmClick(page, `[data-delete="${p.id}"]`);
  await waitDialog(page, "Not found");
});

test("members without admin rights see 'Access restricted'", async () => {
  const page = await ctx.newPage({ acct: member });
  // The member's current org is their own workspace; switch to the owner's org first
  await member.api("PUT", "/api/v1/org", { orgId: owner.orgId });
  await openAdmin(page, "#/settings/permissions");
  await waitText(page, ".callout", "Access restricted.");
  assert.match(await text(page, ".callout"), new RegExp(`Permission rules for ${owner.name} can only be managed`));
  await member.api("PUT", "/api/v1/org", { orgId: member.orgId });
});

test("other load errors are shown as an alert", async () => {
  const acct = await account("rulerr2");
  const page = await ctx.newPage({ acct });
  await openAdmin(page, "#/");
  await page.waitForSelector("#new-col-btn");
  await page.browserContext().deleteCookie(...(await page.browserContext().cookies()));
  await page.evaluate(() => { location.hash = "#/settings/permissions"; });
  await waitText(page, "#main .alert-error", "nauthorized");
});

test("clearing the label filter in Edit removes it", async () => {
  const p = await owner.api("POST", "/api/v1/permissions", { principal: "*", resource: "tree:clearme", access: "read", labelFilter: "published" });
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/settings/permissions");
  await page.waitForSelector(`[data-edit="${p.id}"]`);
  await page.click(`[data-edit="${p.id}"]`);
  await setValue(page, `#edit-form-${p.id} [name="labelFilter"]`, "");
  await page.click(`#edit-form-${p.id} button[type="submit"]`);
  await page.waitForSelector(`[data-edit="${p.id}"]`);
  await page.waitForFunction(id => !document.querySelector(`#edit-form-${id}`), {}, p.id);
  const saved = (await owner.api("GET", "/api/v1/permissions")).permissions.find(x => x.id === p.id);
  assert.equal(saved.labelFilter, null);
});

test("group rules show the group name", async () => {
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/settings/permissions");
  await page.waitForSelector(".table tbody");
  const all = await rows(page);
  assert.ok(all.some(r => r.startsWith("Viewers")), all.join("\n"));
  assert.ok(!all.some(r => r.startsWith("group:")), all.join("\n"));
});
