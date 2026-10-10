import { DEFAULT_SETTINGS, isHot, fmtMoney, fmtClock, scoreReading, historyNotes } from './lib/parse.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60e3);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};
const when = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

let state = { settings: DEFAULT_SETTINGS, scan: null, log: [], liveReads: {}, gaSeen: [], scanning: false };
let sortKey = 'perEntry';

async function load() {
  const { settings } = await chrome.storage.sync.get('settings');
  const local = await chrome.storage.local.get(['scan', 'log', 'liveReads', 'gaSeen', 'sellerStats']);
  const { scanning } = await chrome.runtime.sendMessage({ type: 'status' }).catch(() => ({ scanning: false }));
  state = {
    settings: { ...DEFAULT_SETTINGS, ...(settings || {}) },
    scan: local.scan || null, log: local.log || [], liveReads: local.liveReads || {}, gaSeen: local.gaSeen || [], sellerStats: local.sellerStats || {}, scanning,
  };
  fillCategories();
  render();
}

// A stream with a recent stream-page reading is scored on its real entries and prize.
function withReading(x) {
  const r = state.liveReads[x.id];
  if (!r || Date.now() - r.at > 10 * 60e3) return { ...x };
  if (!r.found) return { ...x, reading: r };
  const sc = scoreReading(x, r, state.settings);
  return { ...x, reading: r, value: sc.value, valueGuessed: sc.valueGuessed, perEntry: sc.perEntry, endsAt: sc.endsAt };
}

function nowCell(x) {
  const r = x.reading;
  const bits = [];
  const h = historyNotes(x, state.liveReads[x.id], state.sellerStats);
  const ends = x.endsAt || h.estEndsAt;
  const est = !x.endsAt && !!h.estEndsAt; // from the seller's usual giveaway length
  if (ends) {
    const left = (ends - Date.now()) / 1000;
    bits.push(`<span class="tag clock" data-ends="${ends}" ${est ? 'data-est="1"' : ''}>${clockText(left, est)}</span>`);
  }
  h.tags.forEach((t) => bits.push(`<span class="tag">${esc(t)}</span>`));
  if (r?.found && r.entrants != null) bits.push(`<span class="tag">${r.entrants} entered</span>`);
  if (r?.upcomingGiveaways) bits.push(`<span class="tag" title="${esc((r.upcomingItems || []).join(' · '))}">${r.upcomingGiveaways} queued${r.upcomingItems?.length ? `: ${esc(r.upcomingItems.slice(0, 2).join(', ').slice(0, 60))}` : ''}</span>`);
  if (x.perHour != null) bits.push(`<span class="tag">${fmtMoney(x.perHour)}/hr</span>`);
  if (x.buyersOnly) bits.push('<span class="tag">buyers only</span>');
  return bits.join('') || '<span class="muted">–</span>';
}

function clockText(left, est) {
  if (left <= 0) return est ? 'ending (est.)' : 'ended';
  return est ? `⏱ ~${fmtClock(left)} left (est.)` : `⏱ ${fmtClock(left)} left`;
}

function fillCategories() {
  const sel = $('cat');
  const cur = sel.value;
  const names = state.settings.sources.map((s) => s.name);
  sel.innerHTML = '<option value="">All categories</option>' + names.map((n) => `<option>${esc(n)}</option>`).join('');
  sel.value = names.includes(cur) ? cur : '';
}

