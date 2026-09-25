import { money } from "./format";

/**
 * Sales Needed: how many sales does an offer have to bring in to pay for itself?
 * Pure maths. It only simulates and displays numbers; nothing here reads or writes a price.
 *
 * Costs are ex GST, prices inc GST. Every GP$ below is ex GST:
 *   sellEx = priceInc / (1 + gst)          GP$ = sellEx - cost          GP% = GP$ / sellEx
 *
 * WORDS
 *   oGp  = GP$ earned per offer sold                (offer price ex GST - offer cost)
 *   rGp  = GP$ earned per regular (full price) unit (regular price ex GST - regular cost)
 *   give = rGp - oGp   "the giveaway": profit lost each time a usual buyer takes the offer instead
 *   B    = usual units per week (the baseline, optional)
 *   c    = cannibalisation, 0 to 1 ("would have bought anyway")
 *   S    = switchers, offer sales that come from people who would have bought the regular items anyway
 *   E    = extra (new) sales the offer brings in;  N = E + S = total offer sales
 *   T    = extra profit goal per week (optional)
 *
 * MODEL (two cases, so the tool works with and without sales figures)
 *   B known:   switchers are a share of your usual buyers:      S = c * B   (never more than N)
 *   B unknown: switchers are a share of the offer's buyers:     S = c * N
 *   Either way:  net GP change per week = N * oGp - S * rGp
 *                                       = E * oGp - S * give            (doing nothing earns S * rGp)
 *
 * BREAK-EVEN (net = 0, or net = T for a goal)
 *   B known:   E* = (T + S * give) / oGp,  S = c * B          (extra sales must repay the giveaway)
 *              N* = E* + S,   lift = E* / B
 *   B unknown: each offer sale nets oGp - c * rGp, so N* = T / (oGp - c * rGp), E* = (1 - c) * N*.
 *              Without a goal there is no volume to hit, only a lift (E* / B = c * give / oGp) and a
 *              "break-even cannibalisation" c* = oGp / rGp: above that share the offer loses money at any volume.
 *   Edge cases: oGp <= 0 means it never breaks even; give <= 0 or c = 0 means nothing is given away (E* = 0);
 *               T > 0 with oGp - c * rGp <= 0 and no B means the goal is out of reach.
 *   Takings needed = E* x offer price (inc and ex GST): the money the extra sales bring in.
 *
 * HAPPY HOUR (c = 100%, one item, percentage discount d, GP% g): oldGP = P*g, newGP = P*(g - d),
 *   so it needs oldGP / newGP - 1 = d / (g - d) more units. 20% off at 72% GP is 0.2 / 0.52 = 38.5% more.
 */

export type BaselineSource = "manual" | "pos";

export const DEFAULT_CANNIBALISATION = 0.5;
export const CANNIBALISATION_STEPS = [0.25, 0.5, 0.75];

export interface SimInput {
  /** what the offer sells for, inc GST; null until set */
  offerPriceInc: number | null;
  /** ex GST cost of one offer */
  offerCost: number;
  /** what the same items sell for separately, inc GST (sum of the components); null when unknown */
  regularPriceInc: number | null;
  /** ex GST cost of the regular items; defaults to offerCost */
  regularCost?: number | null;
  gstRate: number;
  /** usual units per week of this bundle or item; null/undefined = unknown */
  regularUnitsPerWeek?: number | null;
  /** where regularUnitsPerWeek came from. 'pos' is for when POS sales pre-fill it; the maths is the same */
  baselineSource?: BaselineSource;
  expectedOfferUnitsPerWeek?: number | null;
  /** 0 to 1, default 0.5 */
  cannibalisationPct?: number | null;
  /** default 1 */
  weeks?: number | null;
  targetExtraGpPerWeek?: number | null;
}

/* ------------------------------------------------------------------ small helpers */

const EPS = 1e-9;

function num(n: number | null | undefined): number | null {
  return n != null && Number.isFinite(Number(n)) ? Number(n) : null;
}

/** A units figure: null unless it is a finite number of at least 0. */
function units(n: number | null | undefined): number | null {
  const v = num(n);
  return v != null && v >= 0 ? v : null;
}

/** Cannibalisation as a 0-1 share; missing or invalid falls back to the default. */
export function clampShare(n: number | null | undefined): number {
  const v = num(n);
  if (v == null) return DEFAULT_CANNIBALISATION;
  return Math.min(1, Math.max(0, v));
}

function ceilUnits(n: number): number {
  return Math.ceil(n - EPS) + 0; // + 0 turns -0 into 0
}

export function exGst(priceInc: number, gst: number): number {
  return priceInc / (1 + gst);
}

