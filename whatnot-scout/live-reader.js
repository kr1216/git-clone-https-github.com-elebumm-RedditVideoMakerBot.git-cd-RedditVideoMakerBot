// Content script on whatnot.com. On a stream page (/live/<id>) it reads the
// giveaway panel: time left, entry count, prize and whether you entered. It only
// reads text; it never clicks. Streams you open yourself are reported every few
// seconds; the scanner's short visits call window.__wnRead() directly.
// Whatnot's stream page markup is not documented: the panel is found as the
// smallest block that holds a giveaway word and a countdown.
(() => {
  if (window.__wnRead) return;

  const GA_WORD_RE = /\bgiv(?:e\s?-?aways?|v?ys?|v?ies)\b|\bGAs?\b/i;
  const TIMER_RE = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/;            // 0:45, 12:05, 1:02:03
  const SECS_RE = /^(\d{1,3})\s*s(?:ec(?:ond)?s?)?$/i;              // 45s, 45 sec
  const ENTRIES_RE = /(\d[\d,.]*\s*[kK]?)\s*(?:entries|entrants|entered|participants|people entered|joined)\b/i;
  const ENTERED_RE = /^(entered|you'?re in|you are entered|joined)!?$/i;
  const UPCOMING_RE = /upcoming\s+giv\w*\s*\((\d+)\)/i;
  const ENTER_RE = /^(enter|enter giveaway|join giveaway|join)$/i;

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
    let m = t.match(TIMER_RE);
    if (m) return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]);
    m = t.match(SECS_RE);
    return m ? +m[1] : null;
  };
  const count = (s) => {
    const m = String(s).replace(/\s/g, '').match(/^([\d,.]+)([kK])?$/);
    if (!m) return null;
    const n = parseFloat(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1);
    return Number.isFinite(n) ? Math.round(n) : null;
  };

  // For the debug dump: the text and markup hints around each countdown and each
  // giveaway label, so the real panel layout can be matched.
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
    // "Upcoming Giveaways (1)" lists queued giveaways, not a running one; long texts are
    // the stream title or chat, which can say "giveaway" anywhere on the page.
    const upm = all.map((x) => x.t.match(UPCOMING_RE)).find(Boolean);
    const upcomingGiveaways = upm ? +upm[1] : null;
    const gaEls = all.filter((x) => GA_WORD_RE.test(x.t) && !UPCOMING_RE.test(x.t) && x.t.length <= 60).map((x) => x.el);
    let best = null;
    for (const el of gaEls) {
      let box = el;
      for (let depth = 0; depth < 12 && box && box !== document.body; depth++, box = box.parentElement) {
        const lines = leaves(box);
        if (lines.length > 80) break; // too big: this is the page, not a panel
        if (lines.some((x) => secondsOf(x.t) != null)) {
          if (!best || lines.length < best.lines.length) best = { box, lines };
          break;
        }
      }
    }
    if (!best) {
      return {
        id, found: false, at: Date.now(), upcomingGiveaways,
        clues: all.map((x) => x.t).filter((t) => GA_WORD_RE.test(t) || secondsOf(t) != null || ENTRIES_RE.test(t)).slice(0, 30),
        context: contextOf(all),
      };
    }
    const texts = best.lines.map((x) => x.t);
    const secondsLeft = texts.map(secondsOf).find((s) => s != null) ?? null;
    let entrants = null;
    const em = texts.join(' ').match(ENTRIES_RE); // "37" and "entries" are often separate texts
    if (em) entrants = count(em[1]);
    const entered = texts.some((t) => ENTERED_RE.test(t));
    const canEnter = texts.some((t) => ENTER_RE.test(t));
    const prize = texts
      .filter((t) => secondsOf(t) == null && !ENTRIES_RE.test(t) && !ENTERED_RE.test(t) && !ENTER_RE.test(t) &&
        !/^(giveaway|givy|givvy|ga)!?$/i.test(t) && t.length > 2)
      .sort((a, b) => b.length - a.length)[0] || null;
    return { id, found: true, at: Date.now(), secondsLeft, entrants, prize, entered, canEnter, upcomingGiveaways, text: texts.slice(0, 20) };
  }
  window.__wnRead = read;

  // Streams you open yourself: report while a giveaway is showing.
  setInterval(() => {
    if (document.hidden || !/^\/live\//.test(location.pathname)) return;
    const r = read();
    if (r.found) chrome.runtime.sendMessage({ type: 'giveawaySeen', reading: r }).catch(() => {});
  }, 5000);
})();
