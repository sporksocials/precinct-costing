"use client";

import { Carrot, ClipboardList, HeartPulse, History, Lightbulb, ListChecks, Settings, ShieldCheck, Store, Tag, Trash2, Wheat } from "lucide-react";
import { useStore } from "@/lib/store";
import { useDataHealthSummary } from "@/lib/use-data-health";
import { Group, PageHeader, Row } from "@/components/ui";
import { useIngredientsToReview } from "@/components/ingredient-review/use-review-queue";

function Icon({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={`flex h-[30px] w-[30px] items-center justify-center rounded-[8px] text-white ${className}`}>{children}</span>;
}

export default function MorePage() {
  const { userEmail, signOut, researchNotes, ready } = useStore();
  const openNotes = researchNotes.filter((n) => n.status === "open").length;
  const health = useDataHealthSummary();
  const toCheck = useIngredientsToReview().length;
  const ic = "h-[18px] w-[18px]";
  return (
    <div>
      <PageHeader title="More" />
      <Group inset="3.75rem" className="mt-2">
        <Row href="/ordering" title="Ordering" leading={<Icon className="bg-[#2f5f8a]"><ClipboardList className={ic} /></Icon>} chevron />
        <Row href="/specials" title="Specials" leading={<Icon className="bg-[#7a5c2e]"><Tag className={ic} /></Icon>} chevron />
        <Row href="/allergens" title="Menu Labels" leading={<Icon className="bg-[#8a4b2a]"><Wheat className={ic} /></Icon>} chevron />
        <Row href="/matrix" title="Allergy Matrix" leading={<Icon className="bg-[#6a3a7a]"><ShieldCheck className={ic} /></Icon>} chevron />
        <Row href="/matrix/todo" title="Matrix To Do" sub="Dishes to approve, marks, sheets to reprint" leading={<Icon className="bg-[#6a3a7a]"><ListChecks className={ic} /></Icon>} chevron />
        <Row
          href="/allergens/review"
          title="Check Ingredient Allergens"
          sub="Tick each ingredient once, dishes follow"
          leading={<Icon className="bg-[#2c6b45]"><Carrot className={ic} /></Icon>}
          trailing={ready ? <span className={toCheck ? "text-warn" : "text-good"}>{toCheck ? `${toCheck} to check` : "All checked"}</span> : undefined}
          chevron
        />
        <Row
          href="/research-notes"
          title="Research Notes"
          leading={<Icon className="bg-[#1f6f7a]"><Lightbulb className={ic} /></Icon>}
          trailing={ready ? <span className={openNotes ? "text-label" : "text-label-2"}>{openNotes ? `${openNotes} open` : "None open"}</span> : undefined}
          chevron
        />
        <Row href="/portal-prices" title="Supplier Prices" leading={<Icon className="bg-[#0A3848]"><Store className={ic} /></Icon>} chevron />
        <Row
          href="/data-health"
          title="Data Health"
          leading={<Icon className="bg-[#2c6b45]"><HeartPulse className={ic} /></Icon>}
          trailing={health.ready ? <span className={health.errors ? "text-danger" : health.attention ? "text-warn" : "text-good"}>{health.attention ? `${health.attention} to check` : "All clear"}</span> : undefined}
          chevron
        />
        <Row href="/change-log" title="Change Log" leading={<Icon className="bg-[#5a4a8a]"><History className={ic} /></Icon>} chevron />
        <Row href="/trash" title="Trash" leading={<Icon className="bg-[#8a3a3a]"><Trash2 className={ic} /></Icon>} chevron />
        <Row href="/settings" title="Settings" leading={<Icon className="bg-[#3a3a3f]"><Settings className={ic} /></Icon>} chevron />
      </Group>
      <Group title="Signed In As">
        <Row title={userEmail ?? "—"} />
        <Row onClick={() => void signOut()} title={<span className="text-danger">Sign Out</span>} />
      </Group>
    </div>
  );
}
