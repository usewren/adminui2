// Binary collections: upload, list, preview by type, download, replace, metadata,
// history with per-version downloads, and the data-level binary fallback.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE, account, launch, openAdmin, go, text, waitText, setValue, uploadAsset } from "./lib/harness.mjs";

// 1×1 transparent PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

let ctx, owner, dir;
before(async () => {
  ctx = await launch();
  owner = await account("uploader", { name: "Up Loader" });
  await owner.api("PUT", "/api/v1/media/_schema", { collectionType: "binary" });
  dir = mkdtempSync(join(tmpdir(), "wren-e2e-"));
});
after(async () => { await ctx.close(); });

function file(name, content) {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

test("upload an image through the UI, preview, download link, list row", async () => {
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/collections/media");
  await waitText(page, "#tab-content", "0 assets");
  assert.match(await text(page, "#tab-content .empty-state"), /No assets yet/);
  await page.click("#new-doc-btn");
  await page.click("#cancel-doc-btn");
  await page.click("#new-doc-btn");
  const input = await page.$('#create-doc-form input[type="file"]');
  await input.uploadFile(file("pixel.png", PNG));
  await page.click('#create-doc-form button[type="submit"]');
  await page.waitForFunction(() => /^#\/collections\/media\/[0-9a-f-]{36}$/.test(location.hash));

  await waitText(page, '#doc-tabs [data-tab="view"]', "Asset");
  await waitText(page, "#tab-content .card-header strong", "pixel.png");
  const header = await text(page, "#tab-content .card-header");
  assert.match(header, /image\/png/);
  assert.match(header, /70 B/);
  assert.match(header, /v1/);
  const id = (await page.evaluate(() => location.hash)).split("/").pop();
  const img = await page.waitForSelector("#tab-content img");
  await page.waitForFunction(i => i.complete && i.naturalWidth === 1, {}, img);
  const dl = await page.$eval("#tab-content a[download]", a => ({ href: a.href, name: a.getAttribute("download") }));
  assert.equal(dl.href, `${BASE}/api/v1/media/${id}/raw`);
  assert.equal(dl.name, "pixel.png");

  await go(page, "#/collections/media");
  await waitText(page, "#tab-content", "1 asset");
  const row = await text(page, ".table tbody tr");
  assert.match(row, /pixel\.png\s+image\/png\s+70 B\s+1/);
  assert.deepEqual(await page.$$eval(".table thead th", t => t.map(e => e.textContent)), ["Filename", "Type", "Size", "Version", "Updated"]);
});

test("replace the file → v2; history offers a download per version; metadata edit", async () => {
  const doc = await uploadAsset(owner, "media", "notes.txt", "first text", "text/plain");
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, `#/collections/media/${doc.id}`);
  await page.waitForSelector("#replace-form");
  const input = await page.$('#replace-form input[type="file"]');
  await input.uploadFile(file("notes.txt", "second, longer text"));
  await page.click('#replace-form button[type="submit"]');
  await waitText(page, "#tab-content .card-header", "v2");
  assert.match(await text(page, "#tab-content .card-header"), /19 B/);
  // The confirmation survives the re-render that shows v2, and the preview is updated
  await waitText(page, "#replace-error .alert-success", "File replaced successfully.");
  await waitText(page, "#text-preview pre", "second, longer text");

  // Metadata: invalid JSON, then a valid edit
  const meta = JSON.parse(await page.$eval("#meta-editor", e => e.value));
  assert.equal(meta.filename, "notes.txt");
  await setValue(page, "#meta-editor", "{ nope");
  await page.click("#meta-save-btn");
  await waitText(page, "#meta-error", "Invalid JSON");
  await setValue(page, "#meta-editor", JSON.stringify({ ...meta, alt: "Some notes" }));
  await page.click("#meta-save-btn");
  await waitText(page, "#meta-error", "Saved.");
  assert.equal((await owner.api("GET", `/api/v1/media/${doc.id}`)).data.alt, "Some notes");

  await page.click('#doc-tabs [data-tab="history"]');
  await page.waitForSelector("#tab-content .timeline");
  assert.equal(await page.$("#diff-toggle-btn"), null, "no diff for binary assets");
  const links = await page.$$eval("#tab-content a[download]", as => as.map(a => ({ t: a.textContent, href: a.getAttribute("href") })));
  assert.ok(links.some(l => l.t === "Download v1" && l.href.endsWith(`/media/${doc.id}/raw?version=1`)), JSON.stringify(links));
  assert.ok(links.some(l => l.t === "Download v2" && l.href.endsWith("raw?version=2")), JSON.stringify(links));
  const v1 = await (await fetch(`${BASE}/api/v1/media/${doc.id}/raw?version=1`, { headers: { Cookie: owner.cookie } })).text();
  assert.equal(v1, "first text");
});

test("replacing a file with identical bytes keeps the current version (deduplicated)", async () => {
  const doc = await uploadAsset(owner, "media", "same.txt", "identical bytes", "text/plain");
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, `#/collections/media/${doc.id}`);
  await page.waitForSelector("#replace-form");
  const input = await page.$('#replace-form input[type="file"]');
  await input.uploadFile(file("same.txt", "identical bytes"));
  // Wait for the upload and the re-read the page does before showing the notice (each
  // with puppeteer's 30 s default) instead of giving the whole round trip 10 s: under
  // load (four test files with their own Chrome) it can take longer
  const isDoc = (r, method) => new URL(r.url()).pathname.endsWith(`/media/${doc.id}`) && r.request().method() === method;
  const [put] = await Promise.all([
    page.waitForResponse(r => isDoc(r, "PUT")),
    page.waitForResponse(r => isDoc(r, "GET")),
    page.click('#replace-form button[type="submit"]'),
  ]);
  assert.equal(put.status(), 200);
  assert.equal((await put.json()).unchanged, true);
  await waitText(page, "#replace-error .alert-success", "Same file as the current version (v1); no new version was created.");
  assert.match(await text(page, "#tab-content .card-header"), /v1/);
  assert.equal((await owner.api("GET", `/api/v1/media/${doc.id}`)).version, 1);
});

