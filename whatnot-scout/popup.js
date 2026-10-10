import { DEFAULT_SETTINGS, isHot, fmtMoney, fmtClock, scoreReading } from './lib/parse.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ago = (t) => { const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? 'just now' : `${m} min ago`; };

async function settings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

function readingTag(x, r, s) {
  if (!r || Date.now() - r.at > 10 * 60e3) return '';
  const queued = r.upcomingGiveaways ? `${r.upcomingGiveaways} giveaway${r.upcomingGiveaways > 1 ? 's' : ''} queued` : '';
  const sc = scoreReading(x, r, s);
  const left = sc.endsAt ? (sc.endsAt - Date.now()) / 1000 : null;
  const clock = left == null ? '' : left > 0 ? `⏱ ${fmtClock(left)} left` : 'ended';
  const bits = [clock, queued, r.entrants != null ? `${r.entrants} entered` : '', r.entered ? 'you entered' : '',
    r.prize ? esc(r.prize.slice(0, 40)) : ''].filter(Boolean);
  return bits.length ? `<span class="tag" title="read ${ago(r.at)} (${r.via})">${bits.join(' · ')}</span>` : '';
}

async function render() {
  const s = await settings();
  const { scan, log = [], liveReads = {}, gaSeen = [] } = await chrome.storage.local.get(['scan', 'log', 'liveReads', 'gaSeen']);
  const { scanning } = await chrome.runtime.sendMessage({ type: 'status' });
  const st = $('status');
  st.className = '';
  if (!scan) st.textContent = scanning ? 'Scanning…' : 'No scan yet. Click "Scan now".';
  else {
    const live = scan.streams.filter((x) => x.live);
    const gw = live.filter((x) => x.giveaway);
    st.textContent = `${scanning ? 'Scanning… · ' : ''}Last scan ${ago(scan.at)}: ${live.length} live streams, ${gw.length} with giveaways in the title.`;
    if (scan.blocked) { st.className = 'warn'; st.textContent = 'Whatnot showed a "verify you are human" page. Open whatnot.com in a normal tab, pass the check, then Scan now.'; }
    else if (scan.diag.every((d) => !d.found)) { st.className = 'warn'; st.textContent += ' No streams read from any page: click "Copy debug" and send it over.'; }
  }

  const rows = (scan?.streams || []).filter((x) => x.live && ($('all').checked || x.giveaway));
  $('list').innerHTML = rows.length ? rows.slice(0, 60).map((x) => `
    <div class="row ${isHot(x, s) ? 'hot' : ''}" data-url="${esc(x.url)}" data-id="${esc(x.id)}">
      <div><div class="ev">${x.giveaway ? fmtMoney(x.perEntry) : '–'}</div><div class="meta">per entry</div></div>
      <div>
        <div class="title">${esc(x.title)}</div>
        <div class="meta">
          ${x.giveaway ? `<span class="tag">${x.valueGuessed ? '~' : ''}${fmtMoney(x.value)} prize</span>` : ''}
          ${x.perHour != null ? `<span class="tag">${fmtMoney(x.perHour)}/hr</span>` : ''}
          ${x.buyersOnly ? '<span class="tag">buyers only</span>' : ''}
          ${readingTag(x, liveReads[x.id], s)}
          ${x.viewers ?? '?'} viewers · ${esc(x.seller || '')} · ${esc((x.sources || []).join(', '))}
        </div>
      </div>
      ${x.giveaway ? '<button class="won" title="Log a win from this stream">Won</button>' : '<span></span>'}
    </div>`).join('') : '<div class="empty">Nothing to show yet.</div>';

  const since = Date.now() - 7 * 864e5;
  const recent = log.filter((e) => e.at > since);
  const opens = recent.filter((e) => e.type === 'open').length;
  const won = recent.filter((e) => e.type === 'win');
  const wonValue = won.reduce((a, e) => a + (e.value || 0), 0);
  // Entry counts vs. viewer counts for giveaways measured on stream pages: shows
  // how far "prize ÷ viewers" is from the real odds.
  const viewersById = Object.fromEntries((scan?.streams || []).map((x) => [x.id, x.viewers]));
  const ratios = gaSeen.filter((g) => g.entrants && (g.viewers || viewersById[g.id]))
    .map((g) => g.entrants / (g.viewers || viewersById[g.id])).sort((a, b) => a - b);
  const ratio = ratios.length >= 3 ? ` · entries ≈ ${Math.round(ratios[ratios.length >> 1] * 100)}% of viewers (${ratios.length})` : '';
  $('sum').textContent = `7 days: ${opens} opened · ${won.length} wins · ${fmtMoney(wonValue)} won · ${gaSeen.length} giveaways measured${ratio}`;
}

$('list').addEventListener('click', async (ev) => {
  const row = ev.target.closest('.row');
  if (!row) return;
  if (ev.target.classList.contains('won')) {
    const v = prompt('Roughly what was the prize worth, in $?');
    if (v == null) return;
    const { log = [] } = await chrome.storage.local.get('log');
    log.push({ at: Date.now(), type: 'win', id: row.dataset.id, value: parseFloat(v) || 0 });
    await chrome.storage.local.set({ log });
    return render();
  }
  chrome.runtime.sendMessage({ type: 'open', url: row.dataset.url, id: row.dataset.id });
});

$('scan').onclick = async () => { await chrome.runtime.sendMessage({ type: 'scanNow' }); setTimeout(render, 300); };
$('opts').onclick = () => chrome.runtime.openOptionsPage();
$('all').onchange = render;
$('add').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.startsWith('https://www.whatnot.com/')) { alert('Open a Whatnot page (a category, search or the home page) first.'); return; }
  const name = prompt('Name for this page:', new URL(tab.url).pathname.split('/').filter(Boolean).pop() || 'Whatnot');
  if (!name) return;
  const s = await settings();
  s.sources = [...s.sources.filter((x) => x.url !== tab.url), { name, url: tab.url }];
  await chrome.storage.sync.set({ settings: s });
  $('status').textContent = `Added "${name}". It will be scanned every cycle.`;
};
$('debug').onclick = async () => {
  const { scan } = await chrome.storage.local.get('scan');
  const { liveReads } = await chrome.storage.local.get('liveReads');
  const dump = JSON.stringify({ version: chrome.runtime.getManifest().version, at: scan?.at, peeks: scan?.peeks, liveReads, diag: scan?.diag }, null, 1);
  await navigator.clipboard.writeText(dump);
  $('debug').textContent = 'Copied';
};
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.scan) render(); });
render();
