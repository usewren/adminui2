// Trees: list, browse, breadcrumbs, folders, assign (browse / create new / direct id),
// add child documents, reassign, unassign, remove folder, label filter, errors.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { account, launch, openAdmin, go, text, waitText, setValue, uploadAsset, waitDialog } from "./lib/harness.mjs";

let ctx, owner, docs;
before(async () => {
  ctx = await launch();
  owner = await account("arborist", { name: "Arbo Rist" });
  await owner.api("PUT", "/api/v1/pages/_schema", { collectionType: "json", schema: { type: "object" }, displayName: "{title}", listColumns: ["lang"] });
  docs = {};
  for (const [k, title] of [["home", "Home Page"], ["about", "About Us"], ["post", "First Post"], ["second", "Second Post"]]) {
    docs[k] = await owner.api("POST", "/api/v1/pages", { title, lang: "en" });
  }
  docs.plain = await owner.api("POST", "/api/v1/plain", { x: 1 }); // no schema → id-derived names
  await owner.api("PUT", "/api/v1/images/_schema", { collectionType: "binary" });
  docs.logo = await uploadAsset(owner, "images", "Logo File.png", "png-bytes", "image/png");
});
after(async () => { await ctx.close(); });

const hash = page => page.evaluate(() => decodeURIComponent(location.hash));
// The tree page for path p has rendered: its breadcrumb title ends with p's last
// segment (titles are rendered first, synchronously) and the content has loaded
const pathLoaded = (page, p) => page.waitForFunction(p => {
  const last = p.split("/").filter(Boolean).pop();
  return decodeURIComponent(location.hash).includes(`path=${p}`)
    && document.querySelector(".page-title")?.textContent.trim().endsWith(last ? `› ${last}` : ":/")
    && document.querySelector("#tree-content .card") && !document.querySelector("#tree-content .loading");
}, {}, p);

test("trees overview: empty, then listed in the page and the sidebar", async () => {
  const fresh = await account("notrees");
  const page = await ctx.newPage({ acct: fresh });
  await openAdmin(page, "#/trees");
  await waitText(page, ".empty-state", "No trees found.");
  assert.ok(await page.$eval('[data-route="trees"]', a => a.classList.contains("active")));

  await owner.api("PUT", "/api/v1/tree/site/about", { documentId: docs.about.id });
  const p2 = await ctx.newPage({ acct: owner });
  await openAdmin(p2, "#/trees");
  await waitText(p2, ".table", "site");
  await waitText(p2, "#sidebar-trees", "site");
  await p2.click('.table a.btn[href="#/trees/site"]');
  await p2.waitForSelector("#tree-content .card");
  assert.ok(await p2.$eval('#sidebar-trees [data-tree="site"]', a => a.classList.contains("active")));
  // Sidebar sublists collapse and expand with the arrow
  await p2.click('.sidebar-toggle[data-target="sidebar-trees"]');
  assert.ok(await p2.$eval("#sidebar-trees", e => e.classList.contains("collapsed")));
  await p2.click('.sidebar-toggle[data-target="sidebar-trees"]');
  assert.ok(!(await p2.$eval("#sidebar-trees", e => e.classList.contains("collapsed"))));
});

