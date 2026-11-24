'use strict';
// Node's built-in runner. The dashboard is dependency-free, so the pure seam is
// exported from app.js and the browser boot is skipped when there is no document.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ENTRY = path.join(__dirname, '..', '..', 'dashboard', 'app.js');
const load = () => {
  delete require.cache[require.resolve(ENTRY)];
  return require(ENTRY);
};

const rows = [
  {
    rank: 1, slug: 'alpha-lend', name: 'Alpha Lend', category: 'Lending', chains: ['Ethereum'],
    tvl_usd: 120000000, change_7d: 4.2, listed_at: '2024-02-01', age_days: 900, watchlist: true,
    access: 'Permissioned / verify', implied_value_usd: 240000000, low_usd: 160000000, high_usd: 400000000,
    peer_count: 4, multiple: 2, peer_basis: 'Lending peers', confidence: 'Moderate',
    farm_steps: ['a'], farm: {}, evidence: [], peers: [], mcap_usd: null, symbol: null,
  },
  {
    rank: 2, slug: 'beta-vault', name: 'Beta Vault', category: 'Risk Curators', chains: ['Base'],
    tvl_usd: 50000000, change_7d: -1.5, listed_at: '2026-08-01', age_days: 105, watchlist: true,
    access: 'Technical / verify', implied_value_usd: 90000000, low_usd: 45000000, high_usd: 210000000,
    peer_count: 2, multiple: 1.8, peer_basis: 'Vault peers', confidence: 'Low',
    farm_steps: ['b'], farm: {}, evidence: [], peers: [], mcap_usd: null, symbol: 'BETA',
  },
  {
    rank: 3, slug: 'gamma-perp', name: 'Gamma Perp', category: 'Derivatives', chains: ['Arbitrum'],
    tvl_usd: 30000000, change_7d: 9.1, listed_at: '2023-05-01', age_days: 1200, watchlist: false,
    access: 'Verify access', implied_value_usd: 61000000, low_usd: 25000000, high_usd: 150000000,
    peer_count: 5, multiple: 2.03, peer_basis: 'Derivatives peers', confidence: 'Moderate',
    farm_steps: ['c'], farm: {}, evidence: [], peers: [], mcap_usd: 5000000, symbol: 'GAM',
  },
];

test('route is derived from category, never from the incoming access label', () => {
  const { deriveRoute } = load();
  assert.equal(deriveRoute('Risk Curators'), 'Curated vault');
  assert.equal(deriveRoute('Onchain Capital Allocator'), 'Curated vault');
  assert.equal(deriveRoute('Synthetics'), 'Check terms');
  assert.equal(deriveRoute('Leveraged Farming'), 'Check terms');
  assert.equal(deriveRoute('Lending'), 'Direct protocol');
});

test('filterRows applies route, stage and search, then sorts by implied value desc', () => {
  const { filterRows } = load();
  const out = filterRows(rows, { stage: 'watchlist', route: 'Curated vault', query: '', category: 'all', chain: 'all' });
  assert.deepEqual(out.map((r) => r.slug), ['beta-vault']);

  const early = filterRows(rows, { stage: 'early', route: 'all', query: '', category: 'all', chain: 'all' });
  assert.deepEqual(early.map((r) => r.slug), ['beta-vault']);

  const searched = filterRows(rows, { stage: 'all', route: 'all', query: 'arbitrum', category: 'all', chain: 'all' });
  assert.deepEqual(searched.map((r) => r.slug), ['gamma-perp']);

  const sorted = filterRows(rows, { stage: 'all', route: 'all', query: '', category: 'all', chain: 'all' });
  assert.deepEqual(sorted.map((r) => r.slug), ['alpha-lend', 'beta-vault', 'gamma-perp']);
});

test('scenario arithmetic deducts the full farm cost and rejects an empty cohort', () => {
  const { scenarioNet } = load();
  assert.equal(scenarioNet({ cap: 100000000, allocationPct: 5, farmers: 5000, probabilityPct: 20, cost: 250 }), -50);
  assert.equal(scenarioNet({ cap: 100000000, allocationPct: 5, farmers: 0, probabilityPct: 20, cost: 250 }), null);
  assert.equal(scenarioNet({ cap: 100000000, allocationPct: 5, farmers: 5000, probabilityPct: 120, cost: 0 }), 1200);
});

test('hash routes distinguish early view, protocol detail and method', () => {
  const { parseRoute } = load();
  assert.deepEqual(parseRoute('#view=early'), { view: 'early', slug: null });
  assert.deepEqual(parseRoute('#p=alpha-lend'), { view: 'detail', slug: 'alpha-lend' });
  assert.deepEqual(parseRoute('#method'), { view: 'method', slug: null });
  assert.deepEqual(parseRoute(''), { view: 'board', slug: null });
});