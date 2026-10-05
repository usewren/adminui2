// Settings → Retention: org default and per-collection policies, preview before saving,
// exempt collections, remove, apply now, recent runs, and who may see the page.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { account, addMember, launch, openAdmin, go, text, waitText, setValue, confirmClick } from "./lib/harness.mjs";

let ctx;
before(async () => { ctx = await launch(); });
after(async () => { await ctx.close(); });

/** A document with versions 1..n in `collection`; labels map label → version. */
async function docWithVersions(acct, collection, n, labels = {}) {
  const doc = await acct.api("POST", `/api/v1/${collection}`, { title: "v1" });
  for (let v = 2; v <= n; v++) await acct.api("PUT", `/api/v1/${collection}/${doc.id}`, { title: `v${v}` });
  for (const [label, version] of Object.entries(labels)) await acct.api("POST", `/api/v1/${collection}/${doc.id}/labels`, { label, version });
  return doc;
}

const status = (acct, path) => acct.api("GET", path).then(() => 200, e => e.status);

test("empty state: no default, no collection policies, no runs; always-kept guarantee shown", async () => {
  const owner = await account("retempty");
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/settings/retention");
  await waitText(page, ".page-title", "Retention");
  assert.ok(await page.$eval('[data-route="retention"]', a => a.classList.contains("active")));
  assert.match(await text(page, "#always-kept"), /current version and every version a label points to are never removed/);
  assert.equal(await text(page, "#default-rules"), "No default: every version is kept.");
  assert.match(await text(page, "#collections-card .empty-state"), /follow the org default/);
  assert.match(await text(page, "#runs-card .empty-state"), /No versions have been removed yet/);
  assert.ok(await page.$eval("#apply-btn", b => b.disabled));
});

test("members who aren't owners or admins see that the page is restricted", async () => {
  const owner = await account("retowner");
  const member = await addMember(owner, "retmember", { groups: ["Editors"] });
  await member.api("PUT", "/api/v1/org", { orgId: owner.orgId });
  const page = await ctx.newPage({ acct: member });
  await openAdmin(page, "#/settings/retention");
  await waitText(page, ".callout--warn", "Access restricted.");
});

test("collection policy: preview before saving, save, apply now, recent runs", async () => {
  const owner = await account("retcol", { name: "Ret Owner" });
  const a = await docWithVersions(owner, "notes", 4, { approved: 1 });
  const b = await docWithVersions(owner, "notes", 4);
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/settings/retention");
  await page.waitForSelector("#add-policy-btn");
  await page.click("#add-policy-btn");
  await waitText(page, "#editor .card-header", "New collection policy");
  assert.deepEqual(await page.$$eval("#retention-collections option", o => o.map(x => x.value)), ["notes"]);

  // No name yet
  await page.click("#preview-btn");
  await waitText(page, "#policy-error", "Enter a collection name.");

  await page.type('#policy-form [name="collection"]', "notes");
  await page.type('#policy-form [name="maxVersions"]', "2");
  await page.click("#preview-btn");
  // a: v2 goes (v1 is labeled, v3 + v4 are the newest two); b: v1 and v2 go
  await waitText(page, "#preview-summary", "Would remove 3 versions in 2 documents, freeing");
  assert.match(await text(page, "#preview-summary"), /Nothing has been removed or saved yet/);
  assert.equal(await page.$("#preview-summary ul"), null);
  // Previewing saved nothing
  assert.deepEqual((await owner.api("GET", "/api/v1/retention")).collections, []);
  // Changing a rule clears the stale preview
  await page.type('#policy-form [name="maxVersions"]', "0");
  assert.equal(await text(page, "#preview-result"), "");
  await setValue(page, '#policy-form [name="maxVersions"]', "2");

  await page.click('#policy-form button[type="submit"]');
  await waitText(page, "#retention-notice .alert-success", "Policy for notes saved.");
  assert.equal(await page.$("#editor .card"), null);
  const row = await text(page, '#collections-card tr[data-collection="notes"]');
  assert.match(row, /notes\s+Keep the newest 2 versions/);
  assert.match(row, /Ret Owner/);
  const saved = (await owner.api("GET", "/api/v1/retention")).collections[0];
  assert.deepEqual({ ...saved, updatedAt: undefined, updatedBy: undefined },
    { collection: "notes", labeledOnly: false, maxVersions: 2, maxAgeDays: null, afterLabel: null, updatedAt: undefined, updatedBy: undefined });

  // Apply now: dismissing the confirmation does nothing
  page.dialogMode = "dismiss";
  await page.click("#apply-btn");
  await new Promise(r => setTimeout(r, 300));
  assert.match(page.dialogs.at(-1).message, /Apply all retention policies now\?/);
  assert.equal(await status(owner, `/api/v1/notes/${a.id}/versions/2`), 200);
  page.dialogMode = "accept";
  await page.click("#apply-btn");
  await waitText(page, "#retention-notice .alert-success", "Removed 3 versions in 2 documents, freeing");
  const run = await text(page, "#runs-card tbody tr");
  assert.match(run, /notes\s+3\s+[\d.]+ K?B\s+Ret Owner/);

  // Current and labeled versions are kept; the others are gone
  assert.equal(await status(owner, `/api/v1/notes/${a.id}/versions/1`), 200);
  assert.equal(await status(owner, `/api/v1/notes/${a.id}/versions/2`), 404);
  assert.equal(await status(owner, `/api/v1/notes/${a.id}/versions/4`), 200);
  assert.equal(await status(owner, `/api/v1/notes/${b.id}/versions/1`), 404);
  assert.equal(await status(owner, `/api/v1/notes/${b.id}/versions/3`), 200);

  // Nothing left to remove
  await page.click("#apply-btn");
  await waitText(page, "#retention-notice .alert-success", "Nothing to remove");
  await page.click('[data-edit="notes"]');
  await page.click("#preview-btn");
  await waitText(page, "#preview-summary", "Nothing would be removed right now.");
});

