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
  if (window.__wnRead) return;

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
  const QUEUE_SKIP_RE = /^(qty\.? .*|ships from .*|(ca)?\$[\d.,]+.*|\(?est\. .*|\d+ bids?|products \(\d+\)|sold|auction|giveaway|buy now)$/i;
  const NOT_PRIZE_RE = /^(giveaway|givy|givvy|ga|entries|entry|\d[\d,.]*|\$[\d,.]+|\d+ bids?|bid: .*|custom|follow(ing)?|winning!|.* is)$/i;

  const leaves = (root) => {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (/^(SCRIPT|STYLE|NOSCRIPT)$/.test(n.parentElement?.tagName || '') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
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

  function read() {
    const id = (location.pathname.match(/\/live\/([A-Za-z0-9-]{6,})/) || [])[1] || null;
    const all = leaves(document.body);
    const upAt = all.findIndex((x) => UPCOMING_RE.test(x.t));
    const upm = upAt >= 0 ? all[upAt].t.match(UPCOMING_RE) : null;
    // Queued prize names follow the "Upcoming Giveaways (N)" header in the shop list.
    const upcomingItems = upm
      ? all.slice(upAt + 1, upAt + 1 + 6 * +upm[1]).map((x) => x.t).filter((t) => !QUEUE_SKIP_RE.test(t) && t.length > 2).slice(0, +upm[1])
      : [];
    const base = {
      id, at: Date.now(),
      viewers: viewersOf(all),
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
        const timer = region.map(secondsOf).find((x) => x != null);
        // "firecaptgirl's spot is ..." is a cut-off notice, not the prize.
        const prize = region.find((t) => !NOT_PRIZE_RE.test(t) && secondsOf(t) == null && t.length > 2 && !/(\.\.\.|…)$/.test(t)) || null;
        return {
          ...base, found: true, entrants, prize,
          secondsLeft: timer ?? null,
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

  // Streams you open yourself: report while a giveaway is running.
  setInterval(() => {
    if (document.hidden || !/^\/live\//.test(location.pathname)) return;
    const r = read();
    if (r.found) chrome.runtime.sendMessage({ type: 'giveawaySeen', reading: r }).catch(() => {});
  }, 5000);
})();