/** GP$ and GP% for one unit at a price inc GST and a cost ex GST. */
export function unitGp(priceInc: number, cost: number, gst: number): { gp: number; gpPct: number } {
  const ex = exGst(priceInc, gst);
  const g = ex - cost;
  return { gp: g, gpPct: ex > 0 ? g / ex : 0 };
}

/** Switchers S: c * B when the usual sales are known (at most N), else c * N. */
export function switchers(share: number, baseline: number | null, offerUnits: number): number {
  return baseline != null ? Math.min(share * baseline, offerUnits) : share * offerUnits;
}

/** Net GP$ per week of selling N offers versus doing nothing: N * oGp - S * rGp. */
export function netGpPerWeek(oGp: number, rGp: number, share: number, baseline: number | null, offerUnits: number): number {
  return offerUnits * oGp - switchers(share, baseline, offerUnits) * rGp;
}

/** Happy hour: a percentage discount d (0-1) on an item with GP% g (0-1) needs d / (g - d) more units. Null when it can never pay back. */
export function happyHourUplift(discountPct: number, gpPct: number): number | null {
  const d = num(discountPct);
  const g = num(gpPct);
  if (d == null || g == null || d < 0) return null;
  if (d === 0) return 0;
  return g - d > EPS ? d / (g - d) : null;
}

/* ------------------------------------------------------------------ break-even and goals */

export interface Need {
  /** extra (new) offer sales per week, rounded up. Null when it needs usual sales, or is out of reach */
  extraUnitsPerWeek: number | null;
  /** total offer sales per week (extra + switchers), rounded up */
  offerUnitsPerWeek: number | null;
  /** extra sales as a share of usual sales (0.38 = 38% more). Null without usual sales */
  upliftPct: number | null;
  /** takings from the extra sales, per week */
  takingsIncPerWeek: number | null;
  takingsExPerWeek: number | null;
}

export type NeedStatus =
  /** the offer earns nothing per sale, so it can never pay for itself */
  | "never"
  /** nothing is given away, any sale is a bonus */
  | "none_needed"
  /** worked out; see the numbers */
  | "needed"
  /** the regular price is missing, or the goal cannot be reached, or there is no offer price */
  | "unknown";

export interface BreakEven extends Need {
  status: NeedStatus;
  /** the most cannibalisation the offer can carry before it loses money at any volume: oGp / rGp */
  maxCannibalisation: number | null;
}

const NO_NEED: Need = { extraUnitsPerWeek: null, offerUnitsPerWeek: null, upliftPct: null, takingsIncPerWeek: null, takingsExPerWeek: null };

/** Turn exact E and N into a rounded Need with takings (E x offer price). */
function toNeed(extra: number, offer: number, baseline: number | null, priceInc: number, gst: number): Need {
  const e = ceilUnits(Math.max(0, extra));
  return {
    extraUnitsPerWeek: e,
    offerUnitsPerWeek: ceilUnits(Math.max(0, offer)),
    upliftPct: baseline != null && baseline > 0 ? Math.max(0, extra) / baseline : null,
    takingsIncPerWeek: e * priceInc,
    takingsExPerWeek: e * exGst(priceInc, gst),
  };
}

/**
 * Extra and total offer sales per week for net profit >= goal (goal 0 = break-even).
 * Returns null when it cannot be reached (see header for the two models).
 */
export function salesForGoal(oGp: number, rGp: number, share: number, baseline: number | null, goal: number): { extra: number; offer: number } | null {
  if (!(oGp > EPS)) return null;
  const g = Math.max(0, goal);
  if (baseline != null) {
    const s = share * baseline;
    const extra = Math.max(0, (g + s * (rGp - oGp)) / oGp);
    return { extra, offer: extra + s };
  }
  const perSale = oGp - share * rGp; // what each offer sale nets once switchers are counted
  if (g <= EPS) return perSale >= -EPS ? { extra: 0, offer: 0 } : null;
  if (!(perSale > EPS)) return null;
  const offer = g / perSale;
  return { extra: (1 - share) * offer, offer };
}

// Shared unit economics for the functions below.
interface Econ {
  oGp: number;
  oGpPct: number;
  rGp: number | null;
  rGpPct: number | null;
  priceInc: number;
}

function econ(i: SimInput): Econ | null {
  const price = num(i.offerPriceInc);
  if (price == null || price <= 0 || !Number.isFinite(i.offerCost)) return null;
  const o = unitGp(price, i.offerCost, i.gstRate);
  const rp = num(i.regularPriceInc);
  const rc = num(i.regularCost) ?? i.offerCost;
  const r = rp != null && rp > 0 ? unitGp(rp, rc, i.gstRate) : null;
  return { oGp: o.gp, oGpPct: o.gpPct, rGp: r ? r.gp : null, rGpPct: r ? r.gpPct : null, priceInc: price };
}

