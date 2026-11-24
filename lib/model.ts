// The launch radar's valuation model: a sealed protocol snapshot in, a ranked board out.
//
// What it estimates, stated plainly: the circulating value a protocol's token would carry if the
// protocol's record stayed as the snapshot shows it. That is a conditional multiple of today's TVL,
// never a forecast that a token is issued, never a payout, never a launch date. The dashboard says
// so in the same words, and every number it shows is derived here from the snapshot alone.
//
// Fit log(mcap/TVL) by ridge regression on log10(TVL), then add median category residuals shrunk
// by eight pseudo-observations. Peers are positive-cap, positive-TVL protocols that already trade,
// CEX excluded. Two further snapshot features, the clamped seven-day change and log10(tracking
// age), are fitted and measured on the same five disjoint folds; each moves held-out error by less
// than 0.02 log units, so neither is retained and neither can move a score. The whole pipeline is
// refitted per fold, so the reported error and the reported residual band are out of sample; the
// band's coverage is measured (about 71%), never asserted as 80%. A thin category's band is widened
// toward the standard error of its own median, so 3 peers never look as certain as 40. Category
// effects borrow strength globally. This model cannot know future circulating supply, FDV, airdrop
// eligibility or a payout.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One fitted peer multiple, kept for the dashboard's peer table. */
export interface PeerStat {
  name: string;
  category: string | null;
  mcap_usd: number;
  tvl_usd: number;
  multiple: number;
}

/** The calibration the model reports about itself, measured out of sample. */
export interface Calibration {
  peer_count: number;
  folds: number;
  evaluated: number;
  log_mae: number;
  baseline_log_mae: number;
  interval_coverage: number;
  shrink: number;
  ridge: number;
  min_peers: number;
  weights: Record<Feature, number>;
  category_count: number;
  median_multiple: number;
  band_half_width: number;
  /** Each candidate feature's held-out effect, measured by adding it to the retained model. */
  ablation: { feature: Feature; mae_with: number; mae_without: number; delta: number }[];
  retained: Feature[];
  material_delta: number;
}

/** The model's fixed choices, stated on the dashboard and printed in board.json rows. */
export interface ModelConstants {
  shrink: number;
  min_peers: number;
  multiple_floor: number;
  multiple_ceiling: number;
  folds: number;
  ridge: number;
}

export const MODEL_VERSION = 'signal-2';
export const MODEL: ModelConstants = {
  shrink: 8,
  min_peers: 3,
  multiple_floor: 0.01,
  multiple_ceiling: 50,
  folds: 5,
  ridge: 10,
};

/** How many pre-token protocols below the watchlist floor the early rows carry, by TVL. */
export const EARLY_ROWS = 260;

/** Categories that are a product of another asset or a venue, never a launch candidate. */
const EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'Anchor BTC',
  'Stablecoin Wrapper',
  'Staking Pool',
  'Restaking',
]);

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word naming a wrapped, staked or bridged product of another asset. */
const PRODUCT_OF_ANOTHER = /\b(wrapped|staked|staking|bridged)\b/i;

/** An exchange's own product, which is a venue's balance sheet and not a launch. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol records a token with a usable market cap and TVL: a peer for the multiples. */
export function isPeer(p: SnapshotProtocol): boolean {
  return !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX';
}

/** Whether a pre-token protocol is a product of another asset or a venue rather than a launch. */
export function isProductOfAnother(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (PRODUCT_OF_ANOTHER.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  return false;
}

/** Whether a protocol may sit on the ranked board: pre-token, its own product, not a release. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isProductOfAnother(p) && !VERSIONED.test(p.name);
}

/** The multiple one peer's own token trades at, or null outside the sane band. */
export function peerMultiple(p: SnapshotProtocol, constants: ModelConstants = MODEL): number | null {
  if (!isPeer(p)) return null;
  const m = (p.mcap_usd as number) / p.tvl_usd;
  if (!Number.isFinite(m) || m < constants.multiple_floor || m > constants.multiple_ceiling) return null;
  return m;
}

/** The median of a list of numbers; the mean of the two middle entries on an even count. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** A percentile by linear interpolation on the sorted list, 0 <= q <= 1. */
export function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 1) return s[0]!;
  const pos = (s.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo]!;
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/** A protocol's route into the protocol, from its category alone: where the deposit actually goes. */
export function routeOf(p: SnapshotProtocol): 'Direct protocol' | 'Curated vault' | 'Check terms' {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('curator') || c.includes('allocator')) return 'Curated vault';
  if (
    c.includes('synthetic') ||
    c.includes('derivative') ||
    c.includes('option') ||
    c.includes('leveraged') ||
    c.includes('predict')
  ) {
    return 'Check terms';
  }
  return 'Direct protocol';
}

