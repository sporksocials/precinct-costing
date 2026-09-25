import { describe, expect, it } from "vitest";
import {
  breakEven,
  breakEvenAtPrice,
  breakEvenChipLabel,
  clampShare,
  goalNeed,
  happyHourUplift,
  netGpPerWeek,
  niceVolume,
  sensitivity,
  simulate,
  switchers,
  unitGp,
  verdict,
  volumeSteps,
  type SimInput,
} from "@/lib/offer-sim";

/** Round numbers: GST 10%, offer $22 inc = $20 ex, cost $8 -> oGp $12 (60%). Regular $33 inc = $30 ex -> rGp $22. */
const base: SimInput = { offerPriceInc: 22, offerCost: 8, regularPriceInc: 33, gstRate: 0.1 };

describe("unit economics", () => {
  it("strips GST from prices and never from costs", () => {
    const g = unitGp(22, 8, 0.1);
    expect(g.gp).toBeCloseTo(12, 9);
    expect(g.gpPct).toBeCloseTo(0.6, 9);
  });
  it("gives per-offer figures, giveaway and discount", () => {
    const s = simulate(base);
    expect(s.offerGpPerSale).toBeCloseTo(12, 9);
    expect(s.offerGpPct).toBeCloseTo(0.6, 9);
    expect(s.regularGpPerUnit).toBeCloseTo(22, 9);
    expect(s.giveawayPerSwitch).toBeCloseTo(10, 9);
    expect(s.discountInc).toBeCloseTo(11, 9);
  });
  it("uses regularCost when different from offerCost", () => {
    const s = simulate({ ...base, regularCost: 10 });
    expect(s.regularGpPerUnit).toBeCloseTo(20, 9);
    expect(s.giveawayPerSwitch).toBeCloseTo(8, 9);
  });
  it("returns nulls with no offer price or no regular price", () => {
    expect(simulate({ ...base, offerPriceInc: null }).offerGpPerSale).toBeNull();
    const s = simulate({ ...base, regularPriceInc: null });
    expect(s.offerGpPerSale).toBeCloseTo(12, 9);
    expect(s.regularGpPerUnit).toBeNull();
    expect(s.giveawayPerSwitch).toBeNull();
    expect(s.breakEven.status).toBe("unknown");
    expect(s.netPerWeek).toBeNull();
  });
});

describe("cannibalisation and defaults", () => {
  it("defaults to 50% and clamps to 0-1", () => {
    expect(clampShare(undefined)).toBe(0.5);
    expect(clampShare(null)).toBe(0.5);
    expect(clampShare(NaN)).toBe(0.5);
    expect(clampShare(-1)).toBe(0);
    expect(clampShare(3)).toBe(1);
    expect(clampShare(0.25)).toBe(0.25);
  });
  it("weeks default to 1 and never below 1", () => {
    expect(simulate(base).weeks).toBe(1);
    expect(simulate({ ...base, weeks: 0 }).weeks).toBe(1);
    expect(simulate({ ...base, weeks: 4 }).weeks).toBe(4);
  });
  it("switchers scale with usual sales when known, else with offer sales", () => {
    expect(switchers(0.5, 40, 100)).toBe(20);
    expect(switchers(0.5, 40, 10)).toBe(10); // cannot switch more than were sold
    expect(switchers(0.5, null, 100)).toBe(50);
  });
});

describe("net profit change", () => {
  it("usual sales known: N * oGp - c * B * rGp", () => {
    // B 40, c 50% -> S 20; N 60: 60*12 - 20*22 = 280
    expect(netGpPerWeek(12, 22, 0.5, 40, 60)).toBeCloseTo(280, 9);
    const s = simulate({ ...base, regularUnitsPerWeek: 40, expectedOfferUnitsPerWeek: 60 });
    expect(s.expected).toMatchObject({ offerUnits: 60, switchers: 20, extraUnits: 40 });
    expect(s.netPerWeek).toBeCloseTo(280, 9);
  });
  it("usual sales unknown: N * (oGp - c * rGp)", () => {
    // 60 * (12 - 0.5*22) = 60
    expect(simulate({ ...base, expectedOfferUnitsPerWeek: 60 }).netPerWeek).toBeCloseTo(60, 9);
  });
  it("multiplies by weeks for the total", () => {
    expect(simulate({ ...base, expectedOfferUnitsPerWeek: 60, weeks: 4 }).netTotal).toBeCloseTo(240, 9);
  });
  it("is negative when too few sales arrive to repay the giveaway", () => {
    // B 40, c 100% -> S 40; N 40: 40*12 - 40*22 = -400
    expect(netGpPerWeek(12, 22, 1, 40, 40)).toBeCloseTo(-400, 9);
  });
  it("is zero at the break-even volume", () => {
    // B 40, c 50%: E* = 20*10/12
    const e = (20 * 10) / 12;
    expect(netGpPerWeek(12, 22, 0.5, 40, 20 + e)).toBeCloseTo(0, 9);
  });
});