test("assign at the root via Browse; open the child; breadcrumbs", async () => {
  await owner.api("PUT", "/api/v1/tree/site/about", { documentId: docs.about.id });
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/trees/site");
  await waitText(page, "#assign-card .card-header", "Assign document to /");
  assert.match(await text(page, "#tree-content .card"), /Contents\s*1/);
  assert.match(await text(page, "#tree-content tbody tr"), /📄 about/);

  // Browse: choose a collection → its documents with display names and list columns
  await page.waitForSelector("#picker-col-select");
  assert.match(await text(page, "#picker-doc-list"), /Select a collection above/);
  await page.select("#picker-col-select", "pages");
  await waitText(page, "#picker-doc-list", "Home Page");
  assert.deepEqual(await page.$$eval("#picker-doc-list thead th", t => t.map(e => e.textContent)), ["Name", "lang", ""]);
  // Deselecting clears the list
  await page.select("#picker-col-select", "");
  await waitText(page, "#picker-doc-list", "Select a collection above");
  await page.select("#picker-col-select", "pages");
  await page.waitForSelector(`[data-pick-doc="${docs.home.id}"]`);
  await page.click(`[data-pick-doc="${docs.home.id}"]`);
  await waitText(page, "#tree-content .card-header", "Document at this path");
  assert.match(await text(page, "#tree-content .card-header"), /pages \/ .*v1/);
  assert.match(await text(page, "#tree-content pre.code-block"), /Home Page/);
  assert.equal((await owner.api("GET", "/api/v1/tree/site/")).document.id, docs.home.id);

  // Open the child by clicking its row (not the link)
  await page.click("#tree-content tbody tr.clickable-row td:nth-child(2)");
  await pathLoaded(page, "/about");
  await waitText(page, "#tree-content .card-header", "Document at this path");
  assert.equal(await text(page, ".page-title"), "site:/ › about");
  // "Open" goes to the document
  await page.click('#tree-content a.btn[href^="#/collections/pages/"]');
  await page.waitForFunction(id => location.hash === `#/collections/pages/${id}`, {}, docs.about.id);
  await page.waitForSelector("#doc-editor");
});

test("new folder, create & assign a new document, add children (typed, display rule, filename, id)", async () => {
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/trees/site");
  await page.waitForSelector("#new-folder-btn");
  await page.click("#new-folder-btn");
  await page.type("#new-folder-input", "tmp");
  await page.click("#new-folder-cancel");
  assert.equal(await page.$eval("#new-folder-form", e => e.style.display), "none");
  assert.equal(await page.$eval("#new-folder-input", e => e.value), "");
  // Empty name does nothing
  await page.click("#new-folder-btn");
  await page.click("#new-folder-go");
  assert.equal(await hash(page), "#/trees/site");
  await page.type("#new-folder-input", "/blog/");
  await page.keyboard.press("Enter");
  await pathLoaded(page, "/blog");
  assert.equal(await text(page, ".page-title"), "site:/ › blog");
  await page.waitForSelector("#assign-card #picker-tabs");

  // Create new: needs a collection and valid JSON
  await page.click('[data-picker-tab="create"]');
  await page.waitForSelector("#picker-create-btn");
  await page.click("#picker-create-btn");
  await waitText(page, "#picker-create-error", "Select a collection");
  await page.select("#picker-create-col", "pages");
  await setValue(page, "#picker-create-json", "{ bad");
  await page.click("#picker-create-btn");
  await waitText(page, "#picker-create-error", "Invalid JSON");
  await setValue(page, "#picker-create-json", JSON.stringify({ title: "Blog Index", lang: "en" }));
  await page.click("#picker-create-btn");
  await waitText(page, "#tree-content .card-header", "Document at this path");
  assert.match(await text(page, "#tree-content pre.code-block"), /Blog Index/);

  // Add child with a typed segment (Browse)
  await page.click("#add-child-doc-btn");
  await page.waitForSelector("#add-child-picker-container #picker-col-select");
  await page.type("#add-child-name-input", "first-post");
  await page.select("#add-child-picker-container #picker-col-select", "pages");
  await page.waitForSelector(`#add-child-picker-container [data-pick-doc="${docs.post.id}"]`);
  await page.click(`#add-child-picker-container [data-pick-doc="${docs.post.id}"]`);
  await waitText(page, "#tree-content tbody", "first-post");

  // Add child without a segment → named from the display rule ("Second Post" → "Second-Post")
  await page.click("#add-child-doc-btn");
  await page.waitForSelector("#add-child-picker-container #picker-col-select");
  await page.select("#add-child-picker-container #picker-col-select", "pages");
  await page.waitForSelector(`#add-child-picker-container [data-pick-doc="${docs.second.id}"]`);
  await page.click(`#add-child-picker-container [data-pick-doc="${docs.second.id}"]`);
  await waitText(page, "#tree-content tbody", "Second-Post");

  // … from a binary asset's filename ("Logo File.png" → "Logo-File.png"), in a binary picker
  await page.click("#add-child-doc-btn");
  await page.waitForSelector("#add-child-picker-container #picker-col-select");
  await page.select("#add-child-picker-container #picker-col-select", "images");
  await waitText(page, "#add-child-picker-container thead", "Filename");
  assert.match(await text(page, "#add-child-picker-container tbody tr"), /Logo File\.png\s+image\/png\s+9 B/);
  await page.click(`#add-child-picker-container [data-pick-doc="${docs.logo.id}"]`);
  await waitText(page, "#tree-content tbody", "Logo-File.png");

  // … from the id when there is no rule (Direct ID tab)
  await page.click("#add-child-doc-btn");
  await page.waitForSelector('#add-child-picker-container [data-picker-tab="direct"]');
  await page.click('#add-child-picker-container [data-picker-tab="direct"]');
  await page.type("#add-child-picker-container #picker-direct-id", docs.plain.id);
  await page.click('#add-child-picker-container #picker-direct-form button[type="submit"]');
  await waitText(page, "#tree-content tbody", docs.plain.id.slice(0, 8));

  // Cancel hides and resets the add-child form
  await page.click("#add-child-doc-btn");
  await page.type("#add-child-name-input", "zzz");
  await page.click("#add-child-cancel");
  assert.equal(await page.$eval("#add-child-doc-form", e => e.style.display), "none");
  assert.equal(await page.$eval("#add-child-name-input", e => e.value), "");

  const names = await page.$$eval("#tree-content tbody tr td:first-child", t => t.map(e => e.textContent.trim()));
  assert.deepEqual(names, [`📄 ${docs.plain.id.slice(0, 8)}`, "📄 first-post", "📄 Logo-File.png", "📄 Second-Post"]);
  const paths = (await owner.api("GET", "/api/v1/tree/site?full=true")).nodes.map(n => n.path).sort();
  assert.ok(paths.includes("/blog/first-post") && paths.includes("/blog/Second-Post") && paths.includes("/blog/Logo-File.png"), paths.join());

  // The root listing now shows "blog/" as a folder; it has its own document too, so
  // the info column shows that document's id
  await go(page, "#/trees/site");
  await waitText(page, "#tree-content tbody", "blog/");
  assert.match(await text(page, "#tree-content tbody"), /📁 blog\/\s*[0-9a-f-]{12}…/);
});