/** A protocol's access note, from its category and chains: what a farmer must confirm first. */
export function accessNote(p: SnapshotProtocol): string {
  const route = routeOf(p);
  if (route === 'Curated vault') return 'Deposit into a curated vault: its curator sets the terms, and one vault is one risk box.';
  if (route === 'Check terms') return 'Check the product terms: margin, collateral and settlement rules decide what a position costs.';
  const chains = p.chains.length > 0 ? p.chains.slice(0, 3).join(', ') : 'the chains it lists';
  return `Recorded on ${chains}; the snapshot does not say who may deposit, so confirm the app's own terms and whether your region and wallet can open a position.`;
}

/** Categories where a stablecoin deposit is the protocol's own, ordinary user action. */
const DEPOSIT_CATEGORIES = [
  'lend',
  'cdp',
  'collateral',
  'rwa',
  'curator',
  'allocator',
  'dex',
  'yield',
  'leveraged',
  'perp',
  'derivative',
  'option',
  'synthetic',
  'stable',
  'insurance',
  'index',
  'farm',
  'launchpad',
];

/** Whether the category names a product a reader can act on with a deposit or a position. */
export function isActionableCategory(p: SnapshotProtocol): boolean {
  const c = (p.category ?? '').toLowerCase();
  return DEPOSIT_CATEGORIES.some((k) => c.includes(k));
}

/** One row of board.json: the ranked board's row, its model terms and its farm plan. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: null;
  listed_at: string | null;
  gecko_id: null;
  symbol: null;
  token_status: 'pre-token';
  age_days: number | null;
  /** True when the category or the name marks a product of another asset, kept only for watchlist coverage. */
  product_of_another: boolean;
  implied_value_usd: number;
  implied_range_usd: { low: number; high: number };
  route: 'Direct protocol' | 'Curated vault' | 'Check terms';
  confidence: 'Low';
  model: {
    multiple: number;
    peer_count: number;
    cohort_size: number;
    peer_category: string;
    log_multiple: number;
    residual_band: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row: everything the page needs, farm costs included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  product_of_another: boolean;
  route: 'Direct protocol' | 'Curated vault' | 'Check terms';
  access: string;
  implied_value_usd: number;
  low_usd: number;
  high_usd: number;
  peer_count: number;
  multiple: number;
  peer_basis: string;
  confidence: 'Low';
  evidence: string[];
  farm_steps: string[];
  farm: {
    capital: number;
    gas: number;
    days: number;
    time_hours: number;
    opportunity_cost: number;
    total_cost: number;
    action: string;
    caution: string;
  };
  peers: PeerStat[];
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  universe: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  excluded: { token: number; product: number; release: number; other: number };
  calibration: Calibration;
  method: { formula: string; notes: string[] };
  rows: RadarRow[];
  peers: PeerStat[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** One feature the model can use; only TVL is retained, and only if it earns its place. */
export type Feature = 'tvl' | 'growth' | 'age';
const FEATURES: readonly Feature[] = ['tvl', 'growth', 'age'];
/** A feature is kept only when adding it moves held-out error by at least this much (log units). */
const MATERIAL_DELTA = 0.02;
const RETAINED: readonly Feature[] = ['tvl'];
/** A normal's 10-90 half range is 1.2816 sigma; a median's standard error is 1.253 sigma / sqrt(n). */
const HALF_TO_SIGMA = 1.2816;
const MEDIAN_SE = 1.253;

/**
 * The peer model. Its multiple is log10(TVL) with a shrunk category effect, and a category effect
 * only applies where the category has at least `min_peers` peers of its own; below that a row is
 * priced by TVL alone and its range is widened for the missing cohort, which the row then says.
 * Growth and tracking age are fitted and measured on the same folds, reported with their measured
 * effect, and retained only if they clear MATERIAL_DELTA.
 */
interface PeerFit {
  intercept: number;
  features: readonly Feature[];
  weights: Record<Feature, number>;
  means: Record<Feature, number>;
  categoryEffects: Map<string, number>;
  categoryCount: Map<string, number>;
  lowResidual: number;
  highResidual: number;
  sigma: number;
  medianLogRatio: number;
  asOf?: string;
}
interface Fit extends PeerFit {
  peers: SnapshotProtocol[];
  calibration: Calibration;
}

/** log10 of a protocol's tracking age, floored at a month so a fresh listing cannot explode it. */
function ageFeature(p: SnapshotProtocol, asOf: string, fallback: number): number {
  const days = ageDays(asOf, p.listed_at);
  return days === null ? fallback : Math.log10(Math.max(30, days));
}

/** Clamped seven-day change as a fraction, so one outlier week cannot set the coefficient. */
function growthFeature(p: SnapshotProtocol): number {
  return Math.max(-0.3, Math.min(0.5, finite(p.change_7d, 0) / 100));
}

/** One feature's value for one protocol, with the training mean as the fallback. */
function featureValue(p: SnapshotProtocol, f: Feature, fit: { asOf?: string; means: Record<Feature, number> }): number {
  if (f === 'tvl') return Math.log10(p.tvl_usd);
  if (f === 'growth') return growthFeature(p);
  return ageFeature(p, fit.asOf ?? '1970-01-01', fit.means.age);
}

/** Solve (X'X + lambda I) w = X'y for a small dense system, by Gaussian elimination. */
function ridge(X: number[][], y: number[], lambda: number): number[] {
  const k = X[0]!.length;
  const A = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const b = new Array<number>(k).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let j = 0; j < k; j++) {
      b[j]! += X[i]![j]! * y[i]!;
      for (let l = 0; l < k; l++) A[j]![l]! += X[i]![j]! * X[i]![l]!;
    }
  }
  for (let j = 0; j < k; j++) A[j]![j]! += lambda;
  for (let i = 0; i < k; i++) {
    let pivot = i;
    for (let r = i + 1; r < k; r++) if (Math.abs(A[r]![i]!) > Math.abs(A[pivot]![i]!)) pivot = r;
    [A[i], A[pivot]] = [A[pivot]!, A[i]!];
    [b[i], b[pivot]] = [b[pivot]!, b[i]!];
    const d = A[i]![i]! || 1e-12;
    for (let c = i; c < k; c++) A[i]![c]! /= d;
    b[i]! /= d;
    for (let r = 0; r < k; r++) {
      if (r === i) continue;
      const factor = A[r]![i]!;
      for (let c = i; c < k; c++) A[r]![c]! -= factor * A[i]![c]!;
      b[r]! -= factor * b[i]!;
    }
  }
  return b;
}