function render() {
  const { scan, settings, log, gaSeen } = state;
  const streams = (scan?.streams || []).map(withReading);
  const live = streams.filter((x) => x.live);
  const gw = live.filter((x) => x.giveaway);
  const hot = gw.filter((x) => isHot(x, settings));

  // Status line
  const st = $('status');
  st.className = '';
  if (!scan) st.textContent = state.scanning ? 'Scanning…' : 'No scan yet. Click "Scan now".';
  else if (scan.blocked) { st.className = 'warn'; st.textContent = 'Whatnot showed a "verify you are human" page. Open whatnot.com in a normal tab, pass the check, then Scan now.'; }
  else st.textContent = `${state.scanning ? 'Scanning… · ' : ''}Last scan ${ago(scan.at)} · every ${settings.intervalMin} min · ${settings.sources.length} pages · Peek ${settings.peekEnabled ? 'on' : 'off'} · alert at ${fmtMoney(settings.minPerEntry)}/entry`;

  // KPIs
  const since = Date.now() - 7 * 864e5;
  const week = log.filter((e) => e.at > since);
  const wins = week.filter((e) => e.type === 'win');
  const won = wins.reduce((a, e) => a + (e.value || 0), 0);
  const ratios = gaSeen.filter((g) => g.entrants && g.viewers).map((g) => g.entrants / g.viewers).sort((a, b) => a - b);
  const median = ratios.length ? ratios[ratios.length >> 1] : null;
  const best = hot[0] || gw[0];
  const kpi = (label, value, sub, cls = '') => `<div class="card kpi ${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
  $('kpis').innerHTML = [
    kpi('Worth entering now', hot.length, `at or above ${fmtMoney(settings.minPerEntry)} per entry`, hot.length ? 'hot' : ''),
    kpi('Live giveaway streams', gw.length, `of ${live.length} live streams scanned`),
    kpi('Best per entry', best ? fmtMoney(best.perEntry) : '–', best ? esc(best.seller || '') : 'nothing live'),
    kpi('Entries ÷ viewers', median != null ? `${Math.round(median * 100)}%` : '–', `${gaSeen.length} giveaways measured`),
    kpi('Won, last 7 days', fmtMoney(won), `${wins.length} wins · ${week.filter((e) => e.type === 'open').length} streams opened`),
  ].join('');

  renderStreams(streams);
  renderChart(gw);
  renderHealth(scan);
  renderSeen(streams);
  renderWins(streams);
}

function renderStreams(streams) {
  const cat = $('cat').value;
  const q = $('q').value.trim().toLowerCase();
  const rows = streams
    .filter((x) => x.live && ($('all').checked || x.giveaway))
    .filter((x) => !($('nobuyers').checked && x.buyersOnly))
    .filter((x) => !cat || (x.sources || []).includes(cat))
    .filter((x) => !q || `${x.title} ${x.seller}`.toLowerCase().includes(q))
    .sort((a, b) => (b[sortKey] ?? -1) - (a[sortKey] ?? -1));
  $('streams').innerHTML = rows.length ? rows.slice(0, 200).map((x) => `
    <tr class="${isHot(x, state.settings) ? 'hot' : ''}" data-url="${esc(x.url)}" data-id="${esc(x.id)}">
      <td class="num ev" data-label="Per entry">${x.giveaway ? fmtMoney(x.perEntry) : '–'}</td>
      <td class="num" data-label="Prize">${x.giveaway ? `${x.valueGuessed ? '~' : ''}${fmtMoney(x.value)}` : '–'}</td>
      <td class="num" data-label="Viewers">${x.reading?.viewers ?? x.viewers ?? '?'}</td>
      <td class="nowcell">${nowCell(x)}</td>
      <td class="title">${esc(x.title)}<div class="muted">${esc(x.seller || '')} · ${esc((x.sources || []).join(', '))}</div></td>
    </tr>`).join('') : '<tr><td colspan="5" class="empty">No live streams match.</td></tr>';
  document.querySelectorAll('th.sortable').forEach((th) => th.classList.toggle('sorted', th.dataset.k === sortKey));
}

// Horizontal bars, one series (no legend): live giveaway streams per category.
function renderChart(gw) {
  const svg = $('chart');
  const names = state.settings.sources.map((s) => s.name);
  const data = names.map((n) => {
    const inCat = gw.filter((x) => (x.sources || []).includes(n));
    return { n, count: inCat.length, best: inCat.reduce((m, x) => Math.max(m, x.perEntry || 0), 0) };
  });
  const W = svg.clientWidth || 360;
  const labelW = 130, valW = 30, row = 28, bar = 18;
  const H = data.length * row + 4;
  const max = Math.max(1, ...data.map((d) => d.count));
  const plotW = Math.max(40, W - labelW - valW);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('height', H);
  const r = 4;
  svg.innerHTML = data.map((d, i) => {
    const y = i * row + (row - bar) / 2;
    const w = (d.count / max) * plotW;
    // Square at the baseline, 4px rounded at the data end.
    const path = w <= 0 ? '' : w < r
      ? `<rect class="bar" x="${labelW}" y="${y}" width="${w}" height="${bar}"/>`
      : `<path class="bar" d="M${labelW},${y} h${w - r} a${r},${r} 0 0 1 ${r},${r} v${bar - 2 * r} a${r},${r} 0 0 1 ${-r},${r} h${-(w - r)} z"/>`;
    return `<g data-i="${i}">
      <rect class="hit" x="0" y="${i * row}" width="${W}" height="${row}"/>
      <text class="lbl" x="${labelW - 8}" y="${y + bar / 2 + 4}" text-anchor="end">${esc(d.n)}</text>
      ${path}
      <text class="val" x="${labelW + w + 6}" y="${y + bar / 2 + 4}">${d.count}</text>
    </g>`;
  }).join('');
  const tip = $('tip');
  svg.querySelectorAll('g').forEach((g) => {
    const d = data[+g.dataset.i];
    g.addEventListener('mousemove', (e) => {
      tip.style.display = 'block';
      tip.style.left = `${e.clientX + 12}px`;
      tip.style.top = `${e.clientY + 12}px`;
      tip.innerHTML = `<b>${esc(d.n)}</b><br>${d.count} live giveaway stream${d.count === 1 ? '' : 's'}${d.count ? `<br>best ${fmtMoney(d.best)} per entry` : ''}`;
    });
    g.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    g.addEventListener('click', () => { $('cat').value = d.n; render(); });
  });
}

function renderHealth(scan) {
  const rows = scan?.diag || [];
  $('health').innerHTML = rows.length ? rows.map((d) => `<tr>
    <td>${esc(d.name)}</td>
    <td class="num">${d.found ?? '–'}</td>
    <td class="num">${d.live ?? '–'}</td>
    <td>${d.error ? `<span class="tag">error</span> ${esc(d.error)}` : d.challenge ? '<span class="tag">human check</span>' : d.found ? 'ok' : '<span class="tag">nothing read</span>'}</td>
  </tr>`).join('') : '<tr><td colspan="4" class="empty">No scan yet.</td></tr>';
}

function streamInfo(streams, id) {
  return streams.find((x) => x.id === id) || {};
}

function renderSeen(streams) {
  const rows = [...state.gaSeen].sort((a, b) => b.lastAt - a.lastAt).slice(0, 100);
  $('seen').innerHTML = rows.length ? rows.map((g) => {
    const s = streamInfo(streams, g.id);
    const share = g.entrants && g.viewers ? `${Math.round((g.entrants / g.viewers) * 100)}%` : '–';
    return `<tr data-url="https://www.whatnot.com/live/${esc(g.id)}" data-id="${esc(g.id)}">
      <td class="muted">${when(g.lastAt)}</td>
      <td>${esc(s.seller || '–')}</td>
      <td class="wide">${esc(g.prize || '–')}</td>
      <td class="num" data-label="Entries">${g.entrants ?? '–'}</td>
      <td class="num" data-label="Viewers">${g.viewers ?? '–'}</td>
      <td class="num" data-label="Entered">${share}</td>
      <td class="muted">${g.via === 'peek' ? 'peek' : 'you'}${g.entered ? ' · entered' : ''}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="7" class="empty">None yet. Watch a stream while a giveaway shows "Entries", or turn on Peek in Settings.</td></tr>';
}