test("org default: all four rules, preview per collection, edit prefilled, remove", async () => {
  const owner = await account("retdef");
  await docWithVersions(owner, "posts", 3, { live: 3 });
  await docWithVersions(owner, "pages", 3);
  await docWithVersions(owner, "kept", 3);
  await owner.api("PUT", "/api/v1/retention/kept", {}); // exempt: not covered by the default
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/settings/retention");
  await waitText(page, '#collections-card tr[data-collection="kept"]', "Exempt: keeps everything");
  await page.click('[data-edit="*"]');
  await waitText(page, "#editor .card-header", "Org default");
  assert.equal(await page.$('#policy-form [name="mode"]'), null, "the default has no exempt option");
  await page.click('#policy-form [name="labeledOnly"]');
  await page.click("#preview-btn");
  // posts: v1, v2 (v3 is current and labeled); pages: v1, v2; kept is exempt
  await waitText(page, "#preview-summary", "Would remove 4 versions in 2 documents");
  const items = await page.$$eval("#preview-summary li", l => l.map(x => x.textContent));
  assert.deepEqual(items.map(i => i.split(":")[0]).sort(), ["pages", "posts"]);
  assert.match(items[0], /2 versions in 1 document, \d+ B/);

  await page.type('#policy-form [name="maxVersions"]', "5");
  await page.type('#policy-form [name="maxAgeDays"]', "30");
  await page.type('#policy-form [name="afterLabel"]', " live ");
  await page.click('#policy-form button[type="submit"]');
  await waitText(page, "#retention-notice", "Default saved.");
  const rules = await text(page, "#default-rules");
  for (const r of ["Keep only labeled versions", "Keep the newest 5 versions", "Remove versions older than 30 days", "Remove versions older than the version labeled “live”"]) {
    assert.ok(rules.includes(r), rules);
  }
  assert.equal(await text(page, '[data-edit="*"]'), "Edit");

  await page.click('[data-edit="*"]');
  assert.equal(await page.$eval('#policy-form [name="labeledOnly"]', e => e.checked), true);
  assert.equal(await page.$eval('#policy-form [name="maxVersions"]', e => e.value), "5");
  assert.equal(await page.$eval('#policy-form [name="maxAgeDays"]', e => e.value), "30");
  assert.equal(await page.$eval('#policy-form [name="afterLabel"]', e => e.value), "live");
  await page.click("#cancel-policy-btn");
  assert.equal(await page.$("#editor .card"), null);

  await confirmClick(page, '[data-remove="*"]');
  await waitText(page, "#retention-notice", "Default removed.");
  assert.equal(await text(page, "#default-rules"), "No default: every version is kept.");
  assert.equal((await owner.api("GET", "/api/v1/retention")).default, null);
});

