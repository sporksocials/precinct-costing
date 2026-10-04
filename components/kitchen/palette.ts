import type { CSSProperties } from "react";

/**
 * Colours of the kitchen allergen and dietary badges. Kept in one plain module so tests/kitchen.test.ts can check every
 * text and background pair against WCAG AA (4.5:1 for text, 3:1 for the outline). Colour only backs up what each badge says
 * in words and shape: solid red + octagon = contains, hatched amber + triangle = not reviewed, dashed = unconfirmed,
 * quiet outline = sensitivity or attribute, solid green + tick = confirmed, hatched grey = not confirmed, outlined + swap = option.
 */
export interface Tone {
  /** text and icon */
  fg: string;
  /** fill (the lighter stripe of a hatched badge) */
  bg: string;
  /** outline */
  edge?: string;
  /** darker stripe of a hatched badge */
  stripe?: string;
}

/** the kitchen's card colour, which the quiet badges sit directly on */
export const CARD_BG = "#1C1C1F";

export const KB = {
  /** a confirmed main allergen: solid, hard-edged, the loudest thing on the screen */
  contains: { fg: "#2A0509", bg: "#FF8A96", edge: "#FFC2C8" },
  /** a recipe with an unreviewed ingredient: hatched amber */
  notReviewed: { fg: "#F7D48C", bg: "#2B2210", stripe: "#4A3710", edge: "#F2C46D" },
  /** a keyword guess on an unreviewed ingredient: dashed amber outline */
  may: { fg: "#F2C46D", bg: "#2B2210", edge: "#F2C46D" },
  /** sulphites and alcohol: quiet outlined pills */
  quiet: { fg: "#D0CCC2", bg: CARD_BG, edge: "#8E8C85" },
  /** a confirmed diet badge: solid green */
  is: { fg: "#06240F", bg: "#8FD9A4", edge: "#8FD9A4" },
  /** diet not confirmed: hatched grey, one line */
  notConfirmed: { fg: "#D9D5CB", bg: CARD_BG, stripe: "#303036", edge: "#8E8C85" },
  /** a dietary option: outlined in the precinct sand, never filled */
  option: { fg: "#EBD9B8", bg: CARD_BG, edge: "#D9C3A0" },
  /** the seafood origin letter disc */
  seafood: { fg: "#20191A", bg: "#D9C3A0", edge: "#D9C3A0" },
} satisfies Record<string, Tone>;

/** Inline style for a badge in this tone (hatched when it has a stripe). */
export function toneStyle(t: Tone, opts: { dashed?: boolean } = {}): CSSProperties {
  return {
    color: t.fg,
    backgroundColor: t.bg,
    backgroundImage: t.stripe ? `repeating-linear-gradient(135deg, ${t.stripe} 0 8px, ${t.bg} 8px 16px)` : undefined,
    borderColor: t.edge ?? t.bg,
    borderStyle: opts.dashed ? "dashed" : "solid",
  };
}
