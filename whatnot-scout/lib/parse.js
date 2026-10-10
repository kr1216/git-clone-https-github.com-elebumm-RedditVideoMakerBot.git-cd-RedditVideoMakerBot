// Pure parsing and scoring. No chrome.* calls, so it runs under Node for tests.

export const CATEGORIES = [
  'Lego', 'Trading Cards', 'Tools', 'Jewelry', 'Video Games',
  'Outdoors', 'Knives', 'Sports Memorabilia', 'Tactical Gear',
];

// Category feeds list every live show in a category (search pages showed only 4).
// The id after "TABBED_CATEGORY_FEED_V2:" is base64 of "LivestreamTagNode:<n>".
// Knives is Whatnot's "Knives & EDC" feed, so EDC has no source of its own.
const FEED_TAGS = {
  'Lego': 1099, 'Trading Cards': 899, 'Tools': 524, 'Jewelry': 1010, 'Video Games': 965,
  'Outdoors': 16724, 'Knives': 1359, 'Sports Memorabilia': 918, 'Tactical Gear': 16517,
};
export const feedUrl = (tag) => `https://www.whatnot.com/?feedId=${encodeURIComponent(
  `TABBED_CATEGORY_FEED_V2:${btoa(`LivestreamTagNode:${tag}`)}`)}`;
export const searchUrl = (name) =>
  `https://www.whatnot.com/search?query=${encodeURIComponent(name.toLowerCase() + ' giveaway')}`;

export const DEFAULT_SETTINGS = {
  enabled: true,
  intervalMin: 3,          // minutes between scans
  minPerEntry: 0.25,       // alert when estimated $ per entry is at least this
  defaultValue: 5,         // assumed prize value when a giveaway title names no $ amount
  alertBuyersOnly: false,  // buyers-only giveaways need a purchase, so skip them by default
  realertMin: 30,          // do not alert on the same stream again within this many minutes
  phonePush: false,        // also send alerts to the phone through ntfy.sh
  ntfyTopic: '',           // random private topic, made in Settings
  peekEnabled: false,      // open the best giveaway streams briefly to read their countdown
  peekTop: 3,              // how many streams to peek at after each scan
  minLeadSec: 20,          // only alert on a countdown with at least this long left
  sources: CATEGORIES.map((name) => ({
    name,
    url: feedUrl(FEED_TAGS[name]),
  })),
};

// Saved settings from versions before 0.1.3 keep the old default searches
// ("<category> giveaway"). Move each to its category feed; sources the user
// added themselves are kept as they are.
const RENAMED = { 'Sports Cards': 'Trading Cards' };
const COVERED_BY = { 'EDC': 'Knives' };
export function migrateSources(sources) {
  const out = [];
  for (const s of sources) {
    if (s.url !== searchUrl(s.name)) { out.push(s); continue; }
    if (COVERED_BY[s.name]) continue;
    const name = RENAMED[s.name] || s.name;
    out.push(FEED_TAGS[name] ? { name, url: feedUrl(FEED_TAGS[name]) } : s);
  }
  return out.filter((s, i) => out.findIndex((x) => x.url === s.url) === i);
}

// "1.2K" -> 1200, "345" -> 345, "1,024" -> 1024. Returns null when not a count.
export function parseCount(text) {
  if (text == null) return null;
  const m = String(text).trim().match(/^(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([kKmM])?$/);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ''));
  if (m[2]) n *= m[2].toLowerCase() === 'k' ? 1e3 : 1e6;
  return Math.round(n);
}