test("text assets show a preview of their content", async () => {
  const doc = await uploadAsset(owner, "media", "readme.txt", "hello preview", "text/plain");
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, `#/collections/media/${doc.id}`);
  await waitText(page, "#text-preview pre", "hello preview");
  // Markup in the file is shown as text
  const html = await uploadAsset(owner, "media", "page.txt", "<b>not bold</b>", "text/plain");
  await go(page, `#/collections/media/${html.id}`);
  await waitText(page, "#text-preview pre", "<b>not bold</b>");
  assert.equal(await page.$("#text-preview b"), null);
  // A preview that can't be loaded says so
  await page.setRequestInterception(true);
  page.on("request", r => r.url().endsWith(`/${doc.id}/raw`) ? r.respond({ status: 500, body: "" }) : r.continue());
  await go(page, "#/");
  await go(page, `#/collections/media/${doc.id}`);
  await waitText(page, "#text-preview", "Could not load preview.");
});

test("previews for video, audio, PDF, other types and assets without a MIME type", async () => {
  const cases = [
    ["clip.mp4", "video/mp4", "video source"],
    ["song.mp3", "audio/mpeg", "audio source"],
    ["doc.pdf", "application/pdf", "iframe"],
    ["data.bin", "application/octet-stream", "a.btn[download]"],
  ];
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page);
  for (const [name, type, selector] of cases) {
    const doc = await uploadAsset(owner, "media", name, "x", type);
    await go(page, `#/collections/media/${doc.id}`);
    await page.waitForFunction(id => document.querySelector("h1.page-title")?.textContent === id, {}, doc.id);
    const el = await page.waitForSelector(`#tab-content .card-body ${selector}`);
    const src = await el.evaluate(e => e.getAttribute("src") ?? e.getAttribute("href"));
    assert.ok(src.endsWith(`/media/${doc.id}/raw`), `${name}: ${src}`);
  }
  // Data-level fallback: a document flagged _binary in a collection without schema,
  // without a MIME type → plain link preview, tab relabeled "Asset"
  const legacy = await owner.api("POST", "/api/v1/legacy", { _binary: true, filename: "old.dat" });
  await go(page, `#/collections/legacy/${legacy.id}`);
  await waitText(page, '#doc-tabs [data-tab="view"]', "Asset");
  await waitText(page, "#tab-content .card-body a.link", "old.dat");
});

test("upload and replace errors are shown", async () => {
  const acct = await account("uploaderr");
  await acct.api("PUT", "/api/v1/bin/_schema", { collectionType: "binary" });
  const doc = await uploadAsset(acct, "bin", "a.txt", "a", "text/plain");
  const page = await ctx.newPage({ acct });
  await openAdmin(page, "#/collections/bin");
  await page.waitForSelector("#new-doc-btn");
  await page.click("#new-doc-btn");
  // No file chosen (bypass the browser's required check) → client-side message
  await page.$eval('#create-doc-form input[type="file"]', i => i.removeAttribute("required"));
  await page.click('#create-doc-form button[type="submit"]');
  await waitText(page, "#new-doc-error", "Select a file");

  await go(page, `#/collections/bin/${doc.id}`);
  await page.waitForSelector("#replace-form");
  // Replace with no file selected does nothing
  await page.$eval('#replace-form input[type="file"]', i => i.removeAttribute("required"));
  await page.click('#replace-form button[type="submit"]');
  assert.equal(await text(page, "#replace-error"), "");

  // Session gone → server errors for upload, replace and metadata save
  await page.browserContext().deleteCookie(...(await page.browserContext().cookies()));
  const input = await page.$('#replace-form input[type="file"]');
  await input.uploadFile(file("b.txt", "b"));
  await page.click('#replace-form button[type="submit"]');
  await page.waitForSelector("#replace-error .alert-error");
  await page.click("#meta-save-btn");
  await page.waitForSelector("#meta-error .alert-error");
  await go(page, "#/collections/bin");
  await page.waitForSelector("#tab-content .alert-error");
});

test("a missing asset shows the server error", async () => {
  const page = await ctx.newPage({ acct: owner });
  await openAdmin(page, "#/collections/media/00000000-0000-0000-0000-000000000000");
  await waitText(page, "#tab-content .alert-error", "Not found");
  assert.equal(await text(page, '#doc-tabs [data-tab="view"]'), "Asset");
});

test("upload error from the server is shown in the upload form", async () => {
  const acct = await account("uploaderr2");
  await acct.api("PUT", "/api/v1/bin2/_schema", { collectionType: "binary" });
  const page = await ctx.newPage({ acct });
  await openAdmin(page, "#/collections/bin2");
  await page.waitForSelector("#new-doc-btn");
  await page.click("#new-doc-btn");
  await page.browserContext().deleteCookie(...(await page.browserContext().cookies()));
  const input = await page.$('#create-doc-form input[type="file"]');
  await input.uploadFile(file("c.txt", "c"));
  await page.click('#create-doc-form button[type="submit"]');
  await page.waitForSelector("#new-doc-error .alert-error");
});