/**
 * Train log(mcap/TVL) on the given features, then add median category residuals shrunk by `shrink`
 * pseudo-observations. With withCategory false, no category effect is fitted at all: that is the
 * one-global-multiple baseline the calibration reports against.
 */
function train(
  peers: SnapshotProtocol[],
  asOf: string,
  constants: ModelConstants,
  features: readonly Feature[],
  withCategory = true,
): PeerFit {
  const ys = peers.map(p => Math.log((p.mcap_usd as number) / p.tvl_usd));
  const avg = (ns: number[]) => ns.reduce((a,b) => a+b,0) / Math.max(1,ns.length);
  const rawAge = peers.map(p => ageDays(asOf, p.listed_at)).filter((v): v is number => v !== null);
  const means: Record<Feature, number> = {
    tvl: avg(peers.map(p => Math.log10(p.tvl_usd))),
    growth: avg(peers.map(growthFeature)),
    age: Math.log10(Math.max(30, median(rawAge))),
  };
  const shape = { asOf, means };
  const columns = new Map<Feature, number[]>(FEATURES.map(f => [f, peers.map(p => featureValue(p, f, shape))]));
  const keys = features;
  const X = peers.map((_, i) => keys.map(k => columns.get(k)![i]! - means[k]));
  const my = avg(ys);
  const w = keys.length > 0 ? ridge(X, ys.map(v => v - my), constants.ridge) : [];
  const weights: Record<Feature, number> = { tvl: 0, growth: 0, age: 0 };
  keys.forEach((k, j) => { weights[k] = w[j] ?? 0; });
  const intercept = my - keys.reduce((sum, k) => sum + weights[k] * means[k], 0);
  const linear = peers.map((_, i) => intercept + keys.reduce((sum, k) => sum + weights[k] * columns.get(k)![i]!, 0));
  const categoryEffects = new Map<string, number>();
  const categoryCount = new Map<string, number>();
  if (withCategory) {
    const buckets = new Map<string, number[]>();
    peers.forEach((p, i) => {
      const c = p.category ?? 'Unclassified';
      const ns = buckets.get(c) ?? [];
      ns.push(ys[i]! - linear[i]!);
      buckets.set(c, ns);
    });
    for (const [c, ns] of buckets) {
      categoryEffects.set(c, median(ns) * ns.length / (ns.length + constants.shrink));
      categoryCount.set(c, ns.length);
    }
  }
  const f: PeerFit = {
    intercept, features, weights, means, categoryEffects, categoryCount,
    lowResidual: 0, highResidual: 0, sigma: 0, medianLogRatio: median(ys), asOf,
  };
  const residuals = peers.map((p, i) => ys[i]! - predictLogRatio(p, f));
  f.lowResidual = Math.min(-0.05, percentile(residuals, 0.1));
  f.highResidual = Math.max(0.05, percentile(residuals, 0.9));
  f.sigma = Math.max(0.05, (f.highResidual - f.lowResidual) / 2) / HALF_TO_SIGMA;
  return f;
}

