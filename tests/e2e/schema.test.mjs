// Collection Schema tab (default schema, display rule, list columns, JSON Schema,
// collection type, remove) and the collection Access tab.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { account, addMember, launch, openAdmin, go, text, waitText, setValue, waitDialog, clickAndWait } from "./lib/harness.mjs";

let ctx, owner;
before(async () => {
  ctx = await launch();
  owner = await account("schemer", { name: "Sche Mer" });
});
after(async () => { await ctx.close(); });

const columns = page => page.$$eval("#col-list .col-row span:nth-child(2)", s => s.map(e => e.textContent));

test("schema tab: create a default schema for a schemaless collection", async () => {
  await owner.api("POST", "/api/v1/loose", { title: "no schema yet" });
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/collections/loose");
  await page.waitForSelector("#col-tabs");
  await page.click('#col-tabs [data-tab="schema"]');
  await waitText(page, "#tab-content .alert", "No schema is defined");
  assert.match(await text(page, "#tab-content"), /starting template — not saved yet/);
  assert.equal(await page.$("#delete-schema-btn"), null);
  // Clicking the tab bar outside a tab does nothing
  await page.$eval("#col-tabs", el => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

  await page.click("#create-default-schema-btn");
  await page.waitForSelector("#delete-schema-btn");
  assert.equal(await page.$("#create-default-schema-btn"), null);
  const schema = await owner.api("GET", "/api/v1/loose/_schema");
  assert.deepEqual(schema.schema, { type: "object", additionalProperties: true });
});

test("schema tab: display rule, list columns (add, Enter, duplicate, remove, drag), JSON Schema, save", async () => {
  await owner.api("PUT", "/api/v1/films/_schema", { collectionType: "json", schema: { type: "object" } });
  await owner.api("POST", "/api/v1/films", { title: "Alien", year: 1979, director: "Scott" });
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/collections/films?tab=schema");
  await page.waitForSelector("#list-columns-widget #col-add-input");
  assert.match(await text(page, "#list-columns-widget"), /No columns configured/);

  await page.type("#display-name-input", "{title} ({year})");
  await page.type("#col-add-input", "year");
  await page.click("#col-add-btn");
  await page.type("#col-add-input", "director");
  await page.keyboard.press("Enter");
  await page.type("#col-add-input", "title");
  await page.click("#col-add-btn");
  assert.deepEqual(await columns(page), ["year", "director", "title"]);

  // Duplicates and blanks are ignored (focus returns to the input)
  await page.type("#col-add-input", "year");
  await page.click("#col-add-btn");
  assert.deepEqual(await columns(page), ["year", "director", "title"]);
  assert.equal(await page.evaluate(() => document.activeElement?.id), "col-add-input");

  // Remove "director"
  await page.click('#col-list [data-remove="1"]');
  assert.deepEqual(await columns(page), ["year", "title"]);

  // Drag "title" onto "year" → reorder
  await page.evaluate(() => {
    const rows = document.querySelectorAll("#col-list .col-row");
    const dt = new DataTransfer();
    rows[1].dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
    rows[0].dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
    rows[0].dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    rows[1].dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
  });
  assert.deepEqual(await columns(page), ["title", "year"]);
  // Dropping a row on itself changes nothing
  await page.evaluate(() => {
    const row = document.querySelector("#col-list .col-row");
    const dt = new DataTransfer();
    row.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
    row.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  assert.deepEqual(await columns(page), ["title", "year"]);

  // Invalid JSON Schema text → client-side error
  await setValue(page, "#schema-editor", "{ nope");
  await page.click("#save-schema-btn");
  await waitText(page, "#schema-error", "Invalid JSON Schema");

  // Schema the server rejects → server error
  await setValue(page, "#schema-editor", JSON.stringify({ type: 5 }));
  await page.click("#save-schema-btn");
  await waitText(page, "#schema-error .alert-error", "Invalid JSON Schema");

  await setValue(page, "#schema-editor", JSON.stringify({ type: "object", properties: { year: { type: "number" } } }));
  await Promise.all([
    page.waitForResponse(r => r.url().endsWith("/films/_schema") && r.request().method() === "GET"),
    page.click("#save-schema-btn"),
  ]);
  const saved = await owner.api("GET", "/api/v1/films/_schema");
  assert.equal(saved.displayName, "{title} ({year})");
  assert.deepEqual(saved.listColumns, ["title", "year"]);
  assert.deepEqual(saved.schema.properties, { year: { type: "number" } });
  // The re-rendered tab shows the saved state
  await page.waitForFunction(() => document.querySelector("#display-name-input").value === "{title} ({year})");
  assert.deepEqual(await columns(page), ["title", "year"]);

  // The documents tab uses the rule and the columns
  await page.click('#col-tabs [data-tab="documents"]');
  await waitText(page, ".table tbody", "Alien (1979)");
  assert.deepEqual(await page.$$eval(".table thead th", t => t.map(e => e.textContent)), ["ID / Preview", "title", "year", "Version", "Updated"]);

  // Removing all columns saves listColumns: null
  await go(page, "#/collections/films?tab=schema");
  await page.waitForSelector('#col-list [data-remove="0"]');
  await page.click('#col-list [data-remove="0"]');
  await page.click('#col-list [data-remove="0"]');
  await clickAndWait(page, "#save-schema-btn", "/films/_schema");
  assert.equal((await owner.api("GET", "/api/v1/films/_schema")).listColumns, null);
});

test("'Schema saved.' confirmation stays visible after the re-render", async () => {
  await owner.api("PUT", "/api/v1/savemsg/_schema", { collectionType: "json", schema: { type: "object" } });
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/collections/savemsg?tab=schema");
  await page.waitForSelector("#save-schema-btn");
  await page.type("#display-name-input", "{title}");
  await clickAndWait(page, "#save-schema-btn", "/savemsg/_schema");
  await page.waitForFunction(() => document.querySelector("#display-name-input")?.value === "{title}");
  await waitText(page, "#schema-error .alert-success", "Schema saved.");
});

test("schema tab: switch to binary and back, remove the schema (confirm)", async () => {
  await owner.api("PUT", "/api/v1/files/_schema", { collectionType: "json", schema: { type: "object" } });
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/collections/files?tab=schema");
  await page.waitForSelector("#save-schema-btn");
  await page.click('[name="collectionType"][value="binary"]');
  assert.equal(await page.$eval("#json-schema-fields", e => e.style.display), "none");
  assert.equal(await page.$eval("#binary-note", e => e.style.display), "");
  await page.click('[name="collectionType"][value="json"]');
  assert.equal(await page.$eval("#json-schema-fields", e => e.style.display), "");
  await page.click('[name="collectionType"][value="binary"]');
  await clickAndWait(page, "#save-schema-btn", "/files/_schema");
  await page.waitForFunction(() => document.querySelector('[name="collectionType"][value="binary"]')?.checked && document.querySelector("#binary-note")?.style.display === "");
  assert.equal((await owner.api("GET", "/api/v1/files/_schema")).collectionType, "binary");
  // Binary collections call the documents tab "Assets"
  await go(page, "#/collections/files");
  await waitText(page, '#col-tabs [data-tab="documents"]', "Assets");
  await waitText(page, "#tab-content", "0 assets");
  assert.equal(await text(page, "#new-doc-btn"), "Upload file");

  // Remove the schema: dismiss first, then accept
  await go(page, "#/collections/files?tab=schema");
  await page.waitForSelector("#delete-schema-btn");
  page.dialogMode = "dismiss";
  await page.click("#delete-schema-btn");
  page.dialogMode = "accept";
  assert.ok(await page.$("#delete-schema-btn"));
  await page.click("#delete-schema-btn");
  await waitText(page, "#tab-content .alert", "No schema is defined");
  assert.ok(page.dialogs.some(d => d.message === "Remove schema for this collection?"));
  await assert.rejects(owner.api("GET", "/api/v1/files/_schema"), /404/);
});

test("schema tab: server errors on remove and on create-default are shown", async () => {
  const acct = await account("schemerr");
  await acct.api("PUT", "/api/v1/gone/_schema", { collectionType: "json", schema: { type: "object" } });
  const page = await ctx.newPage({ acct });
  await openAdmin(page, "#/collections/gone?tab=schema");
  await page.waitForSelector("#delete-schema-btn");
  // Removed elsewhere meanwhile → 404 from the server
  await acct.api("DELETE", "/api/v1/gone/_schema");
  await page.click("#delete-schema-btn");
  await page.waitForSelector("#schema-error .alert-error");

  // Session expires → saving/creating fails with the server's message
  await go(page, "#/collections/none-yet?tab=schema");
  await page.waitForSelector("#create-default-schema-btn");
  await page.browserContext().deleteCookie(...(await page.browserContext().cookies()));
  await page.click("#create-default-schema-btn");
  await page.waitForSelector("#schema-error .alert-error");
  await page.click("#save-schema-btn");
  await page.waitForSelector("#schema-error .alert-error");
});

test("access tab: grant, inherited rules, revoke", async () => {
  const member = await addMember(owner, "aclmember", { name: "Ada Member" });
  const key = await owner.api("POST", "/api/v1/keys", { name: "reader-key" });
  await owner.api("POST", "/api/v1/permissions", { principal: "*", resource: "collection:*", access: "read", labelFilter: "published", auditReads: true });
  await owner.api("POST", "/api/v1/permissions", { principal: `key:${key.id}`, resource: "*", access: "write", filterLang: "jq", filterExpr: ".public == true and .visible == true and .other", auditWrites: true });
  await owner.api("POST", "/api/v1/permissions", { principal: "member:nobody", resource: "*", access: "admin" });
  await owner.api("POST", "/api/v1/acl", { title: "x" });
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/collections/acl?tab=access");
  await waitText(page, "#tab-content .card-header", "Rules for this collection");
  assert.match(await text(page, "#tab-content .empty-state"), /No direct rules/);
  const inherited = await page.$$eval(".muted-row", rows => rows.map(r => r.textContent.replace(/\s+/g, " ").trim()));
  // Every org also has the Editors/Viewers group rules on "*", shown by group name
  assert.ok(inherited.some(r => r.startsWith("Editors (group) * write")), inherited.join("\n"));
  assert.ok(inherited.some(r => r.startsWith("Viewers (group) * read")), inherited.join("\n"));
  assert.ok(inherited.some(r => r.includes("collection:*") && r.includes("label: published · audit reads")), inherited.join("\n"));
  assert.ok(inherited.some(r => r.startsWith("key: reader-key") && r.includes("jq: .public == true and .visible") && r.includes("audit writes")), inherited.join("\n"));
  assert.ok(inherited.some(r => r.startsWith("member:nobody")), inherited.join("\n"));

  // The "Who" list has Everyone, All members, each member and each key
  const who = await page.$$eval('#grant-form [name="principal"] option', os => os.map(o => o.textContent));
  assert.deepEqual(who.slice(0, 2), ["Everyone (*)", "All members (member:*)"]);
  assert.ok(who.includes(`${member.name} <${member.email}>`), who.join());
  assert.ok(who.includes("key: reader-key"));

  await page.select('#grant-form [name="principal"]', `member:${member.userId}`);
  await page.select('#grant-form [name="access"]', "write");
  await page.click('#grant-form button[type="submit"]');
  await waitText(page, "#tab-content .card:nth-child(2) tbody", member.email);
  await page.select('#grant-form [name="principal"]', `key:${key.id}`);
  await page.select('#grant-form [name="access"]', "read");
  await page.click('#grant-form button[type="submit"]');
  await waitText(page, "#tab-content .card-header .count-badge", "2");
  const direct = await page.$$eval("#tab-content .card:nth-child(2) tbody tr", rows => rows.map(r => r.textContent.replace(/\s+/g, " ").trim()));
  assert.ok(direct.some(r => r.includes(`${member.name} <${member.email}>`) && r.includes("write")), direct.join("\n"));
  assert.ok(direct.some(r => r.includes("key: reader-key") && r.includes("read")), direct.join("\n"));

  // Revoke one: dismiss first (nothing happens), then accept
  page.dialogMode = "dismiss";
  await page.click("[data-delete]");
  page.dialogMode = "accept";
  assert.equal(await page.$$eval("[data-delete]", b => b.length), 2);
  await page.click("[data-delete]");
  await page.waitForFunction(() => document.querySelectorAll("[data-delete]").length === 1);
  assert.ok(page.dialogs.some(d => d.message === "Revoke this permission?"));
  const perms = (await owner.api("GET", "/api/v1/permissions")).permissions.filter(p => p.resource === "collection:acl");
  assert.equal(perms.length, 1);
});

test("access tab: errors are shown (load and revoke)", async () => {
  const acct = await account("accesserr");
  const perm = await acct.api("POST", "/api/v1/permissions", { principal: "*", resource: "collection:pub", access: "read" });
  const page = await ctx.newPage({ acct });
  await openAdmin(page, "#/collections/pub?tab=access");
  await page.waitForSelector(`[data-delete="${perm.id}"]`);
  await acct.api("DELETE", `/api/v1/permissions/${perm.id}`);
  // Revoking an already-deleted rule → alert with the server error
  await page.click(`[data-delete="${perm.id}"]`);
  await waitDialog(page, "Not found");

  // Granting with an expired session → error under the form
  await page.browserContext().deleteCookie(...(await page.browserContext().cookies()));
  await page.click('#grant-form button[type="submit"]');
  await page.waitForSelector("#grant-error .alert-error");

  await page.browserContext().deleteCookie(...(await page.browserContext().cookies()));
  await go(page, "#/collections/pub?tab=schema");
  await page.waitForSelector("#save-schema-btn");
  await go(page, "#/collections/pub?tab=access");
  await page.waitForSelector("#tab-content .alert-error");
});
