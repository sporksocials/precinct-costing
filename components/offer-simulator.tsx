"use client";

import { useMemo } from "react";
import { gp, money } from "@/lib/format";
import { breakEvenChipLabel, CANNIBALISATION_STEPS, DEFAULT_CANNIBALISATION, sensitivity, simulate, verdict, volumeSteps, type Need, type Sim, type SimInput } from "@/lib/offer-sim";
import type { OfferCost } from "@/lib/offers";
import type { OfferAssumptions, OfferKind } from "@/lib/types";
import { Chips, cx, FieldRow, Group, InlineInput, Stepper } from "./ui";

/**
 * Sales Needed: type your assumptions, see how many sales an offer needs to pay for itself.
 * Everything is simulated from what is typed here; nothing reads or changes a price.
 * The assumption rows are plain inputs so POS sales can pre-fill "Usual Sales Per Week" later (baseline_source: "pos").
 */

/** "12", "$1,200", "" to a number of at least 0, or null. */
function parseNum(t: string): number | null {
  const s = t.trim().replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const show = (n: number | null | undefined) => (n == null ? "" : String(n));

/** The pure-maths input for an offer's current numbers and the typed assumptions. */
export function simInputFrom(c: OfferCost, a: OfferAssumptions, gstRate: number): SimInput {
  return {
    offerPriceInc: c.offerPriceInc,
    offerCost: c.cost,
    // the regular price only counts once every component has one
    regularPriceInc: c.lines.length && c.regularComplete ? c.regularPriceInc : null,
    gstRate,
    regularUnitsPerWeek: a.usual_per_week ?? null,
    baselineSource: a.baseline_source ?? "manual",
    expectedOfferUnitsPerWeek: a.expected_per_week ?? null,
    cannibalisationPct: (a.cannibalisation ?? DEFAULT_CANNIBALISATION * 100) / 100,
    weeks: a.weeks ?? 1,
    targetExtraGpPerWeek: a.goal_per_week ?? null,
  };
}

/** Small label for a price chip: what break-even means at that price. */
export function priceBreakEvenLabel(input: SimInput, priceInc: number): string {
  return breakEvenChipLabel(simulate({ ...input, offerPriceInc: priceInc }).breakEven);
}

function signed(n: number): string {
  return `${n >= 0 ? "+" : "-"}${money(Math.abs(n), 0)}`;
}

function needText(n: Need | null, unreachable = "Out of reach"): { main: string; sub?: string } {
  if (!n) return { main: unreachable };
  if (n.extraUnitsPerWeek == null) return { main: "—" };
  return { main: `${n.extraUnitsPerWeek} extra a week`, sub: n.offerUnitsPerWeek != null ? `${n.offerUnitsPerWeek} offer sales in all` : undefined };
}

function ResultLine({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "good" | "danger" }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <dt className="min-w-0 text-label-2">{label}</dt>
      <dd className="shrink-0 text-right">
        <span className={cx("block font-medium tnum", tone === "good" && "text-good", tone === "danger" && "text-danger")}>{value}</span>
        {sub ? <span className="block text-[13px] text-label-2 tnum">{sub}</span> : null}
      </dd>
    </div>
  );
}

