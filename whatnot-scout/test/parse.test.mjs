import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCount, analyzeTitle, scoreStream, mergeStreams, rank, isHot, DEFAULT_SETTINGS } from '../lib/parse.js';

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
