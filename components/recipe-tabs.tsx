"use client";

import { useRouter } from "next/navigation";
import { Segmented } from "./ui";
import { useVenue } from "./venue";

export type RecipeTab = "items" | "preps" | "beers";

/** Menu Items / Preps / Beers: one section, three views. Beers is its own page; the venue filter travels with you. */
export function RecipeTabs({ current, className }: { current: RecipeTab; className?: string }) {
  const router = useRouter();
  const { slug } = useVenue();
  const go = (t: RecipeTab) => {
    if (t === current) return;
    const p = new URLSearchParams();
    if (t === "preps") p.set("type", "preps");
    if (slug !== "all") p.set("venue", slug);
    const q = p.toString();
    router.replace(`${t === "beers" ? "/beers" : "/recipes"}${q ? `?${q}` : ""}`, { scroll: false });
  };
  return (
    <Segmented
      ariaLabel="Recipe type"
      className={className}
      value={current}
      onChange={go}
      options={[
        { value: "items", label: "Menu Items" },
        { value: "preps", label: "Preps" },
        { value: "beers", label: "Beers" },
      ]}
    />
  );
}