describe("break-even", () => {
  it("usual sales known: extra sales repay the giveaway, rounded up, with takings", () => {
    const b = breakEven({ ...base, regularUnitsPerWeek: 40, cannibalisationPct: 0.5 });
    // E* = 20 * 10 / 12 = 16.67 -> 17; N* = 36.67 -> 37
    expect(b.status).toBe("needed");
    expect(b.extraUnitsPerWeek).toBe(17);
    expect(b.offerUnitsPerWeek).toBe(37);
    expect(b.upliftPct).toBeCloseTo(16.6667 / 40, 3);
    expect(b.takingsIncPerWeek).toBe(17 * 22);
    expect(b.takingsExPerWeek).toBeCloseTo(17 * 20, 9);
  });
  it("usual sales unknown: gives a lift, not units", () => {
    const b = breakEven({ ...base, cannibalisationPct: 0.5 });
    expect(b.status).toBe("needed");
    expect(b.extraUnitsPerWeek).toBeNull();
    expect(b.takingsIncPerWeek).toBeNull();
    expect(b.upliftPct).toBeCloseTo((0.5 * 10) / 12, 9);
  });
  it("also reports the most cannibalisation the offer can carry", () => {
    expect(breakEven(base).maxCannibalisation).toBeCloseTo(12 / 22, 9);
  });
  it("never breaks even when the offer earns nothing or loses money", () => {
    expect(breakEven({ ...base, offerPriceInc: 8.8 }).status).toBe("never"); // ex 8.00 = cost
    expect(breakEven({ ...base, offerPriceInc: 5 }).status).toBe("never");
    expect(breakEven({ ...base, offerPriceInc: 5, regularUnitsPerWeek: 40 }).extraUnitsPerWeek).toBeNull();
  });
  it("needs nothing when there is no discount", () => {
    const b = breakEven({ ...base, offerPriceInc: 33, regularUnitsPerWeek: 40 });
    expect(b.status).toBe("none_needed");
    expect(b.extraUnitsPerWeek).toBe(0);
    expect(b.takingsIncPerWeek).toBe(0);
  });
  it("needs nothing when the offer earns more than the regular items", () => {
    expect(breakEven({ ...base, offerPriceInc: 44 }).status).toBe("none_needed");
  });
  it("cannibalisation 0 needs no extra sales", () => {
    const b = breakEven({ ...base, regularUnitsPerWeek: 40, cannibalisationPct: 0 });
    expect(b.status).toBe("none_needed");
    expect(b.extraUnitsPerWeek).toBe(0);
  });
  it("cannibalisation 100% is the full switch: E = B * give / oGp", () => {
    const b = breakEven({ ...base, regularUnitsPerWeek: 60, cannibalisationPct: 1 });
    expect(b.extraUnitsPerWeek).toBe(50); // 60 * 10 / 12 = 50 exactly
    expect(b.offerUnitsPerWeek).toBe(110);
  });
  it("zero usual sales means nobody switches", () => {
    const b = breakEven({ ...base, regularUnitsPerWeek: 0 });
    expect(b.status).toBe("needed");
    expect(b.extraUnitsPerWeek).toBe(0);
  });
  it("does not bump exact whole numbers up", () => {
    expect(breakEven({ ...base, regularUnitsPerWeek: 24, cannibalisationPct: 1 }).extraUnitsPerWeek).toBe(20);
  });
  it("is unknown without a regular price or offer price", () => {
    expect(breakEven({ ...base, regularPriceInc: null }).status).toBe("unknown");
    expect(breakEven({ ...base, offerPriceInc: null }).status).toBe("unknown");
  });
  it("carries the baseline source through", () => {
    expect(simulate(base).baselineSource).toBe("manual");
    expect(simulate({ ...base, baselineSource: "pos" }).baselineSource).toBe("pos");
  });
  it("each ladder price gets its own break-even", () => {
    const i = { ...base, regularUnitsPerWeek: 40, cannibalisationPct: 1 };
    const a = breakEvenAtPrice(i, 22).extraUnitsPerWeek as number;
    const b = breakEvenAtPrice(i, 27.5).extraUnitsPerWeek as number; // ex 25, oGp 17, give 5 -> 40*5/17 = 11.76
    expect(b).toBe(12);
    expect(a).toBeGreaterThan(b);
  });
});

