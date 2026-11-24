# token-radar-sorock

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/brandalgenius/token-radar-sorock/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/brandalgenius/token-radar-sorock/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

SIGNAL is a pre-token launch radar: it screens a sealed protocol snapshot for protocols that record no token, prices each one as a conditional multiple of its TVL learned from token-bearing peers, and hands the reader a ranked board, a detail view, a research-first farm plan and an explicit list of what the snapshot cannot prove. Static, offline, deterministic: two runs on the same snapshot write the same bytes.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
node --test tests/*.test.ts
```

Node 22.18+ runs `main.ts` directly; there is no build step and no dependency in `package.json`. The program writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` under the output directory.

The optional browser check needs Playwright, which the submitted program never imports:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser.mjs
```

## What it computes

`log(mcap / TVL) = intercept + weight × log10(TVL) + shrunk category effect`, fitted by ridge regression on the 119 protocols in the snapshot that already record a token. A protocol's own market cap never enters its own estimate.

- **Five disjoint folds.** Every peer's cap is held out once, and the whole pipeline — weights, category effects, residual band — is refitted per fold. The reported log MAE (1.56) is out of sample against a 1.78 baseline, which is one global median multiple.
- **Features are measured, not assumed.** The clamped seven-day change and log10(tracking age) are each added to the fit and scored the same way; they move held-out error by +0.001 and +0.015 log units, under the 0.02 the model treats as material, so neither is retained and neither can move a score. `tests/features.test.ts` pins that rule.
- **The band is a measured residual band**, not a promise: training-residual p10/p90, covering 71% of held-out peers, and widened by the standard error of a thin category's median so a three-peer category never looks as certain as a forty-peer one.
- **Thin categories are labelled.** Below three peers a row falls back to the pooled band and says so; `confidence` stays Low while the band is wide.

## What it refuses to claim

No launch date, no launch probability, no airdrop eligibility, no payout, no FDV, no permissionless access. `access` is derived from the category alone — `Direct protocol`, `Curated vault`, `Check terms` — and every farm step is a planning assumption with `capital`, `gas` and a research window priced explicitly, never a protocol requirement. The board's `evidence` list separates recorded fields from model output, and the detail view carries the same split.

## Layout

- `main.ts` — reads the snapshot, writes `/output` (or `MAKEFUN_OUTPUT_DIR`).
- `lib/model.ts` — the peer model, board builder, farm plan and snapshot parser.
- `vendor/makefun-board.ts` — the kit's dossier writer, unmodified.
- `dashboard/` — `index.html`, `app.css`, `app.js`: one static page, no network, deep links via the hash.
- `screenshots/` — the board, a protocol dossier and a filtered early-radar view, captured by `tests/shoot.mjs`.
- `tests/` — model, calibration, feature-retention, plan and browser checks.

`data.js` is `window.RADAR = {…}` so the page opens from `file://` with no fetch, no server and no remote asset.