test("reassign (Direct ID), cancel, unassign, remove folder", async () => {
  await owner.api("PUT", "/api/v1/tree/docs/guide", { documentId: docs.home.id });
  await owner.api("PUT", "/api/v1/tree/docs/guide/intro", { documentId: docs.about.id });
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, `#/trees/docs?path=${encodeURIComponent("/guide")}`);
  await waitText(page, "#tree-content .card-header", "Document at this path");
  assert.equal(await page.$eval("#assign-card", e => e.style.display), "none");

  await page.click("#reassign-btn");
  assert.equal(await page.$eval("#assign-card", e => e.style.display), "");
  await page.click("#cancel-reassign-btn");
  assert.equal(await page.$eval("#assign-card", e => e.style.display), "none");
  assert.equal(await page.$eval("#picker-container", e => e.innerHTML), "");

  await page.click("#reassign-btn");
  await page.waitForSelector('#picker-container [data-picker-tab="direct"]');
  await page.click('#picker-container [data-picker-tab="direct"]');
  // Empty id does nothing
  await page.click('#picker-direct-form button[type="submit"]');
  await page.type("#picker-direct-id", docs.second.id);
  await page.click('#picker-direct-form button[type="submit"]');
  await waitText(page, "#tree-content pre.code-block", "Second Post");
  assert.equal((await owner.api("GET", "/api/v1/tree/docs/guide")).document.id, docs.second.id);

  // Unassign: dismiss, then accept → path stays (it has a child) and offers "Remove folder"
  page.dialogMode = "dismiss";
  await page.click("#unassign-btn");
  page.dialogMode = "accept";
  assert.ok(await page.$("#unassign-btn"));
  await page.click("#unassign-btn");
  await page.waitForSelector("#remove-folder-btn");
  assert.ok(page.dialogs.some(d => d.message.startsWith('Unassign document from "/guide"?')));
  assert.equal((await owner.api("GET", "/api/v1/tree/docs/guide")).document, null);

  page.dialogMode = "dismiss";
  await page.click("#remove-folder-btn");
  page.dialogMode = "accept";
  await page.click("#remove-folder-btn");
  await page.waitForFunction(() => decodeURIComponent(location.hash) === "#/trees/docs?path=/");
  assert.ok(page.dialogs.some(d => d.message === 'Remove folder "/guide"? 1 descendant path will remain and the folder will reappear as an implicit parent.'));
  // The child is still there under an implicit "guide/" folder
  await waitText(page, "#tree-content tbody", "guide/");
});

