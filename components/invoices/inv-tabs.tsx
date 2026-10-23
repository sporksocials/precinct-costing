"use client";

import Link from "next/link";
import { cx } from "@/components/ui";

/**
 * "Supplier Prices | Invoices": the two halves of one area (Troy, 24 Oct 2026), shown at the top of both screens. Links, not state,
 * so each tab has its own address and the browser's Back button works. 44px at every width.
 */
export function InvoiceTabs({ active }: { active: "prices" | "invoices" }) {
  const tabs = [
    { id: "prices", label: "Supplier Prices", href: "/portal-prices" },
    { id: "invoices", label: "Invoices", href: "/invoices" },
  ] as const;
  return (
    <nav aria-label="Supplier prices and invoices" className="mb-3 flex gap-[2px] rounded-[12px] bg-fill p-[2px] sm:max-w-sm">
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <Link
            key={t.id}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={cx(
              "flex min-h-[44px] flex-1 items-center justify-center whitespace-nowrap rounded-[10px] px-3 text-[15px] font-medium transition-[background-color,box-shadow,color] duration-200 ease-ios",
              on ? "bg-elevated text-label shadow-[0_1px_3px_rgba(0,0,0,0.35),0_0_0_0.5px_rgba(255,255,255,0.04)]" : "text-label-2 hover:text-label",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
