// Collections and documents: create, list, edit → new version, history, diff,
// rollback, labels, paths, delete, pagination, display rules and list columns.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { account, addMember, launch, openAdmin, go, text, waitText, setValue, clickText, waitDialog } from "./lib/harness.mjs";

let ctx, owner;
before(async () => {
  ctx = await launch();
  owner = await account("collector", { name: "Cole Lector" });
});
after(async () => { await ctx.close(); });

test("create a collection from the Collections page (cancel, then create)", async () => {
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page);
  await waitText(page, ".page-title", "Collections");
  await page.click("#new-col-btn");
  assert.equal(await page.$eval("#new-col-form", e => e.style.display), "");
  await page.click("#cancel-col-btn");
  assert.equal(await page.$eval("#new-col-form", e => e.style.display), "none");

  await page.click("#new-col-btn");
  await page.type('#create-col-form [name="name"]', "books");
  await page.click('#create-col-form button[type="submit"]');
  await page.waitForFunction(() => location.hash === "#/collections/books");
  await waitText(page, ".page-title", "books");
  // Sidebar lists and highlights it; the collection got a default schema
  await page.waitForSelector('#sidebar-collections [data-col="books"].active');
  const schema = await owner.api("GET", "/api/v1/books/_schema");
  assert.equal(schema.collectionType, "json");
  await waitText(page, "#tab-content", "0 documents");
  assert.match(await text(page, "#tab-content .empty-state"), /No documents yet/);

  // Back to the list: the new collection is a row with an Open button
  await go(page, "#/");
  await waitText(page, ".table", "books");
  await clickText(page, ".table a.btn", "Open");
  await page.waitForFunction(() => location.hash === "#/collections/books");
  assert.equal(page.errors.length, 0, page.errors.join("\n"));
});

test("collection create errors from the server are shown", async () => {
  // A member with read access only may not define collections
  const viewer = await addMember(owner, "colviewer", { groups: ["Viewers"] });
  await viewer.api("PUT", "/api/v1/org", { orgId: owner.orgId });
  const page = await ctx.newPage({ acct: viewer });
  await openAdmin(page);
  await page.waitForSelector("#new-col-btn");
  await page.click("#new-col-btn");
  await page.type('#create-col-form [name="name"]', "not-mine");
  await page.click('#create-col-form button[type="submit"]');
  await page.waitForSelector("#col-error .alert-error");
  assert.equal(await page.evaluate(() => location.hash), "#/");
  assert.equal(await owner.api("GET", "/api/v1/not-mine/_schema").catch(e => e.status), 404);
});

test("reserved collection names (API routes, _-prefixed) are rejected before anything is created", async () => {
  // "tree" would PUT /api/v1/tree/_schema and create a tree called "_schema"
  const acct = await account("reserved");
  const page = await ctx.newPage({ acct });
  await openAdmin(page);
  await page.waitForSelector("#new-col-btn");
  await page.click("#new-col-btn");
  for (const name of ["tree", "keys", "retention", "_events", "_private"]) {
    await setValue(page, '#create-col-form [name="name"]', name);
    await page.click('#create-col-form button[type="submit"]');
    await waitText(page, "#col-error .alert-error", `"${name}" is a reserved name`);
  }
  assert.equal(await page.evaluate(() => location.hash), "#/");
  assert.deepEqual((await acct.api("GET", "/api/v1/tree")).trees, []);
  assert.deepEqual((await acct.api("GET", "/api/v1/collections")).collections, []);
});