export function OfferSimulator({
  cost,
  kind,
  gstRate,
  assumptions,
  onChange,
  unsaved,
}: {
  cost: OfferCost;
  kind: OfferKind;
  gstRate: number;
  assumptions: OfferAssumptions;
  onChange: (patch: Partial<OfferAssumptions>) => void;
  /** the assumptions column is missing in the database, so they only live in this session */
  unsaved?: boolean;
}) {
  const input = useMemo(() => simInputFrom(cost, assumptions, gstRate), [cost, assumptions, gstRate]);
  const sim = useMemo(() => simulate(input), [input]);
  const table = useMemo(() => sensitivity(input, CANNIBALISATION_STEPS, volumeSteps(input)), [input]);
  const share = Math.round(sim.cannibalisationPct * 100);
  const hasBaseline = sim.regularUnitsPerWeek != null;
  const ready = cost.lines.length > 0 && cost.cost > 0 && cost.offerPriceInc != null;

  return (
    <section className="mt-8 lg:mt-6" aria-label="Sales Needed">
      <h2 className="text-[22px] font-bold leading-tight tracking-tight">Sales Needed</h2>
      <p className="mt-1 text-[15px] text-label-2">Type what you expect. This only shows numbers, it does not change any price.</p>
      {unsaved ? <p className="mt-2 text-[13px] text-warn">Assumptions will save once the update is applied.</p> : null}

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-x-6 lg:grid-cols-2">
        <div>
          <Group title="Your Assumptions" className="mt-3 lg:mt-0" footer="Leave the optional ones blank to see the lift needed as a percentage.">
            <FieldRow label="Usual Sales Per Week" sub={sim.baselineSource === "pos" ? "From your sales data" : "Optional. Your best guess for now"}>
              <InlineInput value={show(assumptions.usual_per_week)} placeholder="Optional" inputMode="numeric" onCommit={(t) => onChange({ usual_per_week: parseNum(t), baseline_source: "manual" })} />
            </FieldRow>
            <FieldRow label="Expected Offer Sales Per Week" sub="How many offers you think you will sell">
              <InlineInput value={show(assumptions.expected_per_week)} placeholder="Optional" inputMode="numeric" onCommit={(t) => onChange({ expected_per_week: parseNum(t) })} />
            </FieldRow>
            <FieldRow label="Would Have Bought Anyway" sub={hasBaseline ? "Share of your usual buyers who switch to the offer" : "Share of offer buyers who would have paid full price"}>
              <Stepper value={share} min={0} step={5} format={(v) => `${v}%`} onChange={(v) => onChange({ cannibalisation: Math.min(100, v) })} />
            </FieldRow>
            <div className="px-4 pb-3">
              <Chips
                ariaLabel="Would have bought anyway"
                value={String(share)}
                onChange={(v) => onChange({ cannibalisation: Number(v) })}
                options={[25, 50, 75].map((n) => ({ value: String(n), label: `${n}%` }))}
              />
            </div>
            <FieldRow label="Weeks Running">
              <Stepper value={sim.weeks} min={1} onChange={(v) => onChange({ weeks: v })} />
            </FieldRow>
            <FieldRow label="Extra Profit Goal Per Week" sub="Optional">
              <InlineInput value={show(assumptions.goal_per_week)} placeholder="Optional" prefix="$" onCommit={(t) => onChange({ goal_per_week: parseNum(t) })} />
            </FieldRow>
          </Group>
        </div>

        <div className="mt-6 lg:mt-0">
          {ready ? <Results sim={sim} kind={kind} offerPriceInc={cost.offerPriceInc} share={share} hasBaseline={hasBaseline} goalSet={assumptions.goal_per_week != null && assumptions.goal_per_week > 0} table={table} /> : <div className="rounded-2xl bg-surface px-4 py-4 text-[15px] text-label-2">{cost.lines.length === 0 ? "Add a component and an offer price to see how many sales it needs." : cost.offerPriceInc == null ? "Set an offer price to see how many sales it needs." : "A component costs $0, so sales needed can’t be worked out yet. Check its recipe."}</div>}
        </div>
      </div>
    </section>
  );
}

/** "20% off at 72% GP" for the happy hour lift row. */
function happySub(sim: Sim, offerPriceInc: number | null): string | undefined {
  if (sim.discountInc == null || offerPriceInc == null || sim.regularGpPct == null) return undefined;
  const regular = offerPriceInc + sim.discountInc;
  return regular > 0 && sim.discountInc > 0 ? `${Math.round((sim.discountInc / regular) * 100)}% off at ${Math.round(sim.regularGpPct * 100)}% GP` : undefined;
}