describe("extra profit goal", () => {
  it("usual sales known: E = (T + S * give) / oGp", () => {
    // S 20, give 10, T 120 -> (120 + 200) / 12 = 26.67 -> 27
    const g = goalNeed({ ...base, regularUnitsPerWeek: 40, targetExtraGpPerWeek: 120 });
    expect(g?.extraUnitsPerWeek).toBe(27);
    expect(g?.takingsIncPerWeek).toBe(27 * 22);
  });
  it("usual sales unknown: N = T / (oGp - c * rGp), E = (1 - c) * N", () => {
    // per sale 12 - 11 = 1; T 60 -> N 60, E 30
    const g = goalNeed({ ...base, targetExtraGpPerWeek: 60 });
    expect(g?.offerUnitsPerWeek).toBe(60);
    expect(g?.extraUnitsPerWeek).toBe(30);
  });
  it("is null when unreachable, unset or zero", () => {
    expect(goalNeed({ ...base, cannibalisationPct: 1, targetExtraGpPerWeek: 60 })).toBeNull(); // 12 - 22 < 0
    expect(goalNeed({ ...base, targetExtraGpPerWeek: null })).toBeNull();
    expect(goalNeed({ ...base, targetExtraGpPerWeek: 0 })).toBeNull();
    expect(goalNeed({ ...base, offerPriceInc: 5, targetExtraGpPerWeek: 50 })).toBeNull();
  });
});

describe("happy hour", () => {
  it("20% off at 72% GP needs about 38% more units", () => {
    const u = happyHourUplift(0.2, 0.72) as number;
    expect(u).toBeCloseTo(0.2 / 0.52, 9);
    expect(Math.round(u * 100)).toBe(38);
  });
  it("matches the general full-switch formula", () => {
    // item cost 2.80 ex, sells 11.00 inc = 10 ex -> GP 72%. 20% off -> 8.80 inc
    const s = simulate({ offerPriceInc: 8.8, offerCost: 2.8, regularPriceInc: 11, gstRate: 0.1 });
    expect(s.offerGpPct).toBeCloseTo((8 - 2.8) / 8, 9);
    expect(s.fullSwitchUplift).toBeCloseTo(0.2 / 0.52, 9);
    const b = breakEven({ offerPriceInc: 8.8, offerCost: 2.8, regularPriceInc: 11, gstRate: 0.1, cannibalisationPct: 1, regularUnitsPerWeek: 100 });
    expect(b.extraUnitsPerWeek).toBe(39); // 38.46 rounded up
    expect(b.upliftPct).toBeCloseTo(0.2 / 0.52, 9);
  });
  it("never pays back when the discount eats the whole margin", () => {
    expect(happyHourUplift(0.72, 0.72)).toBeNull();
    expect(happyHourUplift(0.8, 0.72)).toBeNull();
  });
  it("zero discount needs no lift; bad input is null", () => {
    expect(happyHourUplift(0, 0.72)).toBe(0);
    expect(happyHourUplift(-0.1, 0.72)).toBeNull();
    expect(happyHourUplift(NaN, 0.72)).toBeNull();
  });
});