test("create documents: JSON validation, schema validation errors, success navigates to the document", async () => {
  await owner.api("PUT", "/api/v1/notes/_schema", { collectionType: "json", schema: { type: "object", required: ["title"] } });
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/collections/notes");
  await page.waitForSelector("#new-doc-btn");
  await page.click("#new-doc-btn");
  await page.click("#cancel-doc-btn");
  assert.equal(await page.$eval("#new-doc-form", e => e.style.display), "none");
  await page.click("#new-doc-btn");

  await setValue(page, '#create-doc-form [name="data"]', "{ not json");
  await page.click('#create-doc-form button[type="submit"]');
  await waitText(page, "#new-doc-error", "Invalid JSON");

  await setValue(page, '#create-doc-form [name="data"]', '{"body":"no title"}');
  await page.click('#create-doc-form button[type="submit"]');
  await waitText(page, "#new-doc-error", "Schema validation failed");

  await setValue(page, '#create-doc-form [name="data"]', '{"title":"First note","n":1}');
  await page.click('#create-doc-form button[type="submit"]');
  await page.waitForFunction(() => /^#\/collections\/notes\/[0-9a-f-]{36}$/.test(location.hash));
  await page.waitForSelector("#doc-editor");
  const data = JSON.parse(await page.$eval("#doc-editor", e => e.value));
  assert.deepEqual(data, { title: "First note", n: 1 });
  assert.match(await text(page, "#tab-content .card-header"), /Version 1/);
  assert.match(await text(page, ".breadcrumb"), /Collections \/ notes \//);
});

test("New document has no Document ID field (ids are generated by the server)", async () => {
  // The API can't create a document with a chosen id, so the form doesn't offer one
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/collections/custom-ids");
  await page.waitForSelector("#new-doc-btn");
  await page.click("#new-doc-btn");
  assert.equal(await page.$('#create-doc-form [name="id"]'), null);
  await setValue(page, '#create-doc-form [name="data"]', '{"title":"x"}');
  await page.click('#create-doc-form button[type="submit"]');
  await page.waitForSelector("#doc-editor");
  assert.match(await page.evaluate(() => location.hash), /^#\/collections\/custom-ids\/[0-9a-f-]{36}$/);
  assert.deepEqual(JSON.parse(await page.$eval("#doc-editor", e => e.value)), { title: "x" });
});

test("edit a document → new version; invalid JSON and server errors are shown", async () => {
  await owner.api("PUT", "/api/v1/drafts/_schema", { collectionType: "json", schema: { type: "object", properties: { n: { type: "number" } } } });
  const doc = await owner.api("POST", "/api/v1/drafts", { title: "Draft", n: 1 });
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, `#/collections/drafts/${doc.id}`);
  await page.waitForSelector("#doc-editor");

  await setValue(page, "#doc-editor", "{ broken");
  await page.click("#save-btn");
  await waitText(page, "#view-error", "Invalid JSON");

  await setValue(page, "#doc-editor", JSON.stringify({ title: "Draft", n: "not a number" }));
  await page.click("#save-btn");
  await waitText(page, "#view-error", "Schema validation failed");

  await setValue(page, "#doc-editor", JSON.stringify({ title: "Draft v2", n: 2 }));
  await page.click("#save-btn");
  await waitText(page, "#tab-content .card-header", "Version 2");
  assert.deepEqual(JSON.parse(await page.$eval("#doc-editor", e => e.value)), { title: "Draft v2", n: 2 });
  const stored = await owner.api("GET", `/api/v1/drafts/${doc.id}`);
  assert.equal(stored.version, 2);
});

test("'Saved.' confirmation stays visible after saving a document", async () => {
  const doc = await owner.api("POST", "/api/v1/drafts", { title: "Feedback" });
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, `#/collections/drafts/${doc.id}`);
  await page.waitForSelector("#doc-editor");
  await setValue(page, "#doc-editor", JSON.stringify({ title: "Feedback 2" }));
  await page.click("#save-btn");
  await waitText(page, "#tab-content .card-header", "Version 2");
  await waitText(page, "#view-error .alert-success", "Saved.");
});

test("history: versions, view a version, compare (diff), rollback", async () => {
  const doc = await owner.api("POST", "/api/v1/history", { title: "one" });
  await owner.api("PUT", `/api/v1/history/${doc.id}`, { title: "two" });
  await owner.api("PUT", `/api/v1/history/${doc.id}`, { title: "three", extra: true });
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, `#/collections/history/${doc.id}`);
  await page.waitForSelector("#doc-tabs");
  await page.click('#doc-tabs [data-tab="history"]');
  await page.waitForFunction(() => location.hash.endsWith("?tab=history"));
  await waitText(page, "#tab-content", "3 versions");
  assert.deepEqual(await page.$$eval(".timeline-header strong", els => els.map(e => e.textContent)), ["v1", "v2", "v3"]);

  // View v1 inline, then hide it again
  await page.click('[data-view-ver="1"]');
  await waitText(page, "#ver-preview-1 pre", '"one"');
  await page.click('[data-view-ver="1"]');
  assert.equal(await page.$eval("#ver-preview-1", e => e.style.display), "none");

  // Compare v1 → v3
  await page.click("#diff-toggle-btn");
  await page.waitForSelector("#v1-sel");
  await page.select("#v1-sel", "1");
  await page.select("#v2-sel", "3");
  await page.click("#diff-btn");
  const diff = JSON.parse(await waitText(page, "#diff-output pre", "diff"));
  assert.deepEqual(diff.diff.find(d => d.path === "/title"), { op: "replace", path: "/title", value: "three", oldValue: "one" });
  assert.ok(diff.diff.some(d => d.path === "/extra" && d.op === "add"));
  // Same version on both sides → the server's error is shown
  await page.select("#v2-sel", "1");
  await page.click("#diff-btn");
  await page.waitForSelector("#diff-output .alert-error");
  await page.click("#diff-toggle-btn");
  assert.equal(await page.$("#v1-sel"), null);

  // Roll back to v1 (confirm dialog) → v4 with v1's data
  await page.click('[data-rollback="1"]');
  await waitText(page, "#tab-content", "4 versions");
  assert.ok(page.dialogs.some(d => d.message === "Roll back to version 1?"));
  const stored = await owner.api("GET", `/api/v1/history/${doc.id}`);
  assert.equal(stored.version, 4);
  assert.deepEqual(stored.data, { title: "one" });

  // Dismissing the confirm does nothing
  page.dialogMode = "dismiss";
  await page.click('[data-rollback="2"]');
  await page.waitForFunction(() => true);
  page.dialogMode = "accept";
  assert.equal((await owner.api("GET", `/api/v1/history/${doc.id}`)).version, 4);
});

