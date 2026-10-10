import { DEFAULT_SETTINGS, newTopic } from './lib/parse.js';

const $ = (id) => document.getElementById(id);
const NUMS = ['intervalMin', 'minPerEntry', 'defaultValue', 'realertMin', 'peekTop', 'minLeadSec'];
const BOOLS = ['enabled', 'alertBuyersOnly', 'peekEnabled', 'phonePush'];

function fill(s) {
  NUMS.forEach((k) => { $(k).value = s[k]; });
  BOOLS.forEach((k) => { $(k).checked = s[k]; });
  $('sources').value = s.sources.map((x) => `${x.name} | ${x.url}`).join('\n');
  showTopic(s.ntfyTopic || newTopic());
}

function showTopic(topic) {
  $('ntfyTopic').value = topic;
  $('ntfyLink').href = `https://ntfy.sh/${topic}`;
  $('ntfyLink').textContent = `ntfy.sh/${topic}`;
}

async function load() {
  const { settings } = await chrome.storage.sync.get('settings');
  fill({ ...DEFAULT_SETTINGS, ...(settings || {}) });
}

$('save').onclick = async () => {
  const s = { ...DEFAULT_SETTINGS };
  NUMS.forEach((k) => { const v = parseFloat($(k).value); if (!Number.isNaN(v)) s[k] = v; });
  BOOLS.forEach((k) => { s[k] = $(k).checked; });
  s.ntfyTopic = $('ntfyTopic').value.trim();
  s.intervalMin = Math.max(1, s.intervalMin);
  s.sources = $('sources').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name, url] = l.includes('|') ? l.split('|').map((x) => x.trim()) : [l, l];
    return { name, url };
  }).filter((x) => x.url.startsWith('https://www.whatnot.com/'));
  await chrome.storage.sync.set({ settings: s });
  $('msg').textContent = `Saved ${s.sources.length} pages.`;
};
$('reset').onclick = () => { const topic = $('ntfyTopic').value; fill(DEFAULT_SETTINGS); showTopic(topic); };
$('newTopic').onclick = () => showTopic(newTopic());
$('copyTopic').onclick = () => navigator.clipboard.writeText($('ntfyTopic').value).then(() => { $('phoneMsg').textContent = 'Copied.'; });
$('testPhone').onclick = async () => {
  $('phoneMsg').textContent = 'Sending…';
  const r = await chrome.runtime.sendMessage({ type: 'testPhone', topic: $('ntfyTopic').value.trim() });
  $('phoneMsg').textContent = r.ok ? 'Sent. It should appear on your phone in a few seconds. Remember to click Save.' : `Could not send (${r.status}).`;
};
load();
