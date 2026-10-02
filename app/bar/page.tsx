import Link from "next/link";
import { PrecinctMark, VenueLogo } from "@/components/brand";
import { BAR_VENUES } from "@/lib/bar";
import { fetchBarMenu } from "@/lib/bar-server";

export const dynamic = "force-dynamic";

const NAMES: Record<string, string> = { drift: "Drift Bar", chiobu: "Chiobu", greedy: "Greedy Gringo's" };

/** The iPad's start screen: pick which bar this station is for. */
export default async function BarSelectPage() {
  const counts = await Promise.all(
    BAR_VENUES.map(async (slug) => {
      try {
        const m = await fetchBarMenu(slug);
        return m ? m.items.length : null;
      } catch {
        return null;
      }
    }),
  );

  return (
    <main className="bar-root min-h-[100dvh] w-full bg-[#0E0E10] text-[#F5F3EE]">
      <div className="mx-auto w-full max-w-[1000px] px-6 pb-10 pt-[calc(28px+env(safe-area-inset-top))]">
        <PrecinctMark size="sm" />
        <h1 className="mt-4 font-display text-[48px] leading-none tracking-[1px]">COCKTAIL STATION</h1>
        <p className="mt-3 text-[19px] text-[#9B9890]">Which bar are you working at?</p>

        <ul className="mt-8 grid gap-[14px]">
          {BAR_VENUES.map((slug, i) => {
            const n = counts[i];
            return (
              <li key={slug}>
                <Link
                  href={`/bar/${slug}`}
                  className={`bar-${slug} relative flex min-h-[200px] items-end justify-between gap-6 overflow-hidden rounded-2xl border-[0.5px] border-white/[0.08] bg-[#1C1C1F] px-7 pb-7 pt-10 transition-transform duration-150 active:scale-[0.99] active:bg-[#232327]`}
                >
                  <span aria-hidden className="absolute inset-x-0 top-0 h-[6px] bg-[color:var(--bar-accent)]" />
                  <span className="min-w-0">
                    <VenueLogo slug={slug} height={32} className="mb-3" />
                    <span className="block font-display text-[64px] uppercase leading-[0.95] tracking-[1px] text-[color:var(--bar-text)]">{NAMES[slug]}</span>
                    <span className="mt-2 block text-[19px] text-[#9B9890]">{n == null ? "Cocktail Station" : n === 0 ? "No cocktails added yet" : `${n} ${n === 1 ? "cocktail" : "cocktails"}`}</span>
                  </span>
                  <span aria-hidden className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[color:var(--bar-accent)] text-[34px] font-bold leading-none text-[color:var(--bar-on)]">
                    &#8594;
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