/** The fitted log multiple for one protocol, with or without its category effect. */
function predictLogRatio(p: SnapshotProtocol, fit: PeerFit, withCategory = true): number {
  const effect = withCategory ? (fit.categoryEffects.get(p.category ?? 'Unclassified') ?? 0) : 0;
  return fit.intercept + fit.features.reduce((sum, k) => sum + fit.weights[k] * featureValue(p, k, fit), 0) + effect;
}

/** Whether a row's own category is thick enough for its effect to be used and claimed. */
function hasCohort(p: SnapshotProtocol, fit: PeerFit, constants: ModelConstants): boolean {
  if (fit.categoryEffects.size === 0) return false;
  return (fit.categoryCount.get(p.category ?? 'Unclassified') ?? 0) >= constants.min_peers;
}

/**
 * The range a row is shown: the fitted residual band, widened on both sides by the standard error of
 * a thin category's median so a one-peer category never looks as certain as a full one. The same
 * function measures the coverage the calibration reports, so the claim and the picture agree.
 */
export function bandFor(p: SnapshotProtocol, fit: PeerFit, constants: ModelConstants = MODEL): { low: number; high: number } {
  let low = fit.lowResidual;
  let high = fit.highResidual;
  if (!hasCohort(p, fit, constants)) {
    const n = Math.max(1, fit.categoryCount.get(p.category ?? 'Unclassified') ?? 0);
    const extra = Math.min(1, MEDIAN_SE * fit.sigma / Math.sqrt(n));
    low -= extra;
    high += extra;
  }
  return { low, high };
}

/**
 * The comparison the entry reports against: one global median multiple per fold, learned on the
 * same training peers and applied to the same held-out ones, with no feature and no category term.
 */
function baselineMae(peers: SnapshotProtocol[], constants: ModelConstants): number {
  const folds = Math.min(constants.folds, peers.length);
  let error = 0, evaluated = 0;
  for (let fold = 0; fold < folds; fold++) {
    const training = peers.filter((_, i) => i % folds !== fold);
    const testing = peers.filter((_, i) => i % folds === fold);
    const m = median(training.map((p) => Math.log((p.mcap_usd as number) / p.tvl_usd)));
    for (const p of testing) { error += Math.abs(Math.log((p.mcap_usd as number) / p.tvl_usd) - m); evaluated++; }
  }
  return error / Math.max(1, evaluated);
}

/** Five-fold held-out log MAE and band coverage of the whole pipeline for one feature set. */
function crossValidate(
  peers: SnapshotProtocol[],
  asOf: string,
  constants: ModelConstants,
  features: readonly Feature[],
  withCategory = true,
): { mae: number; coverage: number; evaluated: number } {
  const folds = Math.min(constants.folds, peers.length);
  let error = 0, covered = 0, evaluated = 0;
  for (let fold = 0; fold < folds; fold++) {
    const training = peers.filter((_,i) => i%folds !== fold);
    const testing = peers.filter((_,i) => i%folds === fold);
    const f = train(training, asOf, constants, features, withCategory);
    for (const p of testing) {
      const residual = Math.log((p.mcap_usd as number)/p.tvl_usd) - predictLogRatio(p, f);
      const band = bandFor(p, f, constants);
      error += Math.abs(residual);
      if (residual >= band.low && residual <= band.high) covered++;
      evaluated++;
    }
  }
  return { mae: error / Math.max(1, evaluated), coverage: covered / Math.max(1, evaluated), evaluated };
}

