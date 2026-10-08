// Pure parsing and scoring. No chrome.* calls, so it runs under Node for tests.

export const CATEGORIES = [
  'Lego', 'Sports Cards', 'Tools', 'Jewelry', 'Video Games',
  'Outdoors', 'Knives', 'EDC', 'Sports Memorabilia', 'Tactical Gear',
];

export const DEFAULT_SETTINGS = {
  enabled: true,
  intervalMin: 3,          // minutes between scans
  minPerEntry: 0.25,       // alert when estimated $ per entry is at least this
  defaultValue: 5,         // assumed prize value when a giveaway title names no $ amount
  alertBuyersOnly: false,  // buyers-only giveaways need a purchase, so skip them by default
  realertMin: 30,          // do not alert on the same stream again within this many minutes
  sources: CATEGORIES.map((name) => ({
    name,
    url: `https://www.whatnot.com/search?query=${encodeURIComponent(name.toLowerCase() + ' giveaway')}`,
  })),
};

// "1.2K" -> 1200, "345" -> 345, "1,024" -> 1024. Returns null when not a count.
export function parseCount(text) {
  if (text == null) return null;
  const m = String(text).trim().match(/^(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([kKmM])?$/);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ''));
  if (m[2]) n *= m[2].toLowerCase() === 'k' ? 1e3 : 1e6;
  return Math.round(n);
}

const GIVEAWAY_RE = /\b(give\s?-?aways?|gw|gvwy|giveaway|giv{1,2}(?:y|ys|ies))\b/i; // givy, Givvy, givvies
const GA_RE = /\bGAs?\b/; // upper-case only: "GA" in all caps means giveaway on Whatnot
const BUYERS_RE = /\b(buyers?\s*(only|appreciation)|buyer\s*giveaway|ba\s*(giveaway|ga)|for\s+buyers|purchase\s+required)\b/i;
const EVERY_MIN_RE = /every\s+(\d{1,3})\s*(?:min(?:ute)?s?|m)\b/i;
const EVERY_SALE_RE = /every\s+(\d{1,3})\s*(?:buyers?|sales?|sold|items?|purchases?)\b/i;
// $ amounts that are auction prices or shipping, not prizes.
const NOT_PRIZE_AFTER = /^\s*(?:\+\s*)?(start|starts|starting|auction|auctions|ship|shipping|off|bin|min|mins|minimum|and up|each|breaks?|spots?)\b/i;
const NOT_PRIZE_BEFORE = /(start(?:s|ing)?\s*(?:at|@)?|from|under|only|ship(?:ping)?)\s*$/i;

// Reads a stream title. Returns {giveaway, buyersOnly, prizeValue, everyMinutes, everySales}.
export function analyzeTitle(title) {
  const t = String(title || '');
  const giveaway = GIVEAWAY_RE.test(t) || GA_RE.test(t);
  const buyersOnly = BUYERS_RE.test(t);
  const amounts = [];
  const re = /\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([kK](?![a-zA-Z]))?/g; // "$1k" yes, "$500 knife" no
  let m;
  while ((m = re.exec(t))) {
    const after = t.slice(re.lastIndex, re.lastIndex + 20);
    const before = t.slice(Math.max(0, m.index - 14), m.index);
    if (NOT_PRIZE_AFTER.test(after) || NOT_PRIZE_BEFORE.test(before)) continue;
    let v = parseFloat(m[1].replace(/,/g, ''));
    if (m[2]) v *= 1000;
    if (v > 0 && v <= 20000) amounts.push(v);
  }
  const em = t.match(EVERY_MIN_RE);
  const es = t.match(EVERY_SALE_RE);
  return {
    giveaway,
    buyersOnly,
    prizeValue: giveaway && amounts.length ? Math.max(...amounts) : null,
    everyMinutes: em ? Number(em[1]) : null,
    everySales: es ? Number(es[1]) : null,
  };
}

// Adds value estimates to a raw stream {id,url,title,viewers,...}.
// perEntry = prize value / viewers: every viewer is treated as an entrant, which
// understates the true odds a little (not every viewer enters).
export function scoreStream(stream, settings = DEFAULT_SETTINGS) {
  const a = analyzeTitle(stream.title);
  const value = a.giveaway ? (a.prizeValue ?? settings.defaultValue) : 0;
  const viewers = Math.max(1, stream.viewers || 1);
  const perEntry = a.giveaway ? value / viewers : 0;
  const perHour = a.giveaway && a.everyMinutes ? perEntry * (60 / a.everyMinutes) : null;
  return {
    ...stream,
    ...a,
    value,
    valueGuessed: a.giveaway && a.prizeValue == null,
    perEntry,
    perHour,
  };
}

export function isHot(s, settings = DEFAULT_SETTINGS) {
  return Boolean(
    s.live && s.giveaway && s.perEntry >= settings.minPerEntry &&
    (settings.alertBuyersOnly || !s.buyersOnly)
  );
}

// Ranks scored streams: live giveaways first (buyers-only last), then by $ per entry.
export function rank(streams) {
  const key = (s) => (s.live ? 0 : 2) + (s.giveaway ? 0 : 4) + (s.buyersOnly ? 1 : 0);
  return [...streams].sort((x, y) => key(x) - key(y) || y.perEntry - x.perEntry || (x.viewers || 0) - (y.viewers || 0));
}

// Merges results from several source pages: one entry per stream id.
export function mergeStreams(lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const s of list) {
      const prev = byId.get(s.id);
      if (!prev) { byId.set(s.id, { ...s, sources: [s.source].filter(Boolean) }); continue; }
      if (s.source && !prev.sources.includes(s.source)) prev.sources.push(s.source);
      if ((s.title || '').length > (prev.title || '').length) prev.title = s.title;
      if (s.viewers != null && (prev.viewers == null || s.viewers > prev.viewers)) prev.viewers = s.viewers;
      prev.live = prev.live || s.live;
      prev.seller = prev.seller || s.seller;
    }
  }
  return [...byId.values()];
}

export function fmtMoney(v) {
  if (v == null) return '–';
  if (v === 0) return '$0';
  if (v < 1) return `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}¢`;
  return `$${v < 10 ? v.toFixed(2) : Math.round(v)}`;
}
