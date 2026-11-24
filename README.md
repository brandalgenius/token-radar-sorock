# token-radar-sorock

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/brandalgenius/token-radar-sorock/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/brandalgenius/token-radar-sorock/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

SIGNAL is a pre-token launch radar: it screens a sealed protocol snapshot for protocols that record no token, prices each one as a conditional multiple of its TVL learned from token-bearing peers, and hands the reader a ranked board, a peer band, a research-first farm plan and an explicit list of what the snapshot cannot prove. Static, offline, deterministic: two runs on the same snapshot write the same bytes.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
node --test tests/*.test.ts
```
