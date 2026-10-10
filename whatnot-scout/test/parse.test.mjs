import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreReading, isPeekHot, fmtClock, prizeAmounts, feedUrl, searchUrl, migrateSources, parseCount, analyzeTitle, scoreStream, mergeStreams, rank, isHot, DEFAULT_SETTINGS } from '../lib/parse.js';

test('parseCount', () => {
  assert.equal(parseCount('345'), 345);
  assert.equal(parseCount('1.2K'), 1200);
  assert.equal(parseCount('1,024'), 1024);
  assert.equal(parseCount('$5'), null);
  assert.equal(parseCount('LIVE'), null);
});

test('giveaway prize ignores auction start prices', () => {
  const a = analyzeTitle('$1 STARTS 🔥 $100 GIVEAWAY every 15 min | Lego sets');
  assert.equal(a.giveaway, true);
  assert.equal(a.prizeValue, 100);
  assert.equal(a.everyMinutes, 15);
  assert.equal(a.buyersOnly, false);
});

test('GA only counts in capitals; buyers-only detected', () => {
  assert.equal(analyzeTitle('Georgia knives ga show').giveaway, false);
  assert.equal(analyzeTitle('$250 slab GA tonight').prizeValue, 250);
  const b = analyzeTitle('Buyer appreciation giveaway $50 every 10 buyers');
  assert.equal(b.buyersOnly, true);
  assert.equal(b.everySales, 10);
});

test('k means thousand only on its own', () => {
  assert.equal(analyzeTitle('$500 knife GIVEAWAY').prizeValue, 500);
  assert.equal(analyzeTitle('$1k slab giveaway').prizeValue, 1000);
});

test('givy and Givvy count as giveaways', () => {
  assert.equal(analyzeTitle('$40 givy every 20 min').prizeValue, 40);
  assert.equal(analyzeTitle('Givvy night! knives').giveaway, true);
  assert.equal(analyzeTitle('GIVVIES all stream').giveaway, true);
  assert.equal(analyzeTitle('givys for buyers').buyersOnly, true);
  assert.equal(analyzeTitle('Ivy league cards').giveaway, false);
});

test('real titles from Whatnot', () => {
  assert.equal(analyzeTitle('925 MOISSANITE BUYERS GIVEAWAY!!! $1 STARTS!!!').buyersOnly, true);
  assert.equal(analyzeTitle('10K Follower Show! Over $2,000 In Giveaways! $1 Starts').prizeValue, null);
  assert.equal(analyzeTitle('$50 minifig giveaway').prizeValue, 50);
  assert.equal(analyzeTitle('AUTOGRAPH GIVYS! | $1 STARTS SINGLES!').giveaway, true);
});

test('no giveaway, no value', () => {
  const a = analyzeTitle('$1 starts tools and more');
  assert.equal(a.giveaway, false);
  assert.equal(a.prizeValue, null);
});

test('score and hot', () => {
  const s = scoreStream({ id: 'a', title: '$80 Zippo giveaway', viewers: 40, live: true });
  assert.equal(s.value, 80);
  assert.equal(s.perEntry, 2);
  assert.ok(isHot(s, DEFAULT_SETTINGS));
  const g = scoreStream({ id: 'b', title: 'Pokemon giveaways all night', viewers: 400, live: true });
  assert.equal(g.valueGuessed, true);
  assert.equal(g.perEntry, 5 / 400);
  assert.ok(!isHot(g, DEFAULT_SETTINGS));
  const bo = scoreStream({ id: 'c', title: 'buyers only $500 giveaway', viewers: 10, live: true });
  assert.ok(!isHot(bo, DEFAULT_SETTINGS));
  assert.ok(isHot(bo, { ...DEFAULT_SETTINGS, alertBuyersOnly: true }));
});