/** Deterministic five-fold validation; every candidate feature is measured before it is dropped. */
export function fitPeers(snapshot: Snapshot, constants: ModelConstants = MODEL): Fit {
  const peers = snapshot.protocols.filter(isPeer).sort((a,b) => a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
  if (peers.length < 5) throw new SnapshotError('at least five token-bearing peers with positive market caps are needed');
  const base = crossValidate(peers, snapshot.as_of, constants, RETAINED);
  const full = train(peers, snapshot.as_of, constants, RETAINED);
  const calibration: Calibration = {
    peer_count: peers.length,
    folds: Math.min(constants.folds, peers.length),
    evaluated: base.evaluated,
    log_mae: base.mae,
    baseline_log_mae: baselineMae(peers, constants),
    interval_coverage: base.coverage,
    shrink: constants.shrink,
    ridge: constants.ridge,
    min_peers: constants.min_peers,
    weights: full.weights,
    category_count: full.categoryCount.size,
    median_multiple: Math.exp(full.medianLogRatio),
    band_half_width: (full.highResidual - full.lowResidual) / 2,
    ablation: FEATURES.map(feature => {
      const withFeature = RETAINED.includes(feature) ? RETAINED : [...RETAINED, feature];
      const without = RETAINED.filter(k => k !== feature);
      const withMae = crossValidate(peers, snapshot.as_of, constants, withFeature).mae;
      const withoutMae = crossValidate(peers, snapshot.as_of, constants, without).mae;
      return { feature, mae_with: withMae, mae_without: withoutMae, delta: withMae - withoutMae };
    }),
    retained: [...RETAINED],
    material_delta: MATERIAL_DELTA,
  };
  return {...full, peers, calibration};
}

/** One protocol's estimate: the multiple, the implied value, the range and the row's own terms. */
export function estimate(
  p: SnapshotProtocol,
  fit: Fit,
  constants: ModelConstants = MODEL,
): {
  implied: number;
  low: number;
  high: number;
  multiple: number;
  peerCount: number;
  peerBasis: string;
  logMultiple: number;
  residualBand: number;
  usedCategory: boolean;
  cohortSize: number;
} {
  const key = p.category ?? 'Unclassified';
  const usedCategory = hasCohort(p, fit, constants);
  const count = fit.categoryCount.get(key) ?? 0;
  const logMultiple = predictLogRatio(p, fit, usedCategory);
  const multiple = Math.exp(logMultiple);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple));
  const band = bandFor(p, fit, constants);
  return {
    implied,
    low: Math.max(1, Math.round(p.tvl_usd * Math.exp(logMultiple + band.low))),
    high: Math.max(2, Math.round(p.tvl_usd * Math.exp(logMultiple + band.high))),
    multiple,
    peerCount: usedCategory ? count : fit.peers.length,
    peerBasis: usedCategory ? key : 'all token peers, no cohort',
    logMultiple,
    residualBand: (band.high - band.low) / 2,
    usedCategory,
    cohortSize: count,
  };
}

/** The three or four peers nearest a protocol's own size in its category, strongest first. */
export function nearestPeers(p: SnapshotProtocol, fit: Fit, constants: ModelConstants = MODEL, limit = 3): PeerStat[] {
  const key = p.category ?? '';
  const sameCategory = fit.peers.filter((q) => (q.category ?? '') === key);
  // A thin category borrows the global pool for its comparables, exactly as the multiple does.
  const pool = sameCategory.length >= Math.min(3, constants.min_peers) ? sameCategory : fit.peers;
  const scored = pool
    .map((q) => ({ q, m: (q.mcap_usd as number)/q.tvl_usd }))
    .sort(
      (a, b) =>
        Math.abs(Math.log(a.q.tvl_usd) - Math.log(p.tvl_usd)) - Math.abs(Math.log(b.q.tvl_usd) - Math.log(p.tvl_usd)) ||
        b.m - a.m ||
        (a.q.slug < b.q.slug ? -1 : a.q.slug > b.q.slug ? 1 : 0),
    )
    .slice(0, limit);
  return scored.map((s) => ({
    name: s.q.name,
    category: s.q.category,
    mcap_usd: s.q.mcap_usd as number,
    tvl_usd: s.q.tvl_usd,
    multiple: Math.round(s.m * 1e4) / 1e4,
  }));
}