test("history: view and rollback errors are reported", async () => {
  const doc = await owner.api("POST", "/api/v1/history", { title: "short-lived" });
  await owner.api("PUT", `/api/v1/history/${doc.id}`, { title: "v2" });
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, `#/collections/history/${doc.id}?tab=history`);
  await waitText(page, "#tab-content", "2 versions");
  await page.browserContext().deleteCookie(...(await page.browserContext().cookies()));
  await page.click('[data-view-ver="1"]');
  await waitText(page, "#ver-preview-1 .alert-error", "nauthorized");
  await page.click('[data-rollback="1"]');
  await waitDialog(page, "nauthorized");
});

test("labels: set a label on the current version and on an older version", async () => {
  const doc = await owner.api("POST", "/api/v1/labelled", { title: "a" });
  await owner.api("PUT", `/api/v1/labelled/${doc.id}`, { title: "b" });
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, `#/collections/labelled/${doc.id}?tab=labels`);
  await page.waitForSelector("#label-form");
  assert.deepEqual(await page.$$eval('#label-form [name="version"] option', os => os.map(o => o.value)), ["", "1", "2"]);

  await page.type('#label-form [name="label"]', "latest");
  await page.click('#label-form button[type="submit"]');
  await waitText(page, "#label-error", 'Label "latest" set.');

  await setValue(page, '#label-form [name="label"]', "stable");
  await page.select('#label-form [name="version"]', "1");
  await page.click('#label-form button[type="submit"]');
  await waitText(page, "#label-error", 'Label "stable" set.');

  const stable = await owner.api("GET", `/api/v1/labelled/${doc.id}?label=stable`);
  assert.equal(stable.version, 1);
  const latest = await owner.api("GET", `/api/v1/labelled/${doc.id}?label=latest`);
  assert.equal(latest.version, 2);

  // The document disappears while the form is open → the server error is shown
  const gone = await owner.api("POST", "/api/v1/labelled", { title: "gone" });
  await go(page, `#/collections/labelled/${gone.id}?tab=labels`);
  await page.waitForFunction(id => document.querySelector("h1.page-title")?.textContent === id, {}, gone.id);
  await page.waitForSelector("#label-form");
  await owner.api("DELETE", `/api/v1/labelled/${gone.id}`);
  await page.type('#label-form [name="label"]', "late");
  await page.click('#label-form button[type="submit"]');
  await waitText(page, "#label-error .alert-error", "Not found");

  // Labels show as badges in the document list
  await go(page, "#/collections/labelled");
  await waitText(page, ".table tbody", "latest");
  const badges = await page.$$eval(".table tbody .badge-blue", els => els.map(e => e.textContent).sort());
  assert.deepEqual(badges, ["latest", "stable"]);
});

