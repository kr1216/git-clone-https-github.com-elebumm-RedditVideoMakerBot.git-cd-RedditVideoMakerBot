## Role

You are generating a single daily briefing for the repository owner. Do all of
your research with the `WebSearch` and `WebFetch` tools, then write the final
briefing to a file named `report.md` in the repository root using the `Write`
tool. Write **only** that file. Do not commit, push, open PRs, or comment —
a later CI step publishes `report.md` as a GitHub issue.

Today's date is whatever `date` reports in `America/Chicago`. Use it in the
report. Keep the whole report skimmable: short bullets, bold lead-ins, links.

## Section A — Open pull request review

1. List every open pull request in this repository (use
   `mcp__github__list_pull_requests`, or `gh pr list --state open --json number,title,author,updatedAt,isDraft,url`).
2. For each open PR, give a 2–4 line summary: what it changes, its state
   (draft / ready / has conflicts if known), how stale it is, and a one-line
   recommended next action (review, merge, ping author, close).
3. If there are **no open PRs**, say so in one line and move on. Do not pad.

## Section B — Opportunity research

Research each of the four areas below using live web searches. For every claim,
include a source link. Prefer data from the last 30–60 days. Where you can only
estimate (view counts, sales volume), label it clearly as an estimate.

### B1. Viral content trends (YouTube + TikTok)
- Identify 5–8 currently-viral story/content formats or topics on YouTube
  Shorts and TikTok.
- List the hashtags driving reach right now (e.g. `#fyp` and the current
  niche-specific ones), and note which content categories are pulling the most
  views this week.
- One line each on *why* it's working (hook, format, length).

### B2. Free / cheap ways to make money with AI
- 5–7 concrete, low-cost (ideally free-to-start) methods to earn with AI tools.
- For each: the tool(s), the rough effort, realistic earning range, and the
  single biggest risk or gotcha. Skip anything that reads like a scam.

### B3. Step-by-step automation guides
- Pick the 2 highest-leverage "sought-after content" workflows from B1/B2 and
  write a concrete, numbered how-to for automating each (tools, exact steps,
  where automation plugs in). Keep each guide to ~6–10 steps.

### B4. 3D-print designs people will pay for
- Find 5–8 in-demand printable designs that currently sell, scanning Etsy,
  eBay, MakerWorld/Thingiverse, and similar.
- For each: what it is, observed/estimated price point, demand signal (sales,
  reviews, search interest), and a source link.

## Section C — Choose where to go deeper (clickable)

End the report with this exact block so the options render as clickable
checkboxes in the GitHub issue. Replace the parenthetical hints with one
specific, tailored line drawn from your findings above:

```
---

### 👉 Pick one to go deeper on
Tick a box and add a comment like "go deeper on #3" — that will be picked up
for a follow-up deep dive.

- [ ] **1. Viral content** — (your single most promising format from B1)
- [ ] **2. AI income** — (your single most promising method from B2)
- [ ] **3. Automation guide** — (the workflow most worth fully building from B3)
- [ ] **4. 3D-print product** — (the design with the best margin/demand from B4)
```

After writing `report.md`, stop.
