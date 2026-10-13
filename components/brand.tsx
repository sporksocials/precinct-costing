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

/**
 * The small venue emblem for beside a venue's name (Troy, 13 Oct 2026: "little logos next to these names throughout the app").
 * Each is cropped from the venue's own logo (public/brand/mark-<slug>.svg, the same artwork with a tighter viewBox): Drift's
 * anchor, Chiobu's C, Greedy Gringo's sombrero skull, Gelato Rumba's pink scoop. Decorative (the name always sits beside it), so
 * it is hidden from screen readers. Two looks:
 *  - "colour" (default): the venue's own colours, for the dark surface.
 *  - "ink": a one colour silhouette in the surrounding text colour, for places that change colour with state (the selected venue
 *    tile fills with the venue accent, a selected segment) where a cream or red emblem would vanish.
 * An unknown slug, or "all", draws nothing, so callers never need to check.
 */
const MARKS: Record<string, { src: string; optical: number }> = {
  drift: { src: "/brand/mark-drift.svg", optical: 1 },
  chiobu: { src: "/brand/mark-chiobu.svg", optical: 1.12 },
  greedy: { src: "/brand/mark-greedy.svg", optical: 1.08 },
  gelato: { src: "/brand/mark-gelato.svg", optical: 0.95 },
};

export function hasMark(slug?: string | null): boolean {
  return !!slug && slug in MARKS;
}

export function VenueMark({ slug, size = 20, tone = "colour", className }: { slug?: string | null; size?: number; tone?: "colour" | "ink"; className?: string }) {
  const m = slug ? MARKS[slug] : undefined;
  if (!m) return null;
  const inner = Math.round(size * m.optical);
  return (
    <span aria-hidden className={cx("inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }}>
      {tone === "ink" ? (
        <span
          className="block bg-current"
          style={{
            width: inner,
            height: inner,
            WebkitMaskImage: `url(${m.src})`,
            maskImage: `url(${m.src})`,
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskPosition: "center",
            WebkitMaskSize: "contain",
            maskSize: "contain",
          }}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.src} alt="" width={inner} height={inner} className="block object-contain" style={{ width: inner, height: inner }} draggable={false} />
      )}
    </span>
  );
}

/** The emblem and the venue's name side by side, for a line of text that names a venue. */
export function VenueTag({ slug, name, size = 16, tone = "colour", className }: { slug?: string | null; name: string; size?: number; tone?: "colour" | "ink"; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 align-middle", className)}>
      <VenueMark slug={slug} size={size} tone={tone} />
      <span>{name}</span>
    </span>
  );
}