test("exempt a collection (keep everything), then remove its policy", async () => {
  const owner = await account("retexempt");
  await owner.api("PUT", "/api/v1/retention/archive", { maxAgeDays: 7 });
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/settings/retention");
  await page.waitForSelector('[data-edit="archive"]');
  await page.click('[data-edit="archive"]');
  await waitText(page, "#editor .card-header", "Policy for archive");
  assert.equal(await page.$eval('#policy-form [name="maxAgeDays"]', e => e.value), "7");
  await page.click('#policy-form [name="mode"][value="keep"]');
  assert.ok(await page.$eval("#rules", f => f.disabled));
  await page.click('#policy-form [name="mode"][value="rules"]');
  assert.ok(!(await page.$eval("#rules", f => f.disabled)));
  await page.click('#policy-form [name="mode"][value="keep"]');
  await page.click('#policy-form button[type="submit"]');
  await waitText(page, "#retention-notice", "Policy for archive saved.");
  assert.match(await text(page, '#collections-card tr[data-collection="archive"]'), /Exempt: keeps everything/);
  const p = (await owner.api("GET", "/api/v1/retention")).collections[0];
  assert.deepEqual([p.labeledOnly, p.maxVersions, p.maxAgeDays, p.afterLabel], [false, null, null, null]);

  // Editing an exempt policy starts in "keep everything"
  await page.click('[data-edit="archive"]');
  assert.ok(await page.$eval('#policy-form [name="mode"][value="keep"]', e => e.checked));
  assert.ok(await page.$eval("#rules", f => f.disabled));
  // The open editor survives a reload of the page data (e.g. after Apply now)
  await page.click("#apply-btn");
  await waitText(page, "#retention-notice", "Nothing to remove");
  await waitText(page, "#editor .card-header", "Policy for archive");

  await confirmClick(page, '[data-remove="archive"]');
  await waitText(page, "#retention-notice", "Policy for archive removed.");
  await waitText(page, "#collections-card .empty-state", "follow the org default");
});

test("errors: invalid rules and names are shown; failures to save, remove, apply and load", async () => {
  const owner = await account("reterr");
  await owner.api("PUT", "/api/v1/retention/*", { maxVersions: 3 });
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/settings/retention");
  await page.waitForSelector("#add-policy-btn");
  await page.click("#add-policy-btn");
  await page.type('#policy-form [name="collection"]', "docs");
  await page.type('#policy-form [name="maxVersions"]', "0");
  await page.click("#preview-btn");
  await waitText(page, "#policy-error .alert-error", "maxVersions must be a whole number of at least 1");
  assert.equal(await text(page, "#preview-result"), "");
  await setValue(page, '#policy-form [name="maxVersions"]', "");
  await setValue(page, '#policy-form [name="collection"]', "_internal");
  await page.click('#policy-form button[type="submit"]');
  await waitText(page, "#policy-error .alert-error", "Use * for the org default, or a collection name");
  assert.deepEqual((await owner.api("GET", "/api/v1/retention")).collections, []);

  // Session gone: remove, apply and load fail visibly
  await page.browserContext().deleteCookie(...(await page.browserContext().cookies()));
  await confirmClick(page, '[data-remove="*"]');
  await page.waitForSelector("#retention-error .alert-error");
  await page.$eval("#retention-error", e => { e.innerHTML = ""; });
  await page.click("#apply-btn");
  await page.waitForSelector("#retention-error .alert-error");
  await go(page, "#/");
  await go(page, "#/settings/retention");
  await page.waitForSelector("#main .alert-error");
});
