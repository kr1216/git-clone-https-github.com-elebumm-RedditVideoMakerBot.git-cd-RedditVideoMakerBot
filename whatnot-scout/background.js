import {
  DEFAULT_SETTINGS, migrateSources, scoreStream, mergeStreams, rank, isHot, fmtMoney,
  scoreReading, isPeekHot, fmtClock, phonePayload, NTFY_URL,
} from './lib/parse.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms) => ms + Math.floor(Math.random() * ms * 0.5);
// Chrome can freeze tabs in the minimized scan window; a script injected into a
// frozen tab may never answer. Every step gets a time limit so a scan can't hang.
const withTimeout = (p, ms, label) => Promise.race([
  p, new Promise((_, no) => setTimeout(() => no(new Error(`${label} timed out after ${ms / 1000}s`)), ms)),
]);
const run = (opts, ms = 15000) => withTimeout(chrome.scripting.executeScript(opts), ms, 'reading the page');
const go = (tabId, url) => withTimeout(chrome.tabs.update(tabId, { url, autoDiscardable: false }), 15000, 'opening the page');

async function getSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

async function schedule() {
  const s = await getSettings();
  await chrome.alarms.clear('scan');
  if (s.enabled) chrome.alarms.create('scan', { delayInMinutes: 0.1, periodInMinutes: Math.max(1, s.intervalMin) });
}

chrome.runtime.onInstalled.addListener(async (info) => {
  if (info.reason === 'install') chrome.runtime.openOptionsPage();
  if (info.reason === 'update' && /^0\.(1\.|2\.[0-2]$)/.test(info.previousVersion || '')) {
    // Readings before 0.2.3 mostly came from auction timers and chat: drop them.
    await chrome.storage.local.remove(['gaSeen', 'liveReads']);
  }
  if (info.reason === 'update') {
    const { settings } = await chrome.storage.sync.get('settings');
    if (settings?.sources) await chrome.storage.sync.set({ settings: { ...settings, sources: migrateSources(settings.sources) } });
  }
  schedule();
});
chrome.runtime.onStartup.addListener(schedule);
chrome.storage.onChanged.addListener((c, area) => { if (area === 'sync' && c.settings) schedule(); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'scan') scanAll(); });

// One minimized window, reused for every scan, so scanning never steals focus.
async function scannerTab() {
  const { scanner } = await chrome.storage.session.get('scanner');
  if (scanner) {
    try { const tab = await chrome.tabs.get(scanner.tabId); if (tab) return tab.id; } catch { /* closed */ }
  }
  const win = await chrome.windows.create({ url: 'about:blank', state: 'minimized' });
  const tabId = win.tabs[0].id;
  // Muted: peeked streams play sound otherwise. Not discardable: Chrome must not unload it mid-scan.
  await chrome.tabs.update(tabId, { muted: true, autoDiscardable: false });
  await chrome.storage.session.set({ scanner: { windowId: win.id, tabId } });
  return tabId;
}

function waitForLoad(tabId, timeoutMs = 25000) {
  return new Promise((resolve) => {
    const done = (ok) => { chrome.tabs.onUpdated.removeListener(fn); clearTimeout(t); resolve(ok); };
    const fn = (id, info) => { if (id === tabId && info.status === 'complete') done(true); };
    const t = setTimeout(() => done(false), timeoutMs);
    chrome.tabs.onUpdated.addListener(fn);
  });
}

async function readSource(tabId, source) {
  await go(tabId, source.url);
  await waitForLoad(tabId);
  await sleep(jitter(3500)); // let the page's JavaScript render the stream cards
  // Scroll a few screens so lazily loaded cards render, then read.
  for (let i = 0; i < 5; i++) {
    await run({ target: { tabId }, func: () => window.scrollBy(0, window.innerHeight * 1.5) }, 5000).catch(() => {});
    await sleep(jitter(900));
  }
  const [res] = await run({ target: { tabId }, files: ['extract.js'] });
  const r = res?.result || { streams: [], linkCount: 0 };
  r.streams.forEach((s) => { s.source = source.name; });
  return r;
}

