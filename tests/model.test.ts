import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRadar, parseSnapshot, isPreToken, isRankable, fitPeers, estimate, accessNote, farmSteps } from '../lib/model.ts';
const snapshot = parseSnapshot(readFileSync('/home/ubuntu/.hermes/cache/scratch/makefun-token-radar/kit/token-radar-01-kit/input/snapshot.json', 'utf8'));
const example = { ...snapshot.protocols.find(p=>p.slug==='curvance')! };

test('missing token identity is not proof of a usable public deposit product', () => {
  assert(!/open to anyone/i.test(accessNote(example)), 'snapshot cannot establish permissionless access');
  const steps = farmSteps({...example, category:'Payments'}, 100).steps;
  assert(!steps.some(s=>/Deposit \$\d+ of a stablecoin into/i.test(s)), 'unknown product must not invent a deposit');
});

test('watchlist retained, ranked values finite, plans bounded and token metadata honest', () => {
  const {board,radar} = buildRadar(snapshot);
  assert(board.length>=100 && board.length<=4000);
  assert.equal(new Set(board.map(r=>r.slug)).size,board.length);
  for(const slug of snapshot.watchlist) assert(board.some(r=>r.slug===slug));
  for(const [i,row] of board.entries()) {
    assert.equal(row.rank,i+1);
    assert(Number.isSafeInteger(row.implied_value_usd) && row.implied_value_usd>0 && row.implied_value_usd<=1e14);
    if(i) assert(board[i-1].implied_value_usd>=row.implied_value_usd);
    assert(row.farm_steps.length>=3 && row.farm_steps.length<=12);
    assert(row.farm_steps.every(s=>s.length>=20 && s.length<=600));
    const source=snapshot.protocols.find(p=>p.slug===row.slug)!;
    assert(isPreToken(source));
    assert.equal(row.implied_value_usd,radar.rows[i].implied_value_usd);
  }
});

test('wrapper/version/token records are not new early launches; unknown parents disclosed', () => {
  assert(!isRankable({...example,name:'Wrapped Example'}));
  assert(!isRankable({...example,name:'Example V2'}));
  assert(!isRankable({...example,category:'Liquid Staking'}));
  assert(!isPreToken({...example,symbol:'TOKEN'}));
  assert(!isPreToken({...example,mcap_usd:1}));
});

test('program model is deterministic and protocol names do not change valuations', () => {
  assert.deepEqual(buildRadar(snapshot),buildRadar(snapshot));
  const fit=fitPeers(snapshot);
  assert.deepEqual(estimate(example,fit),estimate({...example,name:'Renamed sample'},fit));
});
