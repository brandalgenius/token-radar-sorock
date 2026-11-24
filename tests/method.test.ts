import test from 'node:test';
import assert from 'node:assert/strict';
import { bandFor, buildRadar, estimate, fitPeers, type SnapshotProtocol } from '../lib/model.ts';

/** A peer whose category median multiple is set by `ratio`, so categories really differ. */
function peer(i: number, category: string, ratio: number): SnapshotProtocol {
  const tvl = 1e7 + i * 1e6;
  return {
    slug: `p${i}`, name: `P${i}`, category, chains: ['Base'], tvl_usd: tvl, mcap_usd: tvl * ratio,
    symbol: `P${i}`, gecko_id: `p${i}`, change_7d: 0, listed_at: '2026-01-01',
  };
}
const peers = [
  ...Array.from({ length: 20 }, (_, i) => peer(i, 'Lending', 2)),
  ...Array.from({ length: 20 }, (_, i) => peer(100 + i, 'Dexs', 0.5)),
  peer(900, 'Rare', 40),
];
const snapshot = { as_of: '2026-11-14', source: 'synthetic method-contract test', floor_usd: 5e7, protocols: peers, watchlist: [] };
const preToken = (p: SnapshotProtocol): SnapshotProtocol => ({ ...p, mcap_usd: null, symbol: null, gecko_id: null });

test('a category below min_peers is priced without its effect and says so', () => {
  const fit = fitPeers(snapshot);
  const rare = preToken(peers[40]!);
  const e = estimate(rare, fit);
  assert.equal(e.usedCategory, false);
  assert.equal(e.peerBasis, 'all token peers, no cohort');
  // Without its own cohort, the rare row must not carry the Rare category's +40x effect.
  const lending = preToken(peers[0]!);
  const le = estimate(lending, fit);
  assert.equal(le.usedCategory, true);
  assert.equal(le.peerBasis, 'Lending');
  assert.equal(e.logMultiple, estimate({ ...rare, category: 'Unseen' }, fit).logMultiple,
    'a thin category must price exactly like an unseen category at the same TVL');
  assert.notEqual(le.logMultiple, estimate({ ...lending, category: 'Unseen' }, fit).logMultiple,
    'a thick category still contributes its fitted effect');
  assert(e.multiple < 40, `a one-peer category must not carry its own 40x median, got ${e.multiple}`);
  // ...and its range must be wider than a thick category's, for the missing cohort.
  const thick = bandFor(lending, fit);
  const thin = bandFor(rare, fit);
  assert(thin.high - thin.low > thick.high - thick.low, 'a thin category needs a wider band');
});

test('held-out error and coverage use the exact production estimator, including thin-category fallback', () => {
  // Two peers per category leave one or two in each training fold, below the three-peer minimum.
  const sparse = {
    ...snapshot,
    protocols: peers.map((p, i) => ({ ...p, category: `Thin ${Math.floor(i / 2)}` })),
  };
  const fit = fitPeers(sparse);
  const folds = fit.calibration.folds;
  let error = 0, covered = 0, evaluated = 0;
  for (let fold = 0; fold < folds; fold++) {
    const training = fit.peers.filter((_, i) => i % folds !== fold);
    const testing = fit.peers.filter((_, i) => i % folds === fold);
    const trained = fitPeers({ ...sparse, protocols: training });
    for (const p of testing) {
      const e = estimate(p, trained);
      const residual = Math.log((p.mcap_usd as number) / p.tvl_usd) - e.logMultiple;
      const band = bandFor(p, trained);
      error += Math.abs(residual);
      if (residual >= band.low && residual <= band.high) covered++;
      assert.equal(e.low, Math.max(1, Math.round(p.tvl_usd * Math.exp(e.logMultiple + band.low))));
      assert.equal(e.high, Math.max(2, Math.round(p.tvl_usd * Math.exp(e.logMultiple + band.high))));
      evaluated++;
    }
  }
  assert(Math.abs(fit.calibration.log_mae - error / evaluated) < 1e-12,
    `reported MAE ${fit.calibration.log_mae} differs from production ${error / evaluated}`);
  assert.equal(fit.calibration.interval_coverage, covered / evaluated);
});

test('the reported baseline is one global median multiple, with no category effect', () => {
  const fit = fitPeers(snapshot);
  const c = fit.calibration;
  // Recompute the baseline by hand: per fold, the median of the training caps, no features, no effects.
  const sorted = [...fit.peers].sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const folds = c.folds;
  let error = 0, n = 0;
  for (let fold = 0; fold < folds; fold++) {
    const train = sorted.filter((_, i) => i % folds !== fold);
    const test = sorted.filter((_, i) => i % folds === fold);
    const ratios = train.map((p) => Math.log((p.mcap_usd as number) / p.tvl_usd)).sort((a, b) => a - b);
    const mid = ratios.length >> 1;
    const m = ratios.length % 2 === 1 ? ratios[mid]! : (ratios[mid - 1]! + ratios[mid]!) / 2;
    for (const p of test) { error += Math.abs(Math.log((p.mcap_usd as number) / p.tvl_usd) - m); n++; }
  }
  assert(Math.abs(c.baseline_log_mae - error / n) < 1e-9, `baseline ${c.baseline_log_mae} is not the plain global median ${error / n}`);
});

test('every screened protocol is accounted for, and a watchlist product is flagged not ranked', () => {
  const withWatch = { ...snapshot, watchlist: ['wrapped'] };
  const wrapped: SnapshotProtocol = { ...peer(950, 'Lending', 3), slug: 'wrapped', name: 'Wrapped Thing', mcap_usd: null, symbol: null, gecko_id: null };
  const { radar, board } = buildRadar({ ...withWatch, protocols: [...peers, wrapped] });
  const sum = radar.rows.length + radar.excluded.token + radar.excluded.product + radar.excluded.release + radar.excluded.other;
  assert.equal(sum, radar.universe, 'rows and every excluded bucket must add up to the universe');
  const row = board.find((r) => r.slug === 'wrapped');
  assert(row, 'a watchlist slug is covered even when it is a product');
  assert.equal(row!.product_of_another, true, 'and it is flagged rather than sold as a launch');
});