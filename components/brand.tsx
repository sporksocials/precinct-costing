const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

/** Real venue logos (from each venue's Brand Guide/Logos folder), recoloured for the dark precinct surface. */
const LOGOS: Record<string, { src: string; alt: string; ratio: number; optical: number }> = {
  drift: { src: "/brand/drift.svg", alt: "Drift Coffee Bistro Bar", ratio: 1.2, optical: 1.35 },
  chiobu: { src: "/brand/chiobu.svg", alt: "Chiobu", ratio: 2.2, optical: 1.05 },
  greedy: { src: "/brand/greedy.svg", alt: "Greedy Gringo", ratio: 2.74, optical: 0.9 },
  gelato: { src: "/brand/gelato.svg", alt: "Gelato Rumba", ratio: 2.2, optical: 1.05 },
};

export function hasLogo(slug?: string | null): boolean {
  return !!slug && slug in LOGOS;
}

/**
 * A venue logo at a given optical height (px). Squarer marks (Drift's anchor) are drawn a little
 * taller so the four read as the same size side by side.
 */
export function VenueLogo({ slug, height = 40, className }: { slug: string; height?: number; className?: string }) {
  const l = LOGOS[slug];
  if (!l) return null;
  const h = Math.round(height * l.optical);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={l.src} alt={l.alt} height={h} width={Math.round(h * l.ratio)} className={cx("block max-w-full object-contain object-left", className)} style={{ height: h, width: "auto" }} draggable={false} />
  );
}

/** Caloundra Food Precinct logo (the stacked wordmark), with the four venue colours as a strip. */
export function PrecinctMark({ size = "md", sub, className }: { size?: "sm" | "md" | "lg"; sub?: string; className?: string }) {
  const w = size === "lg" ? "w-[132px]" : size === "md" ? "w-[96px]" : "w-[72px]";
  const eyebrow = size === "lg" ? "text-[13px]" : "text-[11px]";
  return (
    <div className={cx("inline-flex flex-col", w, className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/precinct.png" alt="Caloundra Food Precinct" width={900} height={853} className="block h-auto w-full select-none" draggable={false} />
      <span aria-hidden className={cx("precinct-strip mt-2 block rounded-full", size === "sm" ? "h-[3px]" : "h-1")} />
      {sub ? <span className={cx("eyebrow mt-2 text-label-2", eyebrow)}>{sub}</span> : null}
    </div>
  );
}