/** Break-even (net profit change of zero) for an input. Pure function of prices, costs, usual sales and cannibalisation. */
export function breakEven(i: SimInput): BreakEven {
  const e = econ(i);
  if (!e || e.rGp == null) return { ...NO_NEED, status: "unknown", maxCannibalisation: null };
  const share = clampShare(i.cannibalisationPct);
  const baseline = units(i.regularUnitsPerWeek);
  const maxC = e.oGp > EPS && e.rGp > EPS ? e.oGp / e.rGp : null;
  if (!(e.oGp > EPS)) return { ...NO_NEED, status: "never", maxCannibalisation: maxC };
  const give = e.rGp - e.oGp;
  if (give <= EPS || share <= EPS) {
    return { ...toNeed(0, baseline != null ? share * baseline : 0, baseline, e.priceInc, i.gstRate), status: "none_needed", maxCannibalisation: maxC };
  }
  if (baseline == null) {
    // no usual sales: only the lift is known, E* / B = c * give / oGp
    return { ...NO_NEED, upliftPct: (share * give) / e.oGp, status: "needed", maxCannibalisation: maxC };
  }
  const need = salesForGoal(e.oGp, e.rGp, share, baseline, 0);
  return need ? { ...toNeed(need.extra, need.offer, baseline, e.priceInc, i.gstRate), status: "needed", maxCannibalisation: maxC } : { ...NO_NEED, status: "unknown", maxCannibalisation: maxC };
}

/** Sales needed to hit targetExtraGpPerWeek; null when no goal is set, the goal is unreachable, or prices are missing. */
export function goalNeed(i: SimInput): Need | null {
  const goal = num(i.targetExtraGpPerWeek);
  const e = econ(i);
  if (goal == null || goal <= 0 || !e || e.rGp == null) return null;
  const need = salesForGoal(e.oGp, e.rGp, clampShare(i.cannibalisationPct), units(i.regularUnitsPerWeek), goal);
  return need ? toNeed(need.extra, need.offer, units(i.regularUnitsPerWeek), e.priceInc, i.gstRate) : null;
}

/* ------------------------------------------------------------------ whole simulation */

export interface ExpectedResult {
  offerUnits: number;
  switchers: number;
  extraUnits: number;
  netPerWeek: number;
}

export interface Sim {
  baselineSource: BaselineSource;
  weeks: number;
  cannibalisationPct: number;
  /** usual units per week when given */
  regularUnitsPerWeek: number | null;
  offerGpPerSale: number | null;
  offerGpPct: number | null;
  regularGpPerUnit: number | null;
  regularGpPct: number | null;
  /** giveaway per switcher: rGp - oGp (can be negative when the offer earns more than the regular items) */
  giveawayPerSwitch: number | null;
  /** regular price minus offer price, inc GST */
  discountInc: number | null;
  breakEven: BreakEven;
  goal: Need | null;
  /** at the expected offer sales; null when none entered */
  expected: ExpectedResult | null;
  netPerWeek: number | null;
  /** netPerWeek x weeks */
  netTotal: number | null;
  /** break-even extra takings x weeks */
  takingsNeededTotal: number | null;
  /** extra sales as a share of usual sales if every usual buyer switches: give / oGp. The happy hour number */
  fullSwitchUplift: number | null;
}

export function simulate(i: SimInput): Sim {
  const e = econ(i);
  const share = clampShare(i.cannibalisationPct);
  const baseline = units(i.regularUnitsPerWeek);
  const weeksIn = num(i.weeks);
  const weeks = weeksIn != null && weeksIn >= 1 ? weeksIn : 1;
  const expectedUnits = units(i.expectedOfferUnitsPerWeek);
  const be = breakEven(i);
  const rGp = e?.rGp ?? null;

  let expected: ExpectedResult | null = null;
  if (e && rGp != null && expectedUnits != null) {
    const s = switchers(share, baseline, expectedUnits);
    expected = { offerUnits: expectedUnits, switchers: s, extraUnits: expectedUnits - s, netPerWeek: netGpPerWeek(e.oGp, rGp, share, baseline, expectedUnits) };
  }
  const full = e && rGp != null && e.oGp > EPS ? Math.max(0, rGp - e.oGp) / e.oGp : null;
  return {
    baselineSource: i.baselineSource ?? "manual",
    weeks,
    cannibalisationPct: share,
    regularUnitsPerWeek: baseline,
    offerGpPerSale: e ? e.oGp : null,
    offerGpPct: e ? e.oGpPct : null,
    regularGpPerUnit: rGp,
    regularGpPct: e?.rGpPct ?? null,
    giveawayPerSwitch: e && rGp != null ? rGp - e.oGp : null,
    discountInc: e && num(i.regularPriceInc) != null ? Number(i.regularPriceInc) - e.priceInc : null,
    breakEven: be,
    goal: goalNeed(i),
    expected,
    netPerWeek: expected ? expected.netPerWeek : null,
    netTotal: expected ? expected.netPerWeek * weeks : null,
    takingsNeededTotal: be.takingsIncPerWeek != null ? be.takingsIncPerWeek * weeks : null,
    fullSwitchUplift: full,
  };
}

