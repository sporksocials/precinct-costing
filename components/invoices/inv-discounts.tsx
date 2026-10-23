"use client";

import Link from "next/link";
import { AlertTriangle, Check, Eye, Plus } from "lucide-react";
import { useStore } from "@/lib/store";
import { Empty, ListSkeleton } from "@/components/ui";
import { TouchLink } from "@/components/ordering/touch";
import {
  dealPrefillHref,
  dealPrefillPct,
  groupSizeText,
  netText,
  seenText,
  STATUS_WORD,
  steadierText,
  type DiscountGroup,
  type DiscountStatus,
} from "@/lib/invoice-discounts";
import { shortDate } from "@/lib/invoice-questions-view";
import { cx } from "@/components/ui";
import { useDiscountGroups } from "./use-discounts";

const STATUS_ICON: Record<DiscountStatus, typeof Check> = { standing: Check, "seen once": Eye, varies: AlertTriangle };

/** The status as icon plus word. Neutral text; only "Varies" uses the existing amber, because that one is worth a second look. */
export function DiscountStatusLabel({ status, className }: { status: DiscountStatus; className?: string }) {
  const Icon = STATUS_ICON[status];
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-[15px] font-medium sm:text-[13px]", status === "varies" ? "text-warn" : "text-label-2", className)}>
      <Icon aria-hidden className="h-4 w-4 shrink-0" strokeWidth={2.5} />
      <span>{STATUS_WORD[status]}</span>
    </span>
  );
}

/** Discounts We Found: the standing discounts suppliers take off a product, found on negative invoice lines. Read only. */
export function DiscountsView({ venueId }: { venueId: number | null }) {
  const { groups, available, loading } = useDiscountGroups({ venueId });
  if (loading && groups.length === 0) return <ListSkeleton rows={4} />;
  if (!available)
    return <Empty title="Discounts Are Not Set Up Yet" body="Once the Invoices update is in, discounts that suppliers take off appear here." />;
  if (groups.length === 0)
    return <Empty title="No Discounts Found Yet" body="They appear when an invoice has a negative line against a product." />;
  return (
    <>
      <p className="px-1 pb-1.5 text-[13px] text-label-2">{`${groups.length} ${groups.length === 1 ? "discount" : "discounts"} found. Nothing here changes a price or a recipe cost.`}</p>
      <ul className="group-list">
        {groups.map((g) => (
          <DiscountRowItem key={g.key} g={g} />
        ))}
      </ul>
    </>
  );
}

function DiscountRowItem({ g }: { g: DiscountGroup }) {
  const { dealsByIngredient } = useStore();
  const href = g.ingredientId ? `/ingredients/${g.ingredientId}` : `/invoices/${g.latest.documentId}`;
  const net = netText(g.netPerBase, g.baseUnit);
  // which way of saying it holds still only matters for a standing discount; on one that varies it would only be noise
  const steady = g.status === "standing" ? steadierText(g) : null;
  const when = shortDate(g.latest.date);
  const hasPercentDeal = !!g.ingredientId && (dealsByIngredient.get(g.ingredientId) ?? []).some((d) => d.kind === "percent_off" && d.active);
  const canAdd = g.status === "standing" && !!g.ingredientId;
  return (
    <li>
      <Link href={href} className="flex min-h-[64px] flex-col gap-1 px-4 py-3 transition-colors active:bg-fill hover:bg-[color:var(--fill)]" aria-label={`${g.item} from ${g.supplier}: ${groupSizeText(g)}`}>
        <span className="flex flex-col gap-0.5 lg:flex-row lg:items-baseline lg:justify-between lg:gap-4">
          <span className="min-w-0">
            <span className="block text-[17px] font-semibold leading-snug">{g.item}</span>
            <span className="block text-[15px] text-label-2 sm:text-[13px]">{g.supplier}</span>
          </span>
          <span className="text-[17px] font-semibold tnum text-label lg:shrink-0 lg:text-right">{groupSizeText(g)}</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[15px] text-label-2 sm:text-[13px]">{`${seenText(g.invoiceCount)}${when ? `, latest ${when}` : ""}`}</span>
          <DiscountStatusLabel status={g.status} />
        </span>
        {steady || net ? <span className="text-[13px] text-label-2">{[steady, net].filter(Boolean).join(". ")}</span> : null}
      </Link>
      {canAdd ? (
        <div className="px-4 pb-3">
          {hasPercentDeal ? (
            <p className="text-[13px] text-label-2">A Percent Off deal is already on this ingredient.</p>
          ) : (
            <>
              <TouchLink variant="tinted" href={dealPrefillHref(g.ingredientId as string, g)} aria-label={`Add ${dealPrefillPct(g)} percent off as a standing discount on ${g.item}`}>
                <Plus aria-hidden className="h-5 w-5" strokeWidth={2.5} />
                Add As Standing Discount
              </TouchLink>
              <p className="mt-1.5 text-[13px] text-label-2">Opens the Add Deal form with {dealPrefillPct(g)}% filled in. You see which dishes change before anything saves.</p>
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}
