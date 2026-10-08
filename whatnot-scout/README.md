# Whatnot Giveaway Scout

A Chrome / Edge extension that finds live Whatnot streams running giveaways in your
categories and ranks them by **estimated prize value ÷ viewers** (your expected value
per entry). It alerts you on the good ones; **you** click in and enter yourself.

It never joins streams, follows, bids, chats or enters giveaways, and it uses only your
normal logged-in browser at a human pace (one page every few seconds, a cycle every 3 minutes).

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
- **Sources**: the defaults are Whatnot category feeds (`?feedId=TABBED_CATEGORY_FEED_V2...`);
  Sports Cards, Jewelry and EDC fall back to a "giveaway" search, which shows only ~4 shows.
- **+ This page**: open any Whatnot category feed or page and add it as a source.
  Use this if a default search page shows products rather than live shows.

## How the score works

- A stream counts as a giveaway when its title says giveaway / GA / GW / givy / givvy.
- Prize = the largest `$` amount in the title that is not an auction start price
  ("$1 starts"), shipping or a discount. If the title has no amount, the assumed default
  ($5, settable) is used and shown as `~$5`.
- Per entry = prize ÷ viewers (treats every viewer as an entrant, so it is conservative).
- "every 15 min" in the title → also an estimated $/hour.
- Buyers-only giveaways ("buyer appreciation", "buyers only") are listed but not alerted
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