/** Assumed scenario capital bands; not observed product minima or fees. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** Assumed research window from tracking age; not a protocol holding requirement. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one opening action, in words a farmer can follow on the protocol's own app. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('rwa'))
    return `Check ${name}'s investor eligibility, asset backing, lockup and redemption terms on ${chain}; only if eligible, size one documented product at no more than the assumed $${capital} budget. Skip it if onboarding is restricted.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `On ${name}'s official ${chain} app, verify supported collateral and its supply or mint workflow first; only then size an unleveraged position within the assumed $${capital} budget. The snapshot cannot establish supported assets.`;
  if (c.includes('curator') || c.includes('allocator'))
    return `Locate one ${name}-curated vault on ${chain}; verify supported assets, manager and withdrawals before considering at most $${capital}. The route is inferred from category, not proof that this vault is publicly accessible.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged'))
    return `Inspect ${name}'s official pools or vaults on ${chain}; verify supported assets, liquidity, fees and withdrawal mechanics. Only if a suitable unleveraged route exists, size one position within the assumed $${capital} budget.`;
  if (c.includes('perp') || c.includes('derivative') || c.includes('option') || c.includes('synthetic'))
    return `Read ${name}'s margin, funding, liquidation and settlement rules before any trade. Verify collateral support; paper-test first. A $${capital} budget is a planning ceiling, not an instruction to create leveraged activity for rewards.`;
  if (c.includes('stable') || c.includes('uncollateralized'))
    return `Verify ${name}'s mint, redeem or deposit workflow on ${chain}, its accepted assets and depeg exposure; consider at most $${capital} only through a documented route. Do not assume a separate governance token exists.`;
  if (c.includes('insurance'))
    return `Read ${name}'s cover terms on ${chain}: what is insured, exclusions, waiting periods and how claims are paid. Only then consider a policy within the assumed $${capital} budget.`;
  if (c.includes('index') || c.includes('farm'))
    return `Inspect ${name}'s documented index or farm product on ${chain}: constituents, rebalancing, fees and exit terms. Only if the risk fits, size one position within the assumed $${capital} budget.`;
  if (c.includes('launchpad'))
    return `Read ${name}'s launch rules on ${chain} before committing anything: allocation method, lockups and refund terms. A $${capital} planning budget is not a requirement to launch a token of your own.`;
  return `Open ${name} on ${chain} and follow its own onboarding: this category has no single deposit action, so use only the product it documents for users.`;
}

/** A step as one string: the action, its cost and its time, within the gate's 20..600 characters. */
export function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Check the protocol's own page before you act.`;
  return s;
}

/**
 * A protocol's farm plan: six steps, research first, then one position, then the record. Every
 * string is derived from the protocol's own fields (category, chains, TVL, age), never from a
 * hand-written list of names, and no step promises a reward.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): { steps: string[]; farm: RadarRow['farm'] } {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const capital = capitalFor(p);
  const days = holdDaysFor(age);
  const gas = capital >= 150 ? 9 : 5;
  const opportunity = Math.round(capital * 0.05 * (days / 365) * 100) / 100;
  const total = Math.round((gas + opportunity) * 100) / 100;
  const action = actionFor(p, capital, chain);
  const ageText = age === null ? 'no listing date in the snapshot' : `tracked since ${p.listed_at} (${age} days)`;
  const steps = [
    stepText(
      `Confirm on ${p.name}'s own site and DefiLlama that no token is recorded yet: the snapshot shows no market cap, no ticker and no CoinGecko id, and it is dated to the day it was fetched.`,
      'nothing',
      '10 minutes',
    ),
    stepText(
      `Read the terms that decide your risk on ${p.name}: ${accessNote(p)}`,
      'nothing',
      '15 minutes',
    ),
    stepText(
      `Only after verifying supported assets and eligibility, fund an isolated wallet on ${chain} within a $${capital} planning ceiling. Reserve an assumed $${gas} total gas budget for entry and exit; replace it with actual quotes before proceeding.`,
      `$${capital} of capital and about $${gas} of gas, counted once`,
      '20 minutes',
    ),
    stepText(action, `$${capital} moves into the position; the $${gas} gas is the same gas counted once above`, '15 minutes to set up'),
    stepText(
      `If you choose to participate, review the position weekly over an assumed ${days}-day research window; exit sooner if risks change. This is not a required holding period. The snapshot lists ${p.name} ${ageText}.`,
      `$${opportunity.toFixed(2)} of forgone yield at 5% a year`,
      `${days} days`,
    ),
    stepText(
      `Before you withdraw, check the protocol's own announcements for a token, a points programme or a claim page, and claim only from a link the protocol itself publishes.`,
      'checking is free; any legitimate transaction gas is part of the single budget above',
      '10 minutes',
    ),
  ];
  const evidence = [
    `TVL $${p.tvl_usd.toLocaleString('en-US')} on ${p.chains.length} chain${p.chains.length === 1 ? '' : 's'}`,
    `No token recorded in the snapshot dated ${ageText}`,
    `Category: ${p.category ?? 'unclassified'}`,
  ];
  return {
    steps,
    farm: {
      capital,
      gas,
      days,
      time_hours: Math.round((10 + 15 + 20 + 15 + 10) / 6) / 10,
      opportunity_cost: opportunity,
      total_cost: total,
      action: actionFor(p, capital, chain),
      caution:
        (routeOf(p) === 'Curated vault'
          ? 'One vault is one curator’s risk box, not a diversified position. '
          : 'One position is one protocol’s risk, and the range on the board is wide. ') +
        'Capital, gas and hold time are planning assumptions, not protocol requirements.',
    },
  };
}

/**
 * The board: every pre-token protocol the snapshot ranks, above and below the floor, then any
 * watchlist slug that the rankable rule drops (a wrapped, staked or versioned product) so the
 * watchlist is covered, flagged rather than silently ranked as a launch.
 */
