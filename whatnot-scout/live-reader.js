// Content script on whatnot.com. On a stream page (/live/<id>) it reads the
// running giveaway: entry count, item name, countdown, and whether you entered.
// It only reads text; it never clicks. Streams you open yourself are reported
// every few seconds; the scanner's short visits call window.__wnRead() directly.
//
// Layout seen on real stream pages (debug dumps of 2026-10-10 and 10-11):
//   header      seller, rating "4.9", "Follow", viewer count "21"
//   giveaway    a banner over the item panel: "Giveaway", "196", "Entries", [prize], ...
//               usually followed straight away by the running auction:
//   auction     "C", "x is", "Winning!", item, "6 Bids", "Shipping is ...", "$18", "00:01", "Bid: $20"
//   shop        tabs "Auction" "Giveaway" "Sold" (data-testid=show-refinement-button-giveaway),
//               "Upcoming Giveaways (3)", then each queued prize name with "Qty. 1"
//   chat        messages that often say "givvy"
// Only a running giveaway shows "Entries", so the panel is found from that label.
// The prize and countdown are read only from the text between "Entries" and the
// start of the auction block: the auction's item and timer are not the giveaway's.
(() => {
  // After the extension is updated, pages that were already open keep the old
  // copy of this script; install over it when the version differs.
  // chrome.runtime is gone in a page that loaded while the extension was being
  // reloaded or removed: this copy can't talk to the extension, so it stays idle.
  let VERSION;
  try { VERSION = chrome.runtime.getManifest().version; } catch { return; }
  if (window.__wnRead && window.__wnReaderVersion === VERSION) return;
  window.__wnReaderVersion = VERSION;

  const GA_WORD_RE = /\bgiv(?:e\s?-?aways?|e?v?ys?|v?ies)\b|\bGAs?\b/i;
  const TIMER_RE = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/;            // 00:13, 0:45, 1:02:03
  const ENTRIES_WORD_RE = /^entr(?:y|ies)$/i;                         // "9" then "Entries"
  const ENTRIES_INLINE_RE = /^(\d[\d,.]*\s*[kK]?)\s*entr(?:y|ies)$/i;  // "9 Entries"
  const ENTERED_RE = /^(entered|you'?re in|you are entered)!?$/i;
  const ENTER_RE = /^(enter|enter giveaway|join giveaway)$/i;
  const UPCOMING_RE = /upcoming\s+giv\w*\s*\((\d+)\)/i;
  const WINNER_RE = /won the giveaway|giveaway winner/i;
  // Where the auction block starts after a giveaway banner.
  const AUCTION_RE = /^(.+ is|winning!|\d+ bids?|bid: .*|shipping is.*|custom|[A-Z])$/i;
  const QUEUE_STOP_RE = /^(chat|watching|share|follow(ing)?|scroll to bottom|send|say something.*)$/i;
  const QUEUE_SKIP_RE = /^(qty\.? .*|ships from .*|(ca)?\$[\d.,]+(\s*\(est\. [^)]*\))?|pre-bid|\(?est\. .*|\d+ bids?|products \(\d+\)|sold|auction|giveaway|buy now)$/i;
  const NOT_PRIZE_RE = /^(giveaway|givy|givvy|ga|entries|entry|\d[\d,.]*|\$[\d,.]+|\d+ bids?|bid: .*|custom|follow(ing)?|winning!|.* is)$/i;

  const leaves = (root) => {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (/^(SCRIPT|STYLE|NOSCRIPT)$/.test(n.parentElement?.tagName || '') || n.parentElement?.closest('#wn-scout-badge')
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.nodeValue.replace(/\s+/g, ' ').trim();
      if (t) out.push({ t, el: n.parentElement });
    }
    return out;
  };
  const secondsOf = (t) => {
    const m = t.match(TIMER_RE);
    return m ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) : null;
  };
  const count = (s) => {
    const m = String(s).replace(/\s/g, '').match(/^([\d,.]+)([kK])?$/);
    if (!m) return null;
    const n = parseFloat(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1);
    return Number.isFinite(n) ? Math.round(n) : null;
  };

  // Viewer count in the stream header: the number right after "Follow"/"Following".
  function viewersOf(all) {
    const i = all.findIndex((x) => /^follow(ing)?$/i.test(x.t));
    if (i < 0) return null;
    for (const x of all.slice(i + 1, i + 3)) { const n = count(x.t); if (n != null) return n; }
    return null;
  }

  // Seller in the stream header: the name just before the rating ("impressojewelry", "4.9", "Follow").
  function sellerOf(all) {
    const i = all.findIndex((x, k) => /^\d\.\d$/.test(x.t) && k > 0 && /^(follow(ing)?|\d[\d,.]*[kK]?)$/i.test(all[k + 1]?.t || ''));
    return i > 0 ? all[i - 1].t : null;
  }

  // For the debug dump: text and markup hints around each countdown and giveaway label.
  function contextOf(all) {
    const anchors = all.filter((x) => secondsOf(x.t) != null || (GA_WORD_RE.test(x.t) && x.t.length <= 60)).slice(0, 8);
    return anchors.map(({ t, el }) => {
      let box = el;
      const chain = [];
      for (let d = 0; d < 10 && box.parentElement && box.parentElement !== document.body; d++) {
        box = box.parentElement;
        const hint = ['data-testid', 'aria-label', 'role', 'id'].map((k) => box.getAttribute(k) && `${k}=${box.getAttribute(k).slice(0, 40)}`).filter(Boolean).join(' ');
        if (hint) chain.push(`${d}:${box.tagName.toLowerCase()} ${hint}`);
        if (leaves(box).length >= 14) break;
      }
      return { anchor: t, chain, lines: leaves(box).map((x) => x.t.slice(0, 80)).slice(0, 40) };
    });
  }

  // The giveaway countdown is not in the page text (real dumps show only "Giveaway",
  // "196", "Entries"), so look where a drawn timer keeps its state: accessibility
  // labels and values, <time>, SVG ring dash offsets, and bar widths / scaleX.
  // A ring or bar only gives a fraction; two samples a few seconds apart give its
  // speed, and from that the seconds left.
  function bannerOf(el) {
    let box = el;
    for (let d = 0; d < 6 && box.parentElement && box.parentElement !== document.body; d++) {
      box = box.parentElement;
      if (leaves(box).some((x) => /^giv(e\s?-?away|v?y)!?$/i.test(x.t))) return box;
    }
    return el.parentElement?.parentElement || el;
  }

  function timerSignals(banner) {
    const out = {};
    for (const el of [banner, ...banner.querySelectorAll('*')]) {
      const label = ['aria-label', 'aria-valuetext', 'title', 'data-time-left', 'data-seconds']
        .map((k) => el.getAttribute(k) || '').join(' ');
      const m = label.match(/\b(\d{1,2}:\d{2})\b|\b(\d{1,3})\s*(?:s|sec|secs|seconds?)\b/i);
      if (m && out.seconds == null) { out.seconds = m[1] ? secondsOf(m[1]) : +m[2]; out.from = 'label'; }
      const now = parseFloat(el.getAttribute('aria-valuenow'));
      if (!Number.isNaN(now) && out.fraction == null) {
        const min = parseFloat(el.getAttribute('aria-valuemin') || '0');
        const max = parseFloat(el.getAttribute('aria-valuemax') || '100');
        if (max > min) { out.fraction = (now - min) / (max - min); out.from = out.from || 'aria-value'; }
      }
      if (el.tagName === 'TIME') {
        const t = Date.parse(el.getAttribute('datetime') || '');
        if (t > Date.now() && out.endsAt == null) { out.endsAt = t; out.from = out.from || 'time'; }
      }
      if (out.fraction == null && el instanceof SVGElement && /^(circle|path|rect|ellipse)$/i.test(el.tagName)) {
        const cs = getComputedStyle(el);
        const dash = parseFloat(el.getAttribute('stroke-dasharray') || cs.strokeDasharray);
        const off = parseFloat(el.getAttribute('stroke-dashoffset') || cs.strokeDashoffset);
        if (dash > 0 && !Number.isNaN(off) && off !== 0) { out.fraction = Math.min(1, Math.abs(off) / dash); out.from = 'svg-ring'; }
      }
      if (out.fraction == null && el.style) {
        const w = el.style.width.match(/^([\d.]+)%$/);
        const sx = el.style.transform.match(/scaleX\(([\d.]+)\)/);
        if (w) { out.fraction = parseFloat(w[1]) / 100; out.from = 'bar-width'; }
        else if (sx) { out.fraction = parseFloat(sx[1]); out.from = 'bar-scale'; }
      }
    }
    return out;
  }

  // Last ring/bar sample per stream, to turn two fractions into seconds left.
  const samples = new Map();
  // Rate from the oldest sample of the last 30 s that is at least 1 s old: the page is
  // read every 2 s and on demand, so the newest sample alone can be too close.
  function estimateSeconds(id, fraction) {
    const now = Date.now();
    const list = (samples.get(id) || []).filter((x) => now - x.at <= 30000);
    samples.set(id, [...list, { at: now, f: fraction }].slice(-20));
    const last = list.find((x) => now - x.at >= 1000);
    if (!last) return null;
    const rate = (fraction - last.f) / ((now - last.at) / 1000);
    if (Math.abs(rate) < 1e-4) return null;
    const left = rate < 0 ? fraction / -rate : (1 - fraction) / rate;
    return left >= 0 && left < 900 ? Math.round(left) : null;
  }

  // Banner markup for the debug dump: images dropped, long attribute values cut.
  // The cutting is done on the text, not with setAttribute: a cut SVG path "d"
  // makes Chrome log "Expected number" errors.
  function htmlOf(el) {
    const c = el.cloneNode(true);
    c.querySelectorAll('img, video, picture, source').forEach((n) => n.remove());
    return c.outerHTML
      .replace(/\s(?:src|srcset|href)="[^"]*"/g, '')
      .replace(/="([^"]{60})[^"]+"/g, '="$1…"')
      .slice(0, 3000);
  }

  function read() {
    const id = (location.pathname.match(/\/live\/([A-Za-z0-9-]{6,})/) || [])[1] || null;
    const all = leaves(document.body);
    const upAt = all.findIndex((x) => UPCOMING_RE.test(x.t));
    const upm = upAt >= 0 ? all[upAt].t.match(UPCOMING_RE) : null;
    // Queued prize names follow the "Upcoming Giveaways (N)" header in the shop list.
    const upcomingItems = upm
      ? (() => {
        const after = all.slice(upAt + 1, upAt + 1 + 6 * +upm[1]).map((x) => x.t);
        const stop = after.findIndex((t) => QUEUE_STOP_RE.test(t)); // the shop list ended
        return (stop < 0 ? after : after.slice(0, stop)).filter((t) => !QUEUE_SKIP_RE.test(t) && t.length > 2).slice(0, +upm[1]);
      })()
      : [];
    const base = {
      id, at: Date.now(), reader: VERSION,
      viewers: viewersOf(all),
      seller: sellerOf(all),
      upcomingGiveaways: upm ? +upm[1] : null,
      upcomingItems,
      winnerShown: all.some((x) => WINNER_RE.test(x.t)),
    };

    for (let i = 0; i < all.length; i++) {
      let entrants = null;
      if (ENTRIES_WORD_RE.test(all[i].t) && i > 0) entrants = count(all[i - 1].t);
      else { const m = all[i].t.match(ENTRIES_INLINE_RE); if (m) entrants = count(m[1]); }
      if (entrants == null) continue;
      // Smallest block around the "Entries" label that also holds a countdown.
      let box = all[i].el;
      for (let depth = 0; depth < 12 && box && box !== document.body; depth++, box = box.parentElement) {
        const lines = leaves(box);
        if (lines.length > 80) break;
        const at = lines.findIndex((x) => x.el === all[i].el && x.t === all[i].t);
        const timers = lines.map((x, k) => ({ k, s: secondsOf(x.t) })).filter((x) => x.s != null);
        if (!timers.length && lines.length < 6) continue; // a banner with no timer still counts
        const texts = lines.map((x) => x.t);
        let end = texts.findIndex((t, k) => k > at && AUCTION_RE.test(t));
        if (end < 0) end = texts.length;
        const region = texts.slice(at + 1, end);
        // "dseaknots", "won!": the giveaway has ended and shows its winner.
        const wonAt = region.findIndex((t) => /^won!?$/i.test(t));
        if (wonAt >= 0) {
          return {
            ...base, found: true, ended: true, entrants, prize: null, secondsLeft: 0, timerFrom: 'ended',
            winner: wonAt > 0 ? region[wonAt - 1] : null, text: texts.slice(Math.max(0, at - 3), at + 12),
          };
        }
        let timer = region.map(secondsOf).find((x) => x != null) ?? null;
        const banner = bannerOf(all[i].el);
        const sig = timerSignals(banner);
        let timerFrom = timer != null ? 'text' : null;
        if (timer == null && sig.seconds != null) { timer = sig.seconds; timerFrom = sig.from; }
        if (timer == null && sig.endsAt) { timer = Math.round((sig.endsAt - Date.now()) / 1000); timerFrom = 'time'; }
        if (timer == null && sig.fraction != null) {
          timer = estimateSeconds(id, sig.fraction);
          timerFrom = timer != null ? `${sig.from}-rate` : null;
        }
        // "firecaptgirl's spot is ..." is a cut-off notice, not the prize.
        const prize = region.find((t) => !NOT_PRIZE_RE.test(t) && secondsOf(t) == null && t.length > 2 && !/(\.\.\.|…)$/.test(t)) || null;
        return {
          ...base, found: true, entrants, prize,
          secondsLeft: timer,
          timerFrom,
          progress: sig.fraction ?? null,
          bannerHtml: timer == null ? htmlOf(banner.parentElement || banner) : undefined,
          entered: texts.some((t) => ENTERED_RE.test(t)),
          canEnter: texts.some((t) => ENTER_RE.test(t)),
          text: texts.slice(Math.max(0, at - 3), at + 12),
        };
      }
    }
    return {
      ...base, found: false,
      clues: all.map((x) => x.t).filter((t) => (GA_WORD_RE.test(t) && t.length <= 60) || secondsOf(t) != null || /entr(y|ies)/i.test(t)).slice(0, 30),
      context: contextOf(all),
    };
  }
  window.__wnRead = read;

  // Streams you open yourself. Every 2 s: follow each giveaway from its banner appearing
  // to "… won!" (or the banner going away) to time it for this seller's history, report
  // readings, and show the time-left estimate on the page (Whatnot shows no countdown).
  let cur = null;        // the running giveaway: { startedAt, startKnown }
  let quietAt = null;    // last time this page showed no running giveaway
  let lastSent = 0;
  const send = (msg) => { try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch { clearInterval(timer); } };

  function badge(text) {
    let el = document.getElementById('wn-scout-badge');
    if (!text) { el?.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'wn-scout-badge';
      el.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;padding:6px 10px;border-radius:8px;'
        + 'background:rgba(20,20,20,.85);color:#fff;font:600 13px/1.3 system-ui,sans-serif;pointer-events:none';
      document.body.appendChild(el);
    }
    el.textContent = text;
  }

  async function showEstimate(r) {
    if (!r.found || r.ended) return badge(null);
    let h;
    try { h = (await chrome.storage.local.get('sellerStats')).sellerStats?.[r.seller]; } catch { return; }
    const durations = (h?.durations || []).slice().sort((x, y) => x - y);
    if (!durations.length) return badge(r.startKnown ? 'Giveaway Scout: timing this seller\'s giveaway…' : null);
    const typical = durations[durations.length >> 1];
    const n = durations.length;
    if (!r.startKnown) return badge(`Giveaways here usually last ~${typical}s (${n} timed)`);
    const left = Math.max(0, Math.round(typical - (Date.now() - r.startedAt) / 1000));
    badge(`⏱ ~${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left · usually ${typical}s (${n} timed)`);
  }

  const timer = setInterval(() => {
    // After an extension reload this old copy is cut off: stop instead of erroring every 2 s.
    if (!globalThis.chrome?.runtime?.id || window.__wnReaderVersion !== VERSION) { clearInterval(timer); return; }
    // A hidden tab isn't watched: forget the running giveaway so a gap isn't timed as one.
    if (document.hidden || !/^\/live\//.test(location.pathname)) { cur = null; quietAt = null; return; }
    const now = Date.now();
    const r = read();
    const running = r.found && !r.ended;
    if (running && !cur) {
      // Started since the last quiet check (≤ 4 s ago)? Then the start time is known.
      const startKnown = quietAt != null && now - quietAt <= 4000;
      cur = { startedAt: startKnown ? Math.round((quietAt + now) / 2) : now, startKnown };
      send({ type: 'giveawayStart', id: r.id, seller: r.seller, startedAt: cur.startedAt, startKnown });
    }
    if (!running && cur) {
      if (cur.startKnown) send({ type: 'giveawayDone', id: r.id, seller: r.seller, durationSec: (now - cur.startedAt) / 1000 });
      cur = null;
    }
    if (!running) quietAt = now;
    if (cur) { r.startedAt = cur.startedAt; r.startKnown = cur.startKnown; }
    showEstimate(r);
    if (r.found && now - lastSent >= 5000) { lastSent = now; send({ type: 'giveawaySeen', reading: r }); }
  }, 2000);
})();
