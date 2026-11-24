import test from 'node:test';
import assert from 'node:assert/strict';
import { farmSteps, type SnapshotProtocol } from '../lib/model.ts';
const p: SnapshotProtocol={slug:'sample',name:'Sample',category:'RWA',chains:['Example chain'],tvl_usd:2e8,change_7d:0,mcap_usd:null,gecko_id:null,symbol:null,listed_at:'2026-01-01'};
test('RWA plan cannot promise a stablecoin lending interface or receipt token',()=>{
 const {steps}=farmSteps(p,300);
 assert(!steps.some(s=>/Supply \$.*stablecoin.*receipt token/.test(s)),'category does not establish asset support or a lending product');
 assert(steps.some(s=>/eligib|restric|terms/i.test(s)));
});
test('capital and gas are scenario budgets, not observed requirements',()=>{
 const {farm}=farmSteps(p,300);
 assert.equal(farm.total_cost,Math.round((farm.gas+farm.capital*0.05*farm.days/365)*100)/100);
 assert(farm.caution.includes('assumptions'),'budget defaults must be identified as assumptions');
});