const GIVEAWAY_RE = /\b(give\s?-?aways?|gw|gvwy|giveaway|giv{1,2}(?:y|ys|ies)|giveys?)\b/i; // givy, Givvy, givvies, givey
const GA_RE = /\bGAs?\b/; // upper-case only: "GA" in all caps means giveaway on Whatnot
const GA_WORDS_RE = /\b(?:give\s?-?aways?|gw|gvwy|giv{1,2}(?:y|ys|ies)|giveys?)\b|\bGAs?\b/gi;
// A giveaway word qualified by "buyer(s)": "BUYERS GIVEAWAY", "Buyer appreciation givy", "BA GA".
const BUYER_GA_RE = /\b(?:buyers?'?s?|ba)\s*(?:appreciation\s*)?(?:give\s?-?aways?|gw|giv{1,2}(?:y|ys|ies)|gas?)\b/gi;
const BUYERS_ONLY_RE = /\b(buyers?\s*(only|appreciation)|for\s+buyers|purchase\s+required)\b/i;
// "FREE LEGO", "FREE SWITCH CONSOLES" are giveaways; "free shipping" is not.
const FREE_RE = /\bfree\b(?!\s*(?:ship|shipping|s\/?h|delivery|returns?|for\s+buyers)\b)/i;
const EVERY_MIN_RE = /every\s+(\d{1,3})\s*(?:min(?:ute)?s?|m)\b/i;
const EVERY_SALE_RE = /every\s+(\d{1,3})\s*(?:buyers?|sales?|sold|items?|purchases?)\b/i;
// $ amounts that are auction prices or shipping, not prizes.
const NOT_PRIZE_AFTER = /^\s*(?:\+\s*)?(?:(start|starts|starting|auction|auctions|ship|shipping|off|bin|min|mins|minimum|and up|each|breaks?|spots?)\b|in\s+give|of\s+give|worth\s+of)/i; // "$2,000 in giveaways" is a show total
const NOT_PRIZE_BEFORE = /(start(?:s|ing)?\s*(?:at|@)?|from|under|only|ship(?:ping)?)\s*$/i;

// Dollar amounts in text that look like prizes (not start prices, shipping or show totals).
export function prizeAmounts(t) {
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
  return amounts;
}

// Reads a stream title. Returns {giveaway, buyersOnly, prizeValue, everyMinutes, everySales}.
export function analyzeTitle(title) {
  const t = String(title || '');
  const giveaway = GIVEAWAY_RE.test(t) || GA_RE.test(t) || FREE_RE.test(t);
  // Buyers-only when every giveaway mentioned is a buyers' one: "SAWZALL GIVY! ...
  // Buyers Givy!" also has a giveaway anyone can enter.
  const total = (t.match(GA_WORDS_RE) || []).filter((w) => !/^gas?$/.test(w)).length; // "ga" in lower case is not a giveaway
  const buyerCount = (t.match(BUYER_GA_RE) || []).length;
  const buyersOnly = (buyerCount > 0 && buyerCount >= total) || (BUYERS_ONLY_RE.test(t) && total <= 1);
  const amounts = prizeAmounts(t);
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

// Combines a stream with a reading of its giveaway panel (live-reader.js).
// Uses the panel's prize $ and entry count when present, else the title guess
// and the viewer count. endsAt is when the countdown reaches zero.
export function scoreReading(stream, reading, settings = DEFAULT_SETTINGS) {
  const amounts = reading.prize ? prizeAmounts(reading.prize) : [];
  const value = amounts.length ? Math.max(...amounts) : (stream.giveaway ? stream.value : settings.defaultValue);
  const entrants = reading.entrants ?? reading.viewers ?? stream.viewers ?? null;
  const perEntry = value / Math.max(1, (entrants ?? 0) + (reading.entered ? 0 : 1));
  const endsAt = reading.secondsLeft != null ? reading.at + reading.secondsLeft * 1000 : null;
  return { value, valueGuessed: !amounts.length && (!stream.giveaway || stream.valueGuessed), entrants, perEntry, endsAt };
}

export function isPeekHot(stream, scored, settings = DEFAULT_SETTINGS, now = Date.now()) {
  return Boolean(
    scored.endsAt && scored.endsAt - now >= settings.minLeadSec * 1000 &&
    scored.perEntry >= settings.minPerEntry && (settings.alertBuyersOnly || !stream.buyersOnly)
  );
}

// Phone alerts go through ntfy.sh (free push app for iOS and Android). Anyone who
// knows the topic name can read it, so Settings makes a long random one.
export const NTFY_URL = 'https://ntfy.sh/';
export function newTopic(rand = Math.random) {
  const abc = 'abcdefghijkmnopqrstuvwxyz23456789';
  return 'wn-scout-' + Array.from({ length: 20 }, () => abc[Math.floor(rand() * abc.length)]).join('');
}
export function phonePayload(topic, { title, message, context, url }) {
  return {
    topic,
    title: String(title || '').slice(0, 200),
    message: [message, context].filter(Boolean).join('\n').slice(0, 1000) || 'Giveaway',
    click: url,
    tags: ['gift'],
    priority: 4,
  };
}

export function fmtClock(sec) {
  if (sec == null) return '–';
  sec = Math.max(0, Math.round(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
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
