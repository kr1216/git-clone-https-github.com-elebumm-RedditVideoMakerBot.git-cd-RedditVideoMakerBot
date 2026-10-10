# Whatnot Giveaway Scout

A Chrome / Edge extension that finds live Whatnot streams running giveaways in your
categories and ranks them by **estimated prize value ÷ viewers** (your expected value
per entry). It alerts you on the good ones; **you** click in and enter yourself.

It never follows, bids, chats or enters giveaways, and it uses only your normal logged-in
browser at a human pace (one page every few seconds, a cycle every 3 minutes). It opens
streams only if you turn on **Peek** (off by default, see below).

## Install (Chrome or Edge, desktop)

1. Download and unzip `whatnot-scout.zip` (or this folder).
2. Open `chrome://extensions` (Edge: `edge://extensions`), turn on **Developer mode**.
3. Click **Load unpacked** and pick the unzipped `whatnot-scout` folder.
4. Pin the extension (puzzle icon → pin). Be logged in to whatnot.com in that browser.
5. The settings page opens: check the categories, then click the icon → **Scan now**.

Scanning happens in a separate **minimized window**; leave it alone (closing it is fine,
it reopens on the next scan). The computer and browser must stay on.

## Using it

- **Badge number** = live giveaways at or above your alert threshold (default 25¢/entry).
  A red **!** means Whatnot showed a "verify you are human" page: open whatnot.com in
  a normal tab, pass it, and press Scan now.
- **Notification** → click to open the stream. **Popup** → ranked list, click a row to open it.
- **Won** → log the prize value; the footer shows streams opened and $ won over 7 days,
  so you can tell after a week whether this is worth your time.
- **Sources**: Whatnot category feeds (`?feedId=TABBED_CATEGORY_FEED_V2...`) for Lego, Trading
  Cards, Tools, Jewelry, Video Games, Outdoors, Knives (includes EDC), Sports Memorabilia and
  Tactical Gear. Search pages are a poor source: they list only about 4 shows.
- **+ This page**: open any Whatnot category feed or page and add it as a source.

## Giveaway countdowns

On a stream page a running giveaway shows `Giveaway · 9 · Entries · <item> · 00:13` where
auctions show `x is Winning! · 11 Bids · $18 · 00:01`. The reader keys on the **Entries**
label, so auction timers, the shop's Giveaway tab and chat are not mistaken for a giveaway.
It also reads the viewer count (the number after **Follow**) and "Upcoming Giveaways (N)".

- **Streams you open**: while you watch, running giveaways are logged (entries, item, time
  left). The popup footer shows how entries compare with viewers.
- **Peek** (settings, off by default): after each scan it opens the top few giveaway streams
  in the muted scan window for a few seconds each. It alerts with the time left
  (`⏱ 0:41 left · $2.11/entry`) when a good giveaway has at least 20 s to go, and with
  `🎁 2 giveaways queued` when a well-scoring stream has giveaways lined up. Countdowns are
  short, so the queued alert is the one that fires most. Peeking means your account visits
  those streams without you, which Whatnot could notice.
- With a reading, per entry = prize ÷ (entries + you), not prize ÷ viewers.

## How the score works

- A stream counts as a giveaway when its title says giveaway / GA / GW / givy / givvy, or
  "FREE <item>" (not "free shipping").
- Prize = the largest `$` amount in the title that is not an auction start price
  ("$1 starts"), shipping or a discount. If the title has no amount, the assumed default
  ($5, settable) is used and shown as `~$5`.
- Per entry = prize ÷ viewers (treats every viewer as an entrant, so it is conservative).
- "every 15 min" in the title → also an estimated $/hour.
- Buyers-only giveaways ("buyer appreciation", "buyers only") are listed but not alerted
  (only when every giveaway in the title is a buyers' one)
  unless you turn that on.

Limits: it only knows what stream titles and cards say. A giveaway the seller does not
mention in the title is invisible to it, and prize values in titles can be exaggerated.

## If it reads nothing

Whatnot's page layout is not documented and changes. If the popup says no streams were
read, click **Copy debug** and send the copied text: it holds what the scanner saw on each page.

## Tests (developers)

```
node --test test/parse.test.mjs                       # title parsing and scoring
NODE_PATH=$(npm root -g) node test/e2e.mjs            # loads the extension in Chromium
```
The end-to-end test needs Playwright and routes every whatnot.com page to
`test/fixture-search.html`, a mock listing page, so it never contacts Whatnot.