let scanning = false;
let scanStarted = 0;
let scanStep = '';
async function scanAll() {
  // A scan stuck for over 8 minutes (Chrome froze or closed the scan tab) is abandoned.
  if (scanning && Date.now() - scanStarted < 8 * 60e3) return;
  scanning = true;
  scanStarted = Date.now();
  const settings = await getSettings();
  const started = Date.now();
  const diag = [];
  const lists = [];
  try {
    const tabId = await scannerTab();
    for (const source of settings.sources) {
      scanStep = `reading ${source.name}`;
      try {
        const r = await readSource(tabId, source);
        lists.push(r.streams);
        diag.push({
          name: source.name, url: source.url, found: r.streams.length,
          live: r.streams.filter((s) => s.live).length, challenge: r.challenge,
          loggedOut: r.loggedOut, pageTitle: r.pageTitle, navLinks: r.navLinks, sample: r.streams.slice(0, 4),
        });
      } catch (e) {
        diag.push({ name: source.name, url: source.url, error: String(e?.message || e) });
      }
      await sleep(jitter(2000));
    }

    const streams = rank(mergeStreams(lists).map((s) => scoreStream(s, settings)));
    const hot = streams.filter((s) => isHot(s, settings));
    const blocked = diag.some((d) => d.challenge);
    await chrome.storage.local.set({
      scan: { at: Date.now(), tookMs: Date.now() - started, streams, diag, blocked },
    });
    chrome.action.setBadgeBackgroundColor({ color: blocked ? '#b3261e' : '#1b7f3b' });
    chrome.action.setBadgeText({ text: blocked ? '!' : hot.length ? String(hot.length) : '' });
    await alert(hot, settings);
    if (settings.peekEnabled && !blocked) {
      scanStep = 'peeking';
      await peek(tabId, streams, settings).catch((e) => console.warn('peek failed', e));
    }
    await go(tabId, 'about:blank').catch(() => {});
  } catch (e) {
    console.warn('scan failed', e);
    await chrome.storage.local.set({ lastError: { at: Date.now(), step: scanStep, message: String(e?.message || e) } });
  } finally {
    scanning = false;
    scanStep = '';
  }
}

// Option 2: open the best few giveaway streams for a few seconds each and read
// the countdown, entry count and prize from the giveaway panel.
async function readStreamPage(tabId) {
  for (let i = 0; i < 4; i++) {
    const version = chrome.runtime.getManifest().version;
    let [res] = await run({ target: { tabId }, func: () => (window.__wnRead ? window.__wnRead() : null) }).catch(() => []);
    if (res?.result == null || res.result.reader !== version) { // missing, or an old copy from before an update
      await run({ target: { tabId }, files: ['live-reader.js'] }).catch(() => {});
      [res] = await run({ target: { tabId }, func: () => window.__wnRead?.() }).catch(() => []);
    }
    const r = res?.result;
    // A drawn ring/bar gives seconds left only from a second sample a moment later.
    if (r?.found && r.secondsLeft == null && r.progress != null && i < 3) { await sleep(2500); continue; }
    if (r?.found || i === 3) return r || null;
    await sleep(2000); // the panel can render a moment after the video
  }
  return null;
}

async function peek(tabId, streams, settings) {
  const picks = streams
    .filter((s) => s.live && s.giveaway && (settings.alertBuyersOnly || !s.buyersOnly))
    .slice(0, Math.max(0, settings.peekTop));
  const peeks = [];
  for (const s of picks) {
    scanStep = `peeking at ${s.seller || s.id}`;
    await go(tabId, s.url);
    await waitForLoad(tabId);
    await sleep(jitter(4000));
    const r = await readStreamPage(tabId);
    peeks.push({ id: s.id, title: s.title, ...(r || { found: false }) });
    if (r && !r.found && r.upcomingGiveaways) {
      await recordReading({ ...r, id: s.id }, 'peek');
      // Countdowns are short, so a peek rarely lands on one: a queued giveaway in a
      // stream that already scores well is the more useful alert.
      if (isHot(s, settings)) await alertQueued(s, r, settings);
    }
    if (r?.found) {
      await recordReading({ ...r, id: s.id }, 'peek');
      const scored = scoreReading(s, r, settings);
      if (isPeekHot(s, scored, settings)) await alertPeek(s, r, scored, settings);
    }
    await sleep(jitter(1500));
  }
  const { scan } = await chrome.storage.local.get('scan');
  if (scan) await chrome.storage.local.set({ scan: { ...scan, peeks } });
}

async function alertQueued(s, r, settings) {
  const { alerted = {} } = await chrome.storage.local.get('alerted');
  const key = `queued:${s.id}`;
  if (alerted[key] && Date.now() - alerted[key] < settings.realertMin * 60e3) return;
  alerted[key] = Date.now();
  await chrome.storage.local.set({ alerted });
  const n = r.upcomingGiveaways;
  notify(`wn:${s.id}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: `🎁 ${n} giveaway${n > 1 ? 's' : ''} queued · ${r.viewers ?? s.viewers ?? '?'} viewers · ~${fmtMoney(s.perEntry)}/entry`,
    message: r.upcomingItems?.length ? `Next: ${r.upcomingItems.slice(0, 3).join(' · ')}` : (s.title || 'Giveaway stream'),
    contextMessage: [s.seller, s.sources?.join(', ')].filter(Boolean).join(' · '),
    priority: 2,
  });
}

async function alertPeek(s, r, scored, settings) {
  const { alerted = {} } = await chrome.storage.local.get('alerted');
  const key = `peek:${s.id}:${r.prize || ''}`;
  if (alerted[key] && Date.now() - alerted[key] < settings.realertMin * 60e3) return;
  alerted[key] = Date.now();
  await chrome.storage.local.set({ alerted });
  const left = (scored.endsAt - Date.now()) / 1000;
  notify(`wn:${s.id}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: `⏱ ${fmtClock(left)} left · ${fmtMoney(scored.perEntry)}/entry · ${scored.valueGuessed ? '~' : ''}${fmtMoney(scored.value)}`,
    message: r.prize || s.title || 'Giveaway',
    contextMessage: [`${scored.entrants ?? '?'} ${r.entrants != null ? 'entered' : 'viewers'}`, s.seller].filter(Boolean).join(' · '),
    priority: 2,
    requireInteraction: true,
  });
}