test("label filter: input and Filter button put the label into the URL", async () => {
  await owner.api("PUT", "/api/v1/tree/lbl2/", { documentId: docs.home.id });
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/trees/lbl2");
  await page.waitForSelector("#label-input");
  await page.type("#label-input", "published");
  const typed = await page.$("#label-input");
  await page.click("#label-btn");
  await page.waitForFunction(() => decodeURIComponent(location.hash) === "#/trees/lbl2?path=/&label=published");
  // Wait for the re-rendered input (clearing the old one would be undone by the render)
  await page.waitForFunction(old => document.querySelector("#label-input") !== old, {}, typed);
  await page.waitForFunction(() => document.querySelector("#label-input")?.value === "published");
  await setValue(page, "#label-input", "");
  await page.click("#label-btn");
  await page.waitForFunction(() => decodeURIComponent(location.hash) === "#/trees/lbl2?path=/");
});

test("tree label filter shows the labeled versions", async () => {
  const doc = await owner.api("POST", "/api/v1/pages", { title: "Versioned v1" });
  await owner.api("POST", `/api/v1/pages/${doc.id}/labels`, { label: "published" });
  await owner.api("PUT", `/api/v1/pages/${doc.id}`, { title: "Versioned v2" });
  await owner.api("PUT", "/api/v1/tree/lbl/", { documentId: doc.id });
  await owner.api("PUT", "/api/v1/tree/lbl/draft", { documentId: docs.home.id });
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/trees/lbl");
  await waitText(page, "#tree-content pre.code-block", "Versioned v2");
  await page.type("#label-input", "published");
  await page.click("#label-btn");
  await page.waitForFunction(() => decodeURIComponent(location.hash) === "#/trees/lbl?path=/&label=published");
  await page.waitForFunction(() => document.querySelector("#label-input")?.value === "published" && document.querySelector("#tree-content pre.code-block"));
  await waitText(page, "#tree-content pre.code-block", "Versioned v1");
  // The unlabeled /draft is not visible under the label
  await go(page, `#/trees/lbl?path=${encodeURIComponent("/draft")}&label=published`);
  await page.waitForSelector("#assign-card .card-header");
});

