// Loads the unpacked extension in Chromium, serves the fixture for every
// www.whatnot.com page, lets the first scheduled scan run and checks its result.
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

// require() honours NODE_PATH, so a globally installed Playwright works.
const { chromium } = createRequire(import.meta.url)('playwright');

const ext = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const fixture = readFileSync(path.join(ext, 'test/fixture-search.html'), 'utf8');
const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'wns-')), {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
await ctx.route('https://www.whatnot.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixture }));
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
// chrome.* can be missing for a moment while the worker starts.
for (let i = 0; i < 50 && !(await sw.evaluate(() => !!globalThis.chrome?.storage)); i++) await new Promise((r) => setTimeout(r, 200));
// Two sources are enough for the test.
await sw.evaluate(() => chrome.storage.sync.set({ settings: { sources: [
  { name: 'Lego', url: 'https://www.whatnot.com/search?query=lego%20giveaway' },
  { name: 'Knives', url: 'https://www.whatnot.com/search?query=knives%20giveaway' },
] } }));
let scan;
for (let i = 0; i < 90 && !scan; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  ({ scan } = await sw.evaluate(() => chrome.storage.local.get('scan')));
}
assert.ok(scan, 'scan finished');
const byId = Object.fromEntries(scan.streams.map((s) => [s.id, s]));
console.log(scan.streams.map((s) => `${s.id} live=${s.live} v=${s.viewers} gw=${s.giveaway} $${s.value} per=${s.perEntry.toFixed(3)} seller=${s.seller} src=${s.sources} | ${s.title}`).join('\n'));
assert.equal(scan.streams.length, 5);
assert.equal(scan.streams[0].id, '3f1c2a9e-0001', 'best value first');
assert.equal(byId['3f1c2a9e-0001'].viewers, 42);
assert.equal(byId['3f1c2a9e-0001'].value, 80);
assert.equal(byId['3f1c2a9e-0001'].seller, 'edcking');
assert.deepEqual(byId['3f1c2a9e-0001'].sources, ['Lego', 'Knives']);
assert.equal(byId['3f1c2a9e-0002'].viewers, 1200);
assert.equal(byId['3f1c2a9e-0003'].buyersOnly, true);
assert.equal(byId['3f1c2a9e-0004'].live, false, 'scheduled show is not live');
assert.equal(byId['3f1c2a9e-0004'].value, 500);
assert.equal(byId['3f1c2a9e-0005'].giveaway, false);
assert.equal(scan.blocked, false);
const badge = await sw.evaluate(() => chrome.action.getBadgeText({}));
assert.equal(badge, '1', 'one hot stream');
// The popup and settings pages render the scan without errors.
const extId = new URL(sw.url()).host;
const errors = [];
for (const file of ['popup.html', 'options.html']) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${file}: ${e.message}`));
  await page.goto(`chrome-extension://${extId}/${file}`);
  await page.waitForTimeout(800);
  if (file === 'popup.html') {
    assert.equal(await page.locator('.row').count(), 3, 'three live giveaway rows');
    assert.match(await page.locator('.row').first().innerText(), /ZIPPO/);
    await page.screenshot({ path: process.env.SHOT || '/dev/null' }).catch(() => {});
  } else {
    assert.match(await page.locator('#sources').inputValue(), /Knives \| https:\/\/www\.whatnot\.com/);
  }
}
assert.deepEqual(errors, []);
console.log(`e2e ok (scan took ${scan.tookMs} ms)`);
await ctx.close();
