import { DEFAULT_SETTINGS, migrateSources, scoreStream, mergeStreams, rank, isHot, fmtMoney } from './lib/parse.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms) => ms + Math.floor(Math.random() * ms * 0.5);

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
  await chrome.tabs.update(tabId, { url: source.url });
  await waitForLoad(tabId);
  await sleep(jitter(3500)); // let the page's JavaScript render the stream cards
  // Scroll a few screens so lazily loaded cards render, then read.
  for (let i = 0; i < 5; i++) {
    await chrome.scripting.executeScript({ target: { tabId }, func: () => window.scrollBy(0, window.innerHeight * 1.5) }).catch(() => {});
    await sleep(jitter(900));
  }
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, files: ['extract.js'] });
  const r = res?.result || { streams: [], linkCount: 0 };
  r.streams.forEach((s) => { s.source = source.name; });
  return r;
}

let scanning = false;
async function scanAll() {
  if (scanning) return;
  scanning = true;
  const settings = await getSettings();
  const started = Date.now();
  const diag = [];
  const lists = [];
  try {
    const tabId = await scannerTab();
    for (const source of settings.sources) {
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
    await chrome.tabs.update(tabId, { url: 'about:blank' }).catch(() => {});
  } finally {
    scanning = false;
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
}

async function alert(hot, settings) {
  const { alerted = {} } = await chrome.storage.local.get('alerted');
  const now = Date.now();
  for (const [id, t] of Object.entries(alerted)) if (now - t > 24 * 3600e3) delete alerted[id];
  for (const s of hot.slice(0, 3)) {
    if (alerted[s.id] && now - alerted[s.id] < settings.realertMin * 60e3) continue;
    alerted[s.id] = now;
    chrome.notifications.create(`wn:${s.id}`, {
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

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg.type === 'scanNow') { scanAll(); reply({ ok: true }); }
    else if (msg.type === 'open') { await openStream(msg.url, msg.id, 'popup'); reply({ ok: true }); }
    else if (msg.type === 'status') reply({ scanning });
  })();
  return true;
});