test("paths tab lists tree paths that reference the document", async () => {
  const doc = await owner.api("POST", "/api/v1/pages", { title: "Home" });
  const lonely = await owner.api("POST", "/api/v1/pages", { title: "Unreferenced" });
  await owner.api("PUT", `/api/v1/tree/web/home`, { documentId: doc.id });
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, `#/collections/pages/${doc.id}?tab=paths`);
  await waitText(page, "#tab-content td.mono", "/home");
  assert.equal(await page.$eval('#tab-content a[href="#/trees/web"]', a => a.textContent), "web");
  await go(page, `#/collections/pages/${lonely.id}?tab=paths`);
  await waitText(page, "#tab-content .empty-state", "not referenced in any tree");
});

test("delete a document (confirm) and missing documents show an error", async () => {
  const doc = await owner.api("POST", "/api/v1/trash", { title: "bye" });
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, `#/collections/trash/${doc.id}`);
  await page.waitForSelector("#doc-editor");

  page.dialogMode = "dismiss";
  await page.click("#delete-doc-btn");
  page.dialogMode = "accept";
  assert.equal(await page.evaluate(() => location.hash), `#/collections/trash/${doc.id}`);
  assert.ok(await page.$("#doc-editor"));

  await page.click("#delete-doc-btn");
  await page.waitForFunction(() => location.hash === "#/collections/trash");
  assert.ok(page.dialogs.some(d => d.message === `Delete document "${doc.id}" permanently?`));
  await waitText(page, "#tab-content", "0 documents");

  // The deleted document is gone: each tab shows the server error
  for (const tab of ["view", "history", "labels", "paths"]) {
    await go(page, `#/collections/trash/${doc.id}?tab=${tab}`);
    await page.waitForSelector("#tab-content .alert-error");
  }
  // Deleting an already-deleted document → alert with the server error
  await page.click("#delete-doc-btn");
  await waitDialog(page, "Not found");
});

test("pagination, clickable rows, display-name rule and list columns", async () => {
  await owner.api("PUT", "/api/v1/people/_schema", {
    collectionType: "json", schema: { type: "object" }, displayName: "{first} {last}", listColumns: ["city", "age"],
  });
  for (let i = 0; i < 22; i++) {
    await owner.api("POST", "/api/v1/people", { first: `P${String(i).padStart(2, "0")}`, last: "Person", city: i % 2 ? "Bern" : "Basel", age: 20 + i });
  }
  await owner.api("POST", "/api/v1/people", { first: "Only" }); // {last} and columns missing
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/collections/people");
  await waitText(page, "#tab-content", "23 documents");
  assert.deepEqual(await page.$$eval(".table thead th", ths => ths.map(t => t.textContent)), ["ID / Preview", "city", "age", "Version", "Updated"]);
  assert.match(await text(page, ".pagination"), /1–20 of 23/);
  assert.ok(await page.$eval("#prev-btn", b => b.disabled));
  const firstPage = await page.$$eval(".table tbody tr", rows => rows.length);
  assert.equal(firstPage, 20);
  const previews = await page.$$eval(".table tbody td:first-child a", as => as.map(a => a.textContent));
  assert.ok(previews.some(p => /^P\d\d Person$/.test(p)), previews.join());
  assert.ok(previews.includes("Only {last}"), "missing fields stay as {placeholder}");
  assert.equal(await page.$$eval(".doc-id-sub", s => s.length), 20);

  await page.click("#next-btn");
  await waitText(page, ".pagination", "21–23 of 23");
  assert.ok(await page.$eval("#next-btn", b => b.disabled));
  await page.click("#prev-btn");
  await waitText(page, ".pagination", "1–20 of 23");

  // Clicking a row (not the link) opens the document
  await page.click(".table tbody tr.clickable-row td.muted");
  await page.waitForFunction(() => /^#\/collections\/people\/[0-9a-f-]{36}$/.test(location.hash));
  await page.waitForSelector("#doc-editor");
});

test("errors loading the document list are shown (session expired)", async () => {
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/collections/books");
  await page.waitForSelector("#new-doc-btn");
  await page.browserContext().deleteCookie(...(await page.browserContext().cookies()));
  await go(page, "#/collections/people");
  await waitText(page, "#tab-content .alert-error", "nauthorized");
});
