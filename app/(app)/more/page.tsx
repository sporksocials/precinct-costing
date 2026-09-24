"use client";

import { Bell, IceCreamCone, Settings, Sparkles, Store } from "lucide-react";
import { useStore } from "@/lib/store";
import { Group, PageHeader, Row } from "@/components/ui";

function Icon({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={`flex h-[30px] w-[30px] items-center justify-center rounded-[8px] text-white ${className}`}>{children}</span>;
}

export default function MorePage() {
  const { userEmail, signOut } = useStore();
  const ic = "h-[18px] w-[18px]";
  return (
    <div>
      <PageHeader title="More" />
      <Group inset="3.75rem" className="mt-2">
        <Row href="/gelato" title="Gelato" leading={<Icon className="bg-[#c05a9f]"><IceCreamCone className={ic} /></Icon>} chevron />
        <Row href="/alerts" title="Alerts" leading={<Icon className="bg-[#C6102E]"><Bell className={ic} /></Icon>} chevron />
        <Row href="/specials" title="Specials" leading={<Icon className="bg-[#F26345]"><Sparkles className={ic} /></Icon>} chevron />
        <Row href="/portal-prices" title="Supplier prices" leading={<Icon className="bg-[#0A3848]"><Store className={ic} /></Icon>} chevron />
        <Row href="/settings" title="Settings" leading={<Icon className="bg-[#3a3a3f]"><Settings className={ic} /></Icon>} chevron />
      </Group>
      <Group title="Signed in as">
        <Row title={userEmail ?? "—"} />
        <Row onClick={() => void signOut()} title={<span className="text-danger">Sign out</span>} />
      </Group>
    </div>
  );
}
