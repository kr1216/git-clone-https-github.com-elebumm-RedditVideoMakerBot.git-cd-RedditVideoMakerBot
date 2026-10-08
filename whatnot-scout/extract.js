// Injected into a Whatnot listing page (search, category, home). Reads the stream
// cards already rendered on the page and returns them. It does not click anything.
// Whatnot's markup is not documented, so this keys on stable things: links to
// /live/<id>, links to /user/<name>, and short number-only text (viewer counts).
(() => {
  const LIVE_RE = /\/live\/([A-Za-z0-9-]{6,})/;
  const idOf = (href) => ((href || '').match(LIVE_RE) || [])[1];
  const COUNT_RE = /^(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([kKmM])?$/;
  const UPCOMING_RE = /\b(today|tomorrow|mon|tue|wed|thu|fri|sat|sun)\w*\b.*\d{1,2}(:\d{2})?\s*(am|pm)|\b\d{1,2}:\d{2}\s*(am|pm)\b|\bstarts? in\b|\bscheduled\b|\bnotify me\b|\bremind me\b|\bsave show\b/i;
  const VIEWERS_TEXT_RE = /(\d[\d.,]*\s*[kKmM]?)\s*(viewers?|watching|watchers)/i;

  // Each text node is its own line: innerText glues adjacent inline elements
  // ("LIVE" + "42" -> "LIVE42") and is empty in windows that are not laid out.
  const linesOf = (el) => {
    const out = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (/^(SCRIPT|STYLE|NOSCRIPT)$/.test(n.parentElement?.tagName || '') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.nodeValue.replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
    }
    return out;
  };

  const anchors = [...document.querySelectorAll('a[href*="/live/"]')];
  const cards = new Map();
  for (const a of anchors) {
    const id = idOf(a.getAttribute('href'));
    if (!id || cards.has(id)) continue;
    // Climb to the largest ancestor that still holds only this one stream.
    let card = a;
    while (card.parentElement && card.parentElement !== document.body) {
      const p = card.parentElement;
      const ids = new Set([...p.querySelectorAll('a[href*="/live/"]')].map((x) => idOf(x.getAttribute('href'))));
      if (ids.size > 1) break;
      card = p;
    }
    cards.set(id, { a, card });
  }

  const out = [];
  for (const [id, { a, card }] of cards) {
    const lines = linesOf(card);
    const text = lines.join(' \n ');

    let viewers = null;
    let viewersFrom = null;
    const labelled = [card, ...card.querySelectorAll('[aria-label],[title]')]
      .map((el) => `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`)
      .join(' ');
    const lm = labelled.match(VIEWERS_TEXT_RE) || text.match(VIEWERS_TEXT_RE);
    const toCount = (s) => {
      const m = String(s).trim().match(COUNT_RE);
      if (!m) return null;
      let n = parseFloat(m[1].replace(/,/g, ''));
      if (m[2]) n *= m[2].toLowerCase() === 'k' ? 1e3 : 1e6;
      return Math.round(n);
    };
    if (lm) { viewers = toCount(lm[1]); viewersFrom = 'label'; }
    if (viewers == null) {
      // A line that is only a number (no $) next to the LIVE badge is the viewer count.
      const nums = lines.map(toCount).filter((n) => n != null);
      if (nums.length) { viewers = nums[0]; viewersFrom = 'bare-number'; }
    }

    const sellerLink = card.querySelector('a[href*="/user/"]');
    const seller = sellerLink
      ? (sellerLink.textContent.trim() || (sellerLink.getAttribute('href').match(/\/user\/([^/?#]+)/) || [])[1] || null)
      : null;

    const imgAlt = [...card.querySelectorAll('img[alt]')].map((i) => i.alt.trim()).filter((s) => s.length > 8);
    const candidates = [...lines, a.getAttribute('aria-label') || '', a.title || '', ...imgAlt]
      .filter((s) => s && !COUNT_RE.test(s) && !/^live$/i.test(s) && s !== seller && !/^\$\s?[\d.,]+\s*[kK]?$/.test(s));
    const title = candidates.sort((x, y) => y.length - x.length)[0] || '';

    const liveBadge = lines.some((l) => /^live$/i.test(l)) ||
      !!card.querySelector('[aria-label*="live" i], [data-testid*="live" i]');
    const upcoming = UPCOMING_RE.test(text) && !liveBadge;

    out.push({
      id,
      url: new URL(`/live/${id}`, location.origin).href,
      title: title.slice(0, 200),
      seller,
      viewers,
      viewersFrom,
      live: !upcoming && (liveBadge || viewers != null),
      upcoming,
      lines: lines.slice(0, 12),
    });
  }

  return {
    pageTitle: document.title,
    href: location.href,
    challenge: /just a moment|attention required|verify you are human/i.test(document.title + ' ' + (document.body?.textContent || '').slice(0, 400)),
    loggedOut: !!document.querySelector('a[href*="/login"], a[href*="/signup"]') && anchors.length === 0,
    linkCount: anchors.length,
    streams: out,
  };
})();
