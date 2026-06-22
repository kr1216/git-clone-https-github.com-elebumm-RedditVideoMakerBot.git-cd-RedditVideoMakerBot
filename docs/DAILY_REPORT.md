# Daily Report Automation

An automated daily briefing that runs at **7:00am US Central** and posts the
results as a GitHub issue.

## What it does

Each run produces one issue with two parts:

- **Section A — Open PR review:** every open pull request in this repo,
  summarized with a recommended next action.
- **Section B — Opportunity research:** live web research on (1) viral
  YouTube/TikTok content + trending hashtags, (2) free/cheap ways to make money
  with AI, (3) step-by-step automation guides for the best of those, and (4)
  in-demand paid 3D-print designs (Etsy / eBay / MakerWorld / etc.).
- **Section C — Clickable focus options:** a checkbox list at the bottom. Tick a
  box and comment "go deeper on #N" to pick what to expand next.

## Files

| File | Purpose |
| --- | --- |
| `.github/workflows/daily-report.yml` | The schedule, the 7am-Central guard, and the publish-as-issue step. |
| `.github/daily-report-prompt.md` | The actual research/report instructions. **Edit this** to change what the report covers. |

## Required setup (you must do these)

1. **Add the API key secret.** In the repo: *Settings → Secrets and variables →
   Actions → New repository secret*:
   - Name: `ANTHROPIC_API_KEY`
   - Value: your Anthropic API key.
   Without this the workflow cannot run.

2. **Merge the workflow to the default branch.** GitHub only runs `schedule`
   (cron) workflows from the **default branch** (`main`). While these files live
   on the feature branch, the cron will *not* fire. Merge to `main` to activate
   it. (`workflow_dispatch` manual runs work from any branch the file exists on.)

3. *(Optional)* **Create the label** `daily-report` so issues are tagged. If the
   label doesn't exist the workflow falls back to creating the issue untagged.

## Test it without waiting for 7am

After it's on `main` (or any branch, for the manual path):
*Actions → Daily Report → Run workflow*. `workflow_dispatch` bypasses the
7am guard so you get an immediate run.

## How the 7am Central timing works

GitHub cron is UTC-only with no daylight-saving awareness. The workflow is
scheduled at both `12:00` and `13:00` UTC, and a guard step checks the real
`America/Chicago` hour and exits unless it is `07`. This yields exactly one 7am
Central run whether it's CST or CDT.

## Tuning

- **Change what's researched:** edit `.github/daily-report-prompt.md`.
- **Change the time:** edit the two `cron:` lines and the `America/Chicago`
  checks in `daily-report.yml`.
- **Change the model / tools / turn budget:** edit `claude_args` in the
  "Generate report with Claude" step.

## Cost note

This runs Claude in CI once per day with web research. Expect a small per-run
API cost. Lower it by reducing `--max-turns` or pinning a cheaper model in
`claude_args` (e.g. `--model claude-sonnet-4-6`).