function Results({ sim, kind, offerPriceInc, share, hasBaseline, goalSet, table }: { sim: Sim; kind: OfferKind; offerPriceInc: number | null; share: number; hasBaseline: boolean; goalSet: boolean; table: ReturnType<typeof sensitivity> }) {
  const be = sim.breakEven;
  const beMain =
    be.status === "never" ? "Never" : be.status === "none_needed" ? "None needed" : be.status === "unknown" ? "—" : be.extraUnitsPerWeek != null ? `${be.extraUnitsPerWeek} extra a week` : `+${Math.round((be.upliftPct ?? 0) * 100)}% sales`;
  const beSub = be.status === "needed" ? (be.extraUnitsPerWeek != null ? `${be.offerUnitsPerWeek} offer sales in all · +${Math.round((be.upliftPct ?? 0) * 100)}%` : "Add usual sales for a count") : undefined;
  const goal = needText(sim.goal);
  const net = sim.netPerWeek;
  const giveaway = sim.giveawayPerSwitch;

  return (
    <div>
      <section className="rounded-2xl bg-surface px-4 py-4" aria-label="Sales needed results">
        <p className="eyebrow text-[12px] text-label-2">Before You Commit</p>
        <p className="mt-1 text-[22px] font-semibold leading-snug" aria-live="polite">
          {verdict(sim)}
        </p>
        <dl className="mt-3 divide-y divide-[color:var(--separator)] text-[17px] sm:text-[15px]">
          <ResultLine label="Profit Per Offer Sold" value={money(sim.offerGpPerSale)} sub={`${gp(sim.offerGpPct)} GP ex GST`} tone={sim.offerGpPerSale != null && sim.offerGpPerSale <= 0 ? "danger" : undefined} />
          <ResultLine label="Giveaway Per Regular Buyer" value={giveaway == null ? "—" : giveaway > 0 ? money(giveaway) : "None"} sub={giveaway != null && giveaway > 0 ? "Profit lost when they switch" : undefined} />
          <ResultLine label="Break-Even Sales Per Week" value={beMain} sub={beSub} tone={be.status === "never" ? "danger" : undefined} />
          {kind === "happy_hour" ? <ResultLine label="Lift If Everyone Switches" value={sim.fullSwitchUplift != null ? `+${Math.round(sim.fullSwitchUplift * 100)}% sales` : "—"} sub={happySub(sim, offerPriceInc)} /> : null}
          <ResultLine
            label="Takings Needed Per Week"
            value={be.takingsIncPerWeek != null ? money(be.takingsIncPerWeek, 0) : "—"}
            sub={be.takingsIncPerWeek != null ? `${money(be.takingsExPerWeek, 0)} ex GST${sim.weeks > 1 ? ` · ${money(sim.takingsNeededTotal, 0)} over ${sim.weeks} weeks` : ""}` : hasBaseline ? undefined : "Add usual sales per week"}
          />
          {goalSet ? <ResultLine label="Sales For Your Goal" value={goal.main} sub={goal.sub} tone={sim.goal ? undefined : "danger"} /> : null}
          <ResultLine
            label="Net Profit Change At Your Sales"
            value={net == null ? "—" : `${signed(net)} a week`}
            sub={net == null ? "Add expected sales" : sim.weeks > 1 && sim.netTotal != null ? `${signed(sim.netTotal)} over ${sim.weeks} weeks` : undefined}
            tone={net == null ? undefined : net >= 0 ? "good" : "danger"}
          />
        </dl>
      </section>

      {table ? (
        <section className="mt-4 rounded-2xl bg-surface px-4 py-4" aria-label="What if sensitivity">
          <p className="section-label !px-0">If More Regulars Switch</p>
          <p className="mt-0.5 text-[13px] text-label-2">Net profit change a week, by offer sales a week</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[280px] border-separate border-spacing-1 text-[13px] tnum">
              <thead>
                <tr className="text-label-2">
                  <th scope="col" className="w-[68px] py-1 text-left font-medium">
                    Switch
                  </th>
                  {table.volumes.map((v) => (
                    <th key={v} scope="col" className="py-1 text-right font-medium">
                      {v}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r) => (
                  <tr key={r.share}>
                    <th scope="row" className={cx("py-2 text-left", Math.round(r.share * 100) === share ? "font-semibold text-label" : "font-medium text-label-2")}>
                      {Math.round(r.share * 100)}%
                    </th>
                    {r.net.map((n, k) => (
                      <td key={table.volumes[k]} className={cx("rounded-lg px-1.5 py-2 text-right font-medium", n >= 0 ? "bg-good-soft text-good" : "bg-danger-soft text-danger")}>
                        {signed(n)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
