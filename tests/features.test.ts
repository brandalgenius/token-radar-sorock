import test from 'node:test';
import assert from 'node:assert/strict';
import { fitPeers, estimate, type SnapshotProtocol } from '../lib/model.ts';
const peers: SnapshotProtocol[] = Array.from({length:60},(_,i)=>{
 const age = 90 + (i%5)*120;
 const growth = (i%7)*5-15;
 const tvl = 1e7 + i*2e6;
 const ratio = Math.exp(0.5 + 0.7*Math.log10(age) + growth/100);
 return {slug:`fixture-${i}`,name:`Fixture ${i}`,category:'Lending',chains:['Base'],tvl_usd:tvl,mcap_usd:tvl*ratio,symbol:'FIX',gecko_id:'fixture',change_7d:growth,listed_at:new Date(Date.UTC(2026,10,14)-age*86400000).toISOString().slice(0,10)};
});
const snapshot={as_of:'2026-11-14',source:'synthetic feature-contract test',floor_usd:5e7,protocols:peers,watchlist:[]};
test('candidate features are measured out of sample and only material ones score',()=>{
 const fit=fitPeers(snapshot);
 assert.deepEqual(fit.calibration.retained,['tvl']);
 assert.deepEqual(fit.calibration.ablation.map(x=>x.feature),['tvl','growth','age']);
 assert(fit.calibration.ablation.every(x=>Number.isFinite(x.mae_with)&&Number.isFinite(x.mae_without)&&Number.isFinite(x.delta)));
 // TVL must earn its place; a fixture built on age and growth only must show a smaller gain.
 assert(fit.calibration.ablation[0]!.delta<0,'dropping TVL must hurt');
 const p={...peers[0]!,mcap_usd:null,symbol:null,gecko_id:null};
 // A rejected feature cannot move the estimate: that is the retention rule, not a missing input.
 assert.equal(estimate(p,fit).implied,estimate({...p,change_7d:50},fit).implied);
 assert.equal(estimate(p,fit).implied,estimate({...p,listed_at:'2022-01-01'},fit).implied);
 assert.notEqual(estimate(p,fit).implied,estimate({...p,tvl_usd:p.tvl_usd*2},fit).implied);
});
test('unknown tracking age is imputed from training data; missing values remain finite',()=>{
 const fit=fitPeers(snapshot);
 const e=estimate({...peers[0]!,listed_at:null,change_7d:null,mcap_usd:null,symbol:null,gecko_id:null},fit);
 assert(Number.isFinite(e.implied));
 assert(e.low<=e.implied&&e.high>=e.implied);
});
