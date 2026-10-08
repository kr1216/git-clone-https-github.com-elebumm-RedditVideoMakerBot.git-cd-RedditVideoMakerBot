import { DEFAULT_SETTINGS, isHot, fmtMoney } from './lib/parse.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ago = (t) => { const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? 'just now' : `${m} min ago`; };

async function settings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

async function render() {
  const s = await settings();
  const { scan, log = [] } = await chrome.storage.local.get(['scan', 'log']);
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
  $('sum').textContent = `7 days: ${opens} streams opened · ${won.length} wins · ${fmtMoney(wonValue)} won`;
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
  const dump = JSON.stringify({ version: chrome.runtime.getManifest().version, at: scan?.at, diag: scan?.diag }, null, 1);
  await navigator.clipboard.writeText(dump);
  $('debug').textContent = 'Copied';
};
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.scan) render(); });
render();