// Readings from peeks and from streams you open (option 1). liveReads holds the
// latest reading per stream; gaSeen keeps one row per giveaway for the stats.
async function recordReading(r, via) {
  if (!r?.id) return;
  const { liveReads = {}, gaSeen = [] } = await chrome.storage.local.get(['liveReads', 'gaSeen']);
  const now = Date.now();
  for (const [k, v] of Object.entries(liveReads)) if (now - v.at > 30 * 60e3) delete liveReads[k];
  liveReads[r.id] = { ...r, via };
  if (!r.found) { // only "N giveaways queued": no giveaway to log
    delete liveReads[r.id].context;
    return chrome.storage.local.set({ liveReads });
  }
  const endsAt = r.secondsLeft != null ? r.at + r.secondsLeft * 1000 : null;
  const row = gaSeen.find((g) => g.id === r.id && g.prize === r.prize && now - g.lastAt < 15 * 60e3);
  if (row) {
    row.lastAt = now;
    row.entrants = Math.max(row.entrants ?? 0, r.entrants ?? 0) || row.entrants;
    row.entered = row.entered || r.entered;
    if (endsAt) row.endsAt = endsAt;
  } else {
    gaSeen.push({ id: r.id, prize: r.prize, entrants: r.entrants, viewers: r.viewers, entered: r.entered, endsAt, via, firstAt: now, lastAt: now });
  }
  await chrome.storage.local.set({ liveReads, gaSeen: gaSeen.slice(-1000) });
}

async function alert(hot, settings) {
  const { alerted = {} } = await chrome.storage.local.get('alerted');
  const now = Date.now();
  for (const [id, t] of Object.entries(alerted)) if (now - t > 24 * 3600e3) delete alerted[id];
  for (const s of hot.slice(0, 3)) {
    if (alerted[s.id] && now - alerted[s.id] < settings.realertMin * 60e3) continue;
    alerted[s.id] = now;
    notify(`wn:${s.id}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `${fmtMoney(s.perEntry)}/entry · ${s.valueGuessed ? '~' : ''}${fmtMoney(s.value)} prize · ${s.viewers ?? '?'} viewers`,
      message: s.title || 'Giveaway stream',
      contextMessage: [s.seller, s.sources?.join(', ')].filter(Boolean).join(' · '),
      priority: 2,
      requireInteraction: false,
    });
  }
  await chrome.storage.local.set({ alerted });
}

// Desktop notification, plus the phone (ntfy) when that is turned on in Settings.
async function notify(nid, opts) {
  chrome.notifications.create(nid, opts);
  const settings = await getSettings();
  if (!settings.phonePush || !settings.ntfyTopic) return;
  const id = nid.replace(/^wn:/, '');
  const body = phonePayload(settings.ntfyTopic, { title: opts.title, message: opts.message, context: opts.contextMessage, url: `https://www.whatnot.com/live/${id}` });
  fetch(NTFY_URL, { method: 'POST', body: JSON.stringify(body) }).catch(() => {});
}

async function openStream(url, id, via) {
  await chrome.tabs.create({ url, active: true });
  const { log = [] } = await chrome.storage.local.get('log');
  log.push({ at: Date.now(), type: 'open', id, via });
  await chrome.storage.local.set({ log: log.slice(-2000) });
}

chrome.notifications.onClicked.addListener(async (nid) => {
  if (!nid.startsWith('wn:')) return;
  const id = nid.slice(3);
  await openStream(`https://www.whatnot.com/live/${id}`, id, 'notification');
  chrome.notifications.clear(nid);
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    if (msg.type === 'giveawaySeen') {
      const { scanner } = await chrome.storage.session.get('scanner');
      if (sender.tab && sender.tab.id !== scanner?.tabId) await recordReading(msg.reading, 'you');
      return reply({ ok: true });
    }
    if (msg.type === 'scanNow') { scanAll(); reply({ ok: true }); }
    else if (msg.type === 'open') { await openStream(msg.url, msg.id, 'popup'); reply({ ok: true }); }
    else if (msg.type === 'status') reply({ scanning, scanStep, scanStarted });
    else if (msg.type === 'testPhone') {
      const settings = await getSettings();
      const body = phonePayload(msg.topic || settings.ntfyTopic, { title: '🎁 Giveaway Scout is connected', message: 'Alerts from your computer will show up here. Tap one to open the stream.', url: 'https://www.whatnot.com/' });
      const res = await fetch(NTFY_URL, { method: 'POST', body: JSON.stringify(body) }).catch((e) => ({ ok: false, statusText: String(e) }));
      reply({ ok: res.ok, status: res.status || res.statusText });
    }
  })();
  return true;
});
