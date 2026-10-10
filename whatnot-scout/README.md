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

## Dashboard

Popup → **Dashboard** opens a full-tab view: headline numbers (streams worth entering now,
live giveaway streams, best per entry, entries ÷ viewers, wins), a sortable and filterable
table of live giveaway streams with live countdowns and queued giveaways (click a row to
open the stream), giveaway streams per category, scan health per page, every giveaway
measured on a stream page, and your wins. It updates itself after each scan.

## On your phone

Phones can't run the scanner (phone browsers don't run extensions), so the computer keeps
scanning and sends its alerts to the phone:

1. Install **ntfy** (free, App Store / Google Play, no account).
2. Settings → **Phone alerts**: copy the topic name (random, made for you), subscribe to it
   in the ntfy app, tick **Send alerts to my phone**, **Send a test alert**, then **Save**.

Every alert the computer shows (good giveaway, countdown, giveaways queued) then also
arrives on the phone; tapping it opens the stream. Alerts go through ntfy.sh: anyone who
knows the topic name can read them (stream titles and links), so keep it private. The
dashboard also lays itself out for a phone-width screen.

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

### Time-left estimate from seller history

Whatnot's web page shows no giveaway countdown, so the scout learns how long each seller's
giveaways usually run. While a stream is open in a tab, the reader checks the page every
2 s. When a giveaway banner appears and then ends, its length goes into that seller's
history (the last 20, kept on your computer). The next time you watch a giveaway from that
seller start, a small badge at the bottom-left of the Whatnot page shows
`⏱ ~0:41 left · usually 60s (3 timed)`. The popup and dashboard show the same estimate
(marked "est.") and, once a few starts have been seen, how often the seller runs one
("one every ~12 min").

The estimate needs the moment the giveaway started, so it only works when the stream was
open before the banner appeared. A giveaway already running when you arrive shows
"Giveaways here usually last ~60s" instead.

### Giveaways not mentioned in the title

- **Seller memory**: any seller seen running or queueing a giveaway (in a stream you watch
  or a peek) counts as a giveaway streamer for 14 days. Their streams are listed even when
  the title says nothing, tagged `not in title: seller ran N giveaways lately`, scored with
  the default prize until a reading gives the real one.
- **Discovery peeks** (with Peek on): each scan also opens 2 live streams (settable, 0 turns
  it off) whose title doesn't mention a giveaway, 5-300 viewers, each at most once an
  hour. If the page shows a running giveaway or "Upcoming Giveaways (N)" in the shop, the
  stream is listed and alerted like any other, and the seller is remembered.

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

Limits: without Peek it only knows titles, cards and the streams you watch, so a giveaway
not in the title is found only once you or a discovery peek has seen that seller run one.
Prize values in titles can be exaggerated.

## If it reads nothing

Whatnot's page layout is not documented and changes. If the popup says no streams were
read, click **Copy debug** and send the copied text: it holds what the scanner saw on each page.

## Tests (developers)

```
node --test test/parse.test.mjs                       # title parsing and scoring
NODE_PATH=$(npm root -g) node test/e2e.mjs            # loads the extension in Chromium
# needs full Chromium (not the headless shell): CHROMIUM_PATH=/path/to/chromium
```
The end-to-end test needs Playwright and routes every whatnot.com page to
`test/fixture-search.html`, a mock listing page, so it never contacts Whatnot.