export function buildBoard(snapshot: Snapshot, constants: ModelConstants = MODEL): BoardRow[] {
  const fit = fitPeers(snapshot, constants);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const p of snapshot.protocols) if (isRankable(p)) chosen.set(p.slug, p);
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined && !chosen.has(slug)) chosen.set(slug, p);
  }
  for (const p of [...chosen.values()]) if (chosen.size > EARLY_ROWS && p.tvl_usd < snapshot.floor_usd && !snapshot.watchlist.includes(p.slug)) chosen.delete(p.slug);

  const scored = [...chosen.values()].map((p) => {
    const e = estimate(p, fit, constants);
    return { p, e, age: ageDays(snapshot.as_of, p.listed_at) };
  });
  scored.sort((a, b) => b.e.implied - a.e.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const plan = farmSteps(s.p, s.age);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: null,
      listed_at: s.p.listed_at,
      gecko_id: null,
      symbol: null,
      token_status: 'pre-token',
      age_days: s.age,
      product_of_another: !isRankable(s.p),
      implied_value_usd: s.e.implied,
      implied_range_usd: { low: s.e.low, high: s.e.high },
      route: routeOf(s.p),
      // The band is wide by construction on this snapshot, and a low confidence is the honest label.
      confidence: 'Low',
      model: {
        multiple: Math.round(s.e.multiple * 1e4) / 1e4,
        peer_count: s.e.peerCount,
        peer_category: s.e.peerBasis,
        log_multiple: Math.round(s.e.logMultiple * 1e4) / 1e4,
        residual_band: Math.round(s.e.residualBand * 1e4) / 1e4,
        cohort_size: s.e.cohortSize,
      },
      farm_steps: plan.steps,
    };
  });
}