test("tree errors: unknown document id, expired session", async () => {
  const acct = await account("treeerr");
  const doc = await acct.api("POST", "/api/v1/things", { t: 1 });
  await acct.api("PUT", "/api/v1/tree/t/a", { documentId: doc.id });
  await acct.api("PUT", "/api/v1/tree/t/a/b", { documentId: doc.id });
  const page = await ctx.newPage({ acct });
  await openAdmin(page, `#/trees/t?path=${encodeURIComponent("/a")}`);
  await page.waitForSelector("#unassign-btn");
  // Open the picker while signed in (it loads the collection list), then lose the session
  await page.click("#reassign-btn");
  await page.waitForSelector('#picker-container [data-picker-tab="direct"]');
  await page.browserContext().deleteCookie(...(await page.browserContext().cookies()));

  // Each action reports the server error in an alert
  await page.click("#unassign-btn");
  await waitDialog(page, "nauthorized");
  page.dialogs.length = 0;
  await page.click("#new-folder-btn");
  await page.type("#new-folder-input", "x");
  await page.click("#new-folder-go");
  await waitDialog(page, "nauthorized");
  page.dialogs.length = 0;
  await page.click('#picker-container [data-picker-tab="direct"]');
  await page.type("#picker-direct-id", doc.id);
  await page.click('#picker-direct-form button[type="submit"]');
  await waitDialog(page, "nauthorized");
  // Create & assign reports in the form
  await page.click('#picker-container [data-picker-tab="create"]');
  await page.select("#picker-create-col", "things");
  await page.click("#picker-create-btn");
  await waitText(page, "#picker-create-error .alert-error", "nauthorized");
  // Browse: loading the collection's documents fails → empty list
  await page.click('#picker-container [data-picker-tab="browse"]');
  await page.select("#picker-col-select", "things");
  await waitText(page, "#picker-doc-list", "No documents found.");
  // A picker opened without a session has no collections to choose from
  await page.click("#cancel-reassign-btn");
  await page.click("#reassign-btn");
  await page.waitForSelector("#picker-container #picker-col-select");
  assert.deepEqual(await page.$$eval("#picker-col-select option", o => o.map(x => x.value)), [""]);

  // Loading a path fails → error alert in place of the content
  await go(page, `#/trees/t?path=${encodeURIComponent("/a/b")}`);
  await page.waitForSelector("#tree-content .alert-error");
  await go(page, "#/trees");
  await page.waitForSelector("#main .alert-error");
});

test("remove-folder errors are reported", async () => {
  const acct = await account("treeerr2");
  const doc = await acct.api("POST", "/api/v1/things", { t: 1 });
  await acct.api("PUT", "/api/v1/tree/t/f", {});
  await acct.api("PUT", "/api/v1/tree/t/f/leaf", { documentId: doc.id });
  const page = await ctx.newPage({ acct });
  await openAdmin(page, `#/trees/t?path=${encodeURIComponent("/f")}`);
  await page.waitForSelector("#remove-folder-btn");
  await page.browserContext().deleteCookie(...(await page.browserContext().cookies()));
  await page.click("#remove-folder-btn");
  await waitDialog(page, "nauthorized");
});

test("a new empty folder is listed as a folder and can be removed", async () => {
  const acct = await account("emptyfolder");
  const page = await ctx.newPage({ acct });
  await acct.api("PUT", "/api/v1/tree/e/keep", { documentId: (await acct.api("POST", "/api/v1/x", {})).id });
  await openAdmin(page, "#/trees/e");
  await page.waitForSelector("#new-folder-btn");
  await page.click("#new-folder-btn");
  await page.type("#new-folder-input", "empty");
  await page.click("#new-folder-go");
  await pathLoaded(page, "/empty");
  await go(page, "#/trees/e");
  await waitText(page, "#tree-content tbody", "empty");
  assert.match(await text(page, "#tree-content tbody"), /📁 empty\/\s*empty/);
  await go(page, `#/trees/e?path=${encodeURIComponent("/empty")}`);
  await page.waitForSelector("#remove-folder-btn");
  await page.click("#remove-folder-btn");
  await page.waitForFunction(() => decodeURIComponent(location.hash) === "#/trees/e?path=/");
  await page.waitForSelector("#tree-content tbody");
  assert.doesNotMatch(await text(page, "#tree-content tbody"), /empty/);
  assert.deepEqual((await acct.api("GET", "/api/v1/tree/e")).children.map(c => c.path), ["/keep"]);
});

test("Direct ID with an unknown document id reports 'Document not found'", async () => {
  const acct = await account("unknownid");
  const page = await ctx.newPage({ acct });
  await openAdmin(page, "#/trees/u");
  await page.waitForSelector('#picker-container [data-picker-tab="direct"]');
  await page.click('#picker-container [data-picker-tab="direct"]');
  await page.type("#picker-direct-id", "00000000-0000-0000-0000-000000000000");
  await page.click('#picker-direct-form button[type="submit"]');
  await waitDialog(page, "Document not found");
});