test('merge and rank', () => {
  const m = mergeStreams([
    [{ id: 'x', title: 'short', viewers: 10, live: true, source: 'Lego' }],
    [{ id: 'x', title: 'a longer title', viewers: 12, live: true, source: 'Tools' }, { id: 'y', title: 'other', viewers: 5, live: false, source: 'Tools' }],
  ]);
  assert.equal(m.length, 2);
  const x = m.find((s) => s.id === 'x');
  assert.deepEqual(x.sources, ['Lego', 'Tools']);
  assert.equal(x.title, 'a longer title');
  assert.equal(x.viewers, 12);
  const r = rank([
    scoreStream({ id: '1', title: '$10 giveaway', viewers: 100, live: true }),
    scoreStream({ id: '2', title: '$10 giveaway', viewers: 10, live: true }),
    scoreStream({ id: '3', title: 'no prize', viewers: 1, live: true }),
    scoreStream({ id: '4', title: 'buyers only $999 giveaway', viewers: 1, live: true }),
  ]);
  assert.deepEqual(r.map((s) => s.id), ['2', '1', '4', '3']);
});

test('category feed URLs match the ones copied from Whatnot', () => {
  assert.equal(feedUrl(1099), 'https://www.whatnot.com/?feedId=TABBED_CATEGORY_FEED_V2%3ATGl2ZXN0cmVhbVRhZ05vZGU6MTA5OQ%3D%3D');
  assert.equal(feedUrl(524), 'https://www.whatnot.com/?feedId=TABBED_CATEGORY_FEED_V2%3ATGl2ZXN0cmVhbVRhZ05vZGU6NTI0');
  assert.equal(feedUrl(16724), 'https://www.whatnot.com/?feedId=TABBED_CATEGORY_FEED_V2%3ATGl2ZXN0cmVhbVRhZ05vZGU6MTY3MjQ%3D');
  assert.equal(feedUrl(16517), 'https://www.whatnot.com/?feedId=TABBED_CATEGORY_FEED_V2%3ATGl2ZXN0cmVhbVRhZ05vZGU6MTY1MTc%3D');
  assert.equal(feedUrl(899), 'https://www.whatnot.com/?feedId=TABBED_CATEGORY_FEED_V2%3ATGl2ZXN0cmVhbVRhZ05vZGU6ODk5');
  assert.equal(feedUrl(1010), 'https://www.whatnot.com/?feedId=TABBED_CATEGORY_FEED_V2%3ATGl2ZXN0cmVhbVRhZ05vZGU6MTAxMA%3D%3D');
  assert.equal(DEFAULT_SETTINGS.sources.length, 9);
  assert.ok(DEFAULT_SETTINGS.sources.every((s) => s.url.includes('TABBED_CATEGORY_FEED_V2')));
  assert.equal(DEFAULT_SETTINGS.sources.find((s) => s.name === 'Lego').url, feedUrl(1099));
});

test('old saved search sources move to feeds; custom ones stay', () => {
  const custom = { name: 'Lego', url: 'https://www.whatnot.com/category/x' };
  const out = migrateSources([
    { name: 'Lego', url: searchUrl('Lego') },
    { name: 'Sports Cards', url: searchUrl('Sports Cards') },
    { name: 'EDC', url: searchUrl('EDC') },
    { name: 'Knives', url: searchUrl('Knives') },
    custom,
  ]);
  assert.deepEqual(out, [
    { name: 'Lego', url: feedUrl(1099) },
    { name: 'Trading Cards', url: feedUrl(899) },
    { name: 'Knives', url: feedUrl(1359) },
    custom,
  ]);
});

test('reading a giveaway panel: real entries and countdown', () => {
  const stream = scoreStream({ id: 'a', title: 'knife giveaways all night', viewers: 300, live: true });
  const r = { at: 1000, secondsLeft: 40, entrants: 19, prize: 'Benchmade Bugout $150', entered: false };
  const sc = scoreReading(stream, r);
  assert.equal(sc.value, 150);
  assert.equal(sc.entrants, 19);
  assert.equal(sc.perEntry, 150 / 20);
  assert.equal(sc.endsAt, 41000);
  assert.ok(isPeekHot(stream, sc, DEFAULT_SETTINGS, 1000));
  assert.ok(!isPeekHot(stream, sc, DEFAULT_SETTINGS, 30000), 'under 20 s left: too late to alert');
  const noPrize = scoreReading(stream, { at: 0, secondsLeft: null, entrants: null, prize: 'Mystery knife' });
  assert.equal(noPrize.value, 5);
  assert.equal(noPrize.entrants, 300);
  assert.equal(noPrize.endsAt, null);
  assert.equal(fmtClock(65), '1:05');
  assert.deepEqual(prizeAmounts('$1 starts, $40 givy'), [40]);
});