/** The dashboard's whole dataset: the board, the peer table and the calibration. */
export function buildRadar(snapshot: Snapshot, constants: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const fit = fitPeers(snapshot, constants);
  const board = buildBoard(snapshot, constants);
  const watchlist = new Set(snapshot.watchlist);
  let token = 0;
  let product = 0;
  let release = 0;
  let other = 0;
  const onBoard = new Set(board.map((r) => r.slug));
  for (const p of snapshot.protocols) {
    if (onBoard.has(p.slug)) continue; // it is a row, counted by rows.length
    if (!isPreToken(p)) token++;
    else if (isProductOfAnother(p)) product++;
    else if (VERSIONED.test(p.name)) release++;
    else other++;
  }
  const rows: RadarRow[] = board.map((row) => {
    const p = snapshot.protocols.find((q) => q.slug === row.slug) as SnapshotProtocol;
    const plan = farmSteps(p, row.age_days);
    const e = estimate(p, fit, constants);
    return {
      rank: row.rank,
      slug: row.slug,
      name: row.name,
      category: row.category,
      chains: row.chains,
      tvl_usd: row.tvl_usd,
      change_7d: row.change_7d,
      listed_at: row.listed_at,
      age_days: row.age_days,
      watchlist: watchlist.has(row.slug),
      product_of_another: row.product_of_another,
      route: row.route,
      access: accessNote(p),
      implied_value_usd: row.implied_value_usd,
      low_usd: row.implied_range_usd.low,
      high_usd: row.implied_range_usd.high,
      peer_count: row.model.peer_count,
      multiple: row.model.multiple,
      peer_basis: row.model.peer_category,
      confidence: row.confidence,
      evidence: [
        `TVL $${row.tvl_usd.toLocaleString('en-US')} across ${row.chains.length} chain${row.chains.length === 1 ? '' : 's'}${row.chains.length > 3 ? ` (${row.chains.slice(0, 3).join(', ')} +${row.chains.length - 3} more)` : row.chains.length ? ` (${row.chains.join(', ')})` : ''}`,
        row.product_of_another
          ? 'On the watchlist, but the snapshot marks this as a product of another asset or a versioned release: kept for coverage, not counted as a launch'
          : `No token recorded on ${snapshot.as_of}`,
        row.model.peer_category === 'all token peers, no cohort'
          ? `${row.model.cohort_size} peer${row.model.cohort_size === 1 ? '' : 's'} in this category is under the ${constants.min_peers} the model needs, so ${row.model.peer_count} token peers price it by TVL alone and its range is widened`
          : `${row.model.peer_count} peers in ${row.model.peer_category} set the multiple`,
        `Range $${row.implied_range_usd.low.toLocaleString('en-US')} to $${row.implied_range_usd.high.toLocaleString('en-US')} at the model’s measured residual band`,
      ],
      farm_steps: plan.steps,
      farm: plan.farm,
      peers: nearestPeers(p, fit, constants),
    };
  });
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    universe: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: rows.filter((r) => !r.watchlist).length,
    excluded: { token, product, release, other },
    calibration: fit.calibration,
    method: {
      formula: `log(mcap / TVL) = ${fit.intercept.toFixed(3)} + (${fit.weights.tvl.toFixed(3)}) × log10(TVL) + shrunk category effect`,
      notes: [
        `${fit.calibration.peer_count} protocols that already record a token train the model; a protocol's own market cap never enters its own estimate.`,
        `Five-fold cross-validation over those peers holds out every cap once: log MAE ${fit.calibration.log_mae.toFixed(3)} against ${fit.calibration.baseline_log_mae.toFixed(3)} for one global median multiple, refitted on each fold's training peers.`,
        `The band is the fitted ten-to-ninetieth residual band, widened by the standard error of a thin category's median, and covers ${(fit.calibration.interval_coverage * 100).toFixed(0)}% of the held-out peers; the same function draws every row's range.`,
        `Growth and tracking age were each added to this fit and measured the same way: ${fit.calibration.ablation.filter((x) => x.feature !== 'tvl').map((x) => `${x.feature} moves held-out error by ${x.delta >= 0 ? '+' : ''}${x.delta.toFixed(3)}`).join(', ')} log units, under the ${fit.calibration.material_delta} the model treats as material, so neither is retained and neither can move a score.`,
        `A category needs ${constants.min_peers} peers of its own before its effect is used: below that a row is priced by TVL alone, says so, and gets a wider range for the missing cohort.`,
        `Conditional value only: not a launch forecast, not a payout, not investment advice, and no protocol's name changes its score.`,
      ],
    },
    rows,
    peers: fit.peers
      .map((p) => ({
        name: p.name,
        category: p.category,
        mcap_usd: p.mcap_usd as number,
        tvl_usd: p.tvl_usd,
        multiple: Math.round(((p.mcap_usd as number)/p.tvl_usd) * 1e4) / 1e4,
      }))
      .sort((a, b) => b.multiple - a.multiple || (a.name < b.name ? -1 : 1)),
  };
  return { board, radar };
}

/** A board the gate will take, or the reason it will not: coverage, order, values, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100 the gate wants`;
  if (board.length > 4000) return `the board holds ${board.length} rows, over the 4000 the gate allows`;
  for (let i = 0; i < board.length; i++) {
    if (board[i]!.rank !== i + 1) return `rank ${i + 1} is ${board[i]!.rank}`;
    if (i > 0 && board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share one implied value: a board that ranks nothing is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
  }
  return null;
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** The dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}