describe("sensitivity table", () => {
  it("has a row per cannibalisation share and a net figure per volume", () => {
    const t = sensitivity({ ...base, regularUnitsPerWeek: 40 }, [0.25, 0.5, 0.75], [20, 40, 80]);
    expect(t?.rows.map((r) => r.share)).toEqual([0.25, 0.5, 0.75]);
    // c 50%, S 20: N 40 -> 480 - 440 = 40
    expect(t?.rows[1].net[1]).toBeCloseTo(40, 9);
    // more cannibalisation is never better
    expect(t!.rows[0].net[2]).toBeGreaterThan(t!.rows[2].net[2]);
  });
  it("is null without prices", () => {
    expect(sensitivity({ ...base, regularPriceInc: null })).toBeNull();
    expect(sensitivity({ ...base, offerPriceInc: null })).toBeNull();
  });
  it("picks volume steps around expected sales, else break-even, else usual sales, else 20", () => {
    expect(volumeSteps({ ...base, expectedOfferUnitsPerWeek: 60 })).toEqual([30, 60, 90, 120]);
    expect(volumeSteps({ ...base, regularUnitsPerWeek: 40 })[1]).toBe(35); // break-even N* 37 -> nearest 5
    expect(volumeSteps(base)).toEqual([10, 20, 30, 40]);
  });
  it("niceVolume rounds sensibly", () => {
    expect(niceVolume(0)).toBe(0);
    expect(niceVolume(0.2)).toBe(1);
    expect(niceVolume(7.4)).toBe(7);
    expect(niceVolume(37)).toBe(35);
    expect(niceVolume(333)).toBe(330);
    expect(niceVolume(1234)).toBe(1250);
  });
});

describe("plain English verdict", () => {
  it("states extra sales and takings in dollars", () => {
    const v = verdict(simulate({ offerPriceInc: 30, offerCost: 12, regularPriceInc: 40, gstRate: 0.1, regularUnitsPerWeek: 40, cannibalisationPct: 1 }));
    // oGp 27.27-12 = 15.27, rGp 36.36-12 = 24.36, give 9.09; E = 40*9.09/15.27 = 23.8 -> 24; takings 24*30 = 720
    expect(v).toBe("Worth it if it brings in at least 24 extra sales a week; that is about $720 in takings.");
  });
  it("uses singular for one sale", () => {
    expect(verdict(simulate({ ...base, regularUnitsPerWeek: 1, cannibalisationPct: 1 }))).toContain("at least 1 extra sale a week");
  });
  it("gives a lift when usual sales are missing", () => {
    expect(verdict(simulate({ ...base, cannibalisationPct: 1 }))).toBe("Worth it if usual sales lift by about 83%. Add your usual weekly sales to see it in dollars.");
  });
  it("covers the never, no-giveaway, unknown and unset cases", () => {
    expect(verdict(simulate({ ...base, offerPriceInc: 5 }))).toMatch(/never pay for itself/);
    expect(verdict(simulate({ ...base, offerPriceInc: 40 }))).toMatch(/every sale is a bonus/);
    expect(verdict(simulate({ ...base, regularPriceInc: null }))).toMatch(/regular price/);
    expect(verdict(simulate({ ...base, offerPriceInc: null }))).toMatch(/Set an offer price/);
  });
  it("adds the expected result", () => {
    expect(verdict(simulate({ ...base, regularUnitsPerWeek: 40, expectedOfferUnitsPerWeek: 60 }))).toContain("At your expected sales it earns $280 a week more.");
    expect(verdict(simulate({ ...base, regularUnitsPerWeek: 40, cannibalisationPct: 1, expectedOfferUnitsPerWeek: 40 }))).toContain("$400 a week less.");
  });
  it("never uses dashes as punctuation", () => {
    for (const p of [5, 22, 40, null]) expect(verdict(simulate({ ...base, offerPriceInc: p, regularUnitsPerWeek: 40, expectedOfferUnitsPerWeek: 10 }))).not.toMatch(/[—–]/);
  });
  it("chip labels", () => {
    expect(breakEvenChipLabel(breakEven({ ...base, regularUnitsPerWeek: 40 }))).toBe("17 extra a week");
    expect(breakEvenChipLabel(breakEven({ ...base, cannibalisationPct: 1 }))).toBe("+83% sales");
    expect(breakEvenChipLabel(breakEven({ ...base, offerPriceInc: 5 }))).toBe("Never breaks even");
    expect(breakEvenChipLabel(breakEven({ ...base, offerPriceInc: 40 }))).toBe("No lift needed");
    expect(breakEvenChipLabel(breakEven({ ...base, regularPriceInc: null }))).toBe("");
  });
});