/** Break-even at another offer price (for the price ladder). */
export function breakEvenAtPrice(i: SimInput, priceInc: number): BreakEven {
  return breakEven({ ...i, offerPriceInc: priceInc });
}

/* ------------------------------------------------------------------ sensitivity table */

export interface SensitivityTable {
  /** offer sales per week, the columns */
  volumes: number[];
  rows: { share: number; net: number[] }[];
}

/** A nice round volume: 1-10 exact, then to the nearest 5, then 10, then 50. */
export function niceVolume(n: number): number {
  if (!(n > 0)) return 0;
  if (n <= 10) return Math.max(1, Math.round(n));
  if (n <= 100) return Math.round(n / 5) * 5;
  if (n <= 1000) return Math.round(n / 10) * 10;
  return Math.round(n / 50) * 50;
}

/** Four volume steps around the most useful anchor: expected sales, else break-even, else usual sales, else 20. */
export function volumeSteps(i: SimInput): number[] {
  const be = breakEven(i);
  const anchor = units(i.expectedOfferUnitsPerWeek) || be.offerUnitsPerWeek || units(i.regularUnitsPerWeek) || 20;
  const steps = [0.5, 1, 1.5, 2].map((m) => niceVolume(anchor * m)).filter((v) => v > 0);
  return steps.filter((v, k) => steps.indexOf(v) === k);
}

/** Net GP$ per week for each cannibalisation share (rows) and offer sales volume (columns). Null when regular price or offer price is missing. */
export function sensitivity(i: SimInput, shares: number[] = CANNIBALISATION_STEPS, volumes: number[] = volumeSteps(i)): SensitivityTable | null {
  const e = econ(i);
  if (!e || e.rGp == null) return null;
  const rGp = e.rGp;
  const baseline = units(i.regularUnitsPerWeek);
  return { volumes, rows: shares.map((share) => ({ share, net: volumes.map((n) => netGpPerWeek(e.oGp, rGp, share, baseline, n)) })) };
}

/* ------------------------------------------------------------------ plain English */

function signedMoney(n: number): string {
  return money(Math.abs(n), 0);
}

/** One or two sentences, sentence case, Australian spelling, no em dashes. */
export function verdict(sim: Sim): string {
  const be = sim.breakEven;
  if (sim.offerGpPerSale == null) return "Set an offer price to see how many sales it needs.";
  if (be.status === "never") return "Each offer sold earns nothing after costs, so it can never pay for itself. Raise the price first.";
  if (be.status === "unknown") return "Add a regular price for each component to see how many sales this needs.";
  const tail = expectedSentence(sim);
  if (be.status === "none_needed") return `Nothing is given away here, so every sale is a bonus.${tail}`;
  if (be.extraUnitsPerWeek == null) {
    const lift = Math.round((be.upliftPct ?? 0) * 100);
    return `Worth it if usual sales lift by about ${lift}%. Add your usual weekly sales to see it in dollars.${tail}`;
  }
  const n = be.extraUnitsPerWeek;
  const noun = n === 1 ? "sale" : "sales";
  return `Worth it if it brings in at least ${n} extra ${noun} a week; that is about ${money(be.takingsIncPerWeek, 0)} in takings.${tail}`;
}

function expectedSentence(sim: Sim): string {
  if (sim.netPerWeek == null) return "";
  const n = sim.netPerWeek;
  if (Math.abs(n) < 0.5) return " At your expected sales it about breaks even.";
  return n > 0 ? ` At your expected sales it earns ${signedMoney(n)} a week more.` : ` At your expected sales it earns ${signedMoney(n)} a week less.`;
}

/** Short label for a price chip: "34 extra a week", "+38% sales", "no lift", "never". */
export function breakEvenChipLabel(b: BreakEven): string {
  if (b.status === "never") return "Never breaks even";
  if (b.status === "none_needed") return "No lift needed";
  if (b.status === "unknown") return "";
  if (b.extraUnitsPerWeek != null) return `${b.extraUnitsPerWeek} extra a week`;
  return b.upliftPct != null ? `+${Math.round(b.upliftPct * 100)}% sales` : "";
}