function renderWins(streams) {
  const wins = state.log.filter((e) => e.type === 'win').sort((a, b) => b.at - a.at);
  $('wins').innerHTML = wins.length ? wins.map((w) => {
    const s = streamInfo(streams, w.id);
    return `<tr><td class="muted">${when(w.at)}</td><td>${esc(s.seller || '–')}</td><td class="wide">${esc(s.title || w.id)}</td><td class="num" data-label="Value">${fmtMoney(w.value || 0)}</td></tr>`;
  }).join('') : '<tr><td colspan="4" class="empty">No wins logged yet.</td></tr>';
}

// Events
for (const tb of ['streams', 'seen']) {
  $(tb).addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-url]');
    if (tr) chrome.runtime.sendMessage({ type: 'open', url: tr.dataset.url, id: tr.dataset.id });
  });
}
document.querySelectorAll('th.sortable').forEach((th) => th.addEventListener('click', () => { sortKey = th.dataset.k; $('sort').value = sortKey; render(); }));
$('sort').addEventListener('change', () => { sortKey = $('sort').value; render(); });
['cat', 'nobuyers', 'all'].forEach((id) => $(id).addEventListener('change', render));
$('q').addEventListener('input', render);
$('scan').onclick = async () => { await chrome.runtime.sendMessage({ type: 'scanNow' }); state.scanning = true; render(); };
$('opts').onclick = () => chrome.runtime.openOptionsPage();
chrome.storage.onChanged.addListener(() => load());
window.addEventListener('resize', () => render());

// Tick the countdowns every second without rebuilding the tables.
setInterval(() => {
  document.querySelectorAll('[data-ends]').forEach((el) => {
    el.textContent = clockText((+el.dataset.ends - Date.now()) / 1000, el.dataset.est === '1');
  });
}, 1000);
setInterval(load, 30e3); // keep "x min ago" and scanning state fresh

load();
