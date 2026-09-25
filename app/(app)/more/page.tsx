"use client";

import { HeartPulse, History, Settings, Store, Tag, Wheat } from "lucide-react";
import { useStore } from "@/lib/store";
import { useDataHealthSummary } from "@/lib/use-data-health";
import { Group, PageHeader, Row } from "@/components/ui";

function Icon({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={`flex h-[30px] w-[30px] items-center justify-center rounded-[8px] text-white ${className}`}>{children}</span>;
}

export default function MorePage() {
  const { userEmail, signOut } = useStore();
  const health = useDataHealthSummary();
  const ic = "h-[18px] w-[18px]";
  return (
    <div>
      <PageHeader title="More" />
      <Group inset="3.75rem" className="mt-2">
        <Row href="/specials" title="Specials" leading={<Icon className="bg-[#7a5c2e]"><Tag className={ic} /></Icon>} chevron />
        <Row href="/allergens" title="Allergy Matrix" leading={<Icon className="bg-[#8a4b2a]"><Wheat className={ic} /></Icon>} chevron />
        <Row href="/portal-prices" title="Supplier Prices" leading={<Icon className="bg-[#0A3848]"><Store className={ic} /></Icon>} chevron />
        <Row
          href="/data-health"
          title="Data Health"
          leading={<Icon className="bg-[#2c6b45]"><HeartPulse className={ic} /></Icon>}
          trailing={health.ready ? <span className={health.errors ? "text-danger" : health.attention ? "text-warn" : "text-good"}>{health.attention ? `${health.attention} to check` : "All clear"}</span> : undefined}
          chevron
        />
        <Row href="/change-log" title="Change Log" leading={<Icon className="bg-[#5a4a8a]"><History className={ic} /></Icon>} chevron />
        <Row href="/settings" title="Settings" leading={<Icon className="bg-[#3a3a3f]"><Settings className={ic} /></Icon>} chevron />
      </Group>
      <Group title="Signed In As">
        <Row title={userEmail ?? "—"} />
        <Row onClick={() => void signOut()} title={<span className="text-danger">Sign Out</span>} />
      </Group>
    </div>
  );
}
