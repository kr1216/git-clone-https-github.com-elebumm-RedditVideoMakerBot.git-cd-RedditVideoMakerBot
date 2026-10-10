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
const fixtureLive = readFileSync(path.join(ext, 'test/fixture-live.html'), 'utf8');
const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'wns-')), {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
await ctx.route('https://www.whatnot.com/**', (r) => r.fulfill({
  status: 200, contentType: 'text/html; charset=utf-8', body: r.request().url().includes('/live/') ? fixtureLive : fixture,
}));
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
// chrome.* can be missing for a moment while the worker starts.
for (let i = 0; i < 50 && !(await sw.evaluate(() => !!globalThis.chrome?.storage)); i++) await new Promise((r) => setTimeout(r, 200));
// Two sources are enough for the test.
await sw.evaluate(() => chrome.storage.sync.set({ settings: { peekEnabled: true, peekTop: 2, sources: [
  { name: 'Lego', url: 'https://www.whatnot.com/search?query=lego%20giveaway' },
  { name: 'Knives', url: 'https://www.whatnot.com/search?query=knives%20giveaway' },
] } }));
let scan;
for (let i = 0; i < 120 && !scan?.peeks; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  ({ scan } = await sw.evaluate(() => chrome.storage.local.get('scan')));
}
assert.ok(scan, 'scan finished');
const byId = Object.fromEntries(scan.streams.map((s) => [s.id, s]));
console.log(scan.streams.map((s) => `${s.id} live=${s.live} v=${s.viewers} gw=${s.giveaway} $${s.value} per=${s.perEntry.toFixed(3)} seller=${s.seller} src=${s.sources} | ${s.title}`).join('\n'));
assert.equal(scan.streams.length, 6);
assert.equal(scan.streams[0].id, '3f1c2a9e-0001', 'best value first');
const s1 = byId['3f1c2a9e-0001'];
assert.equal(s1.live, true, '"Live · 42" means live');
assert.equal(s1.viewers, 42);
assert.equal(s1.title, '$1 STARTS + $80 ZIPPO GIVEAWAY every 15 min', 'title, not the longer tag line');
assert.equal(s1.value, 80);
assert.equal(s1.seller, 'edcking');
assert.deepEqual(s1.sources, ['Lego', 'Knives']);
assert.equal(byId['3f1c2a9e-0002'].viewers, 1200);
assert.equal(byId['3f1c2a9e-0002'].seller, 'brickhaus', 'no avatar letter or "Sponsored"');
assert.equal(byId['3f1c2a9e-0002'].title, 'Lego retired sets — giveaways all night!');
assert.equal(byId['3f1c2a9e-0003'].buyersOnly, true);
assert.equal(byId['3f1c2a9e-0004'].live, false, 'scheduled show is not live');
assert.equal(byId['3f1c2a9e-0004'].upcoming, true);
assert.equal(byId['3f1c2a9e-0004'].value, 500);
assert.equal(byId['3f1c2a9e-0005'].title, '🌪️🔥LUNCH TIME SPECIAL 🔥🌪️');
assert.equal(byId['3f1c2a9e-0005'].giveaway, false, '"giveaway" only in the tags does not count');
assert.equal(byId['3f1c2a9e-0006'].valueGuessed, true, 'a show total is not a prize');
assert.ok(scan.diag[0].navLinks.some((l) => /See all shows/.test(l.text)));
assert.equal(scan.blocked, false);
// Peeks: the two best giveaway streams were opened and their panels read.
console.log(JSON.stringify(scan.peeks.map(({ id, found, secondsLeft, entrants, prize }) => ({ id, found, secondsLeft, entrants, prize }))));
assert.equal(scan.peeks.length, 2);
const p1 = scan.peeks.find((p) => p.id === '3f1c2a9e-0001');
assert.ok(p1?.found, 'giveaway panel found');
assert.equal(p1.entrants, 37);
assert.equal(p1.prize, 'Zippo Classic Lighter $80');
assert.ok(p1.secondsLeft > 20 && p1.secondsLeft <= 45, `giveaway countdown, not the auction's 0:12 (got ${p1.secondsLeft})`);
const { liveReads, alerted } = await sw.evaluate(() => chrome.storage.local.get(['liveReads', 'alerted']));
assert.equal(liveReads['3f1c2a9e-0001'].via, 'peek');
assert.ok(alerted['peek:3f1c2a9e-0001:Zippo Classic Lighter $80'], 'countdown alert sent ($80 / 38 = $2.1 per entry)');
const scannerMuted = await sw.evaluate(async () => {
  const { scanner } = await chrome.storage.session.get('scanner');
  return (await chrome.tabs.get(scanner.tabId)).mutedInfo.muted;
});
assert.equal(scannerMuted, true, 'scan window is muted');

// Option 1: a stream you open yourself is read and logged.
const mine = await ctx.newPage();
await mine.goto('https://www.whatnot.com/live/3f1c2a9e-0002');
let seen;
for (let i = 0; i < 20 && !seen?.some((g) => g.via === 'you'); i++) {
  await new Promise((r) => setTimeout(r, 1000));
  ({ gaSeen: seen } = await sw.evaluate(() => chrome.storage.local.get('gaSeen')));
}
const you = seen.find((g) => g.via === 'you');
assert.ok(you, 'giveaway in a stream you opened was logged');
assert.equal(you.id, '3f1c2a9e-0002');
assert.equal(you.entrants, 37);
await mine.close();

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
    assert.equal(await page.locator('.row').count(), 4, 'four live giveaway rows');
    assert.match(await page.locator('.row').first().innerText(), /ZIPPO/);
    await page.screenshot({ path: process.env.SHOT || '/dev/null' }).catch(() => {});
  } else {
    assert.match(await page.locator('#sources').inputValue(), /Knives \| https:\/\/www\.whatnot\.com/);
  }
}
assert.deepEqual(errors, []);
console.log(`e2e ok (scan took ${scan.tookMs} ms)`);
await ctx.close();
