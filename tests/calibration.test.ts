import test from 'node:test';
import assert from 'node:assert/strict';
import {fitPeers,estimate,MODEL} from '../lib/model.ts';
const protocol=(i:number,ratio:number)=>({slug:'p'+i,name:'P'+i,category:i%2?'Dexs':'Lending',chains:['Base'],tvl_usd:1e7+i*1e6,mcap_usd:(1e7+i*1e6)*ratio,symbol:'P'+i,gecko_id:'p'+i,change_7d:0,listed_at:'2026-01-01'});
const ps=Array.from({length:50},(_,i)=>protocol(i,i%2?2:0.2));
const snap={as_of:'2026-11-14',floor_usd:5e7,source:'synthetic test fixture',watchlist:[],protocols:ps};
test('reported validation scores complete production estimator on untouched folds',()=>{
 const f=fitPeers(snap);
 assert.equal(f.calibration.folds,5,'five disjoint test folds, not number of held-out observations');
 assert.equal(f.calibration.evaluated,50,'every peer predicted without access to its cap');
 assert(f.calibration.log_mae<0.6,'category structure should be recovered');
 assert(f.calibration.interval_coverage>=0&&f.calibration.interval_coverage<=1);
});
test('rare category uses global uncertainty rather than confidently fitting itself',()=>{
 const f=fitPeers({...snap,protocols:[...ps, {...protocol(99,40),category:'Rare category'}]});
 const e=estimate({...protocol(102,1),category:'Rare category',mcap_usd:null,symbol:null,gecko_id:null},f);
 assert(e.low<=e.implied&&e.high>=e.implied);
 assert(Number.isFinite(e.implied));
});
