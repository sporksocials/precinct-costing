import { unitBase } from "./costing";
import type { LineUnit, PackUnit } from "./types";

/**
 * Smart "add ingredient" input parsing, modelled on meez-style intelligent text entry.
 *
 *   "180g chicken thigh" → { qty: 180, unit: "g", query: "chicken thigh" }
 *   "chicken 180 g"      → { qty: 180, unit: "g", query: "chicken" }
 *   "2 eggs"             → { qty: 2, unit: null, query: "eggs" }
 *   "2 x egg"            → { qty: 2, unit: "each", query: "egg" }
 *   "1/2 lime", "½ lime" → { qty: 0.5, unit: null, query: "lime" }
 *   "30ml gin"           → { qty: 30, unit: "ml", query: "gin" }
 *   "0.2 kg"             → { qty: 0.2, unit: "kg", query: "" }
 */
export interface ParsedLineInput {
  qty: number | null;
  unit: LineUnit | null;
  query: string;
}

const UNIT_WORDS: Record<string, LineUnit> = {
  g: "g",
  gm: "g",
  gms: "g",
  gr: "g",
  gram: "g",
  grams: "g",
  kg: "kg",
  kgs: "kg",
  kilo: "kg",
  kilos: "kg",
  ml: "ml",
  mls: "ml",
  l: "L",
  lt: "L",
  ltr: "L",
  litre: "L",
  litres: "L",
  liter: "L",
  liters: "L",
  each: "each",
  ea: "each",
  x: "each",
  pc: "each",
  pcs: "each",
  piece: "each",
  pieces: "each",
};

const VULGAR: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };

// a number: "180", "0.2", "0,5", "1/2", "1 1/2", "½", "1½"
const NUM = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d*[.,]?\d+[½¼¾⅓⅔⅛]?|[½¼¾⅓⅔⅛])`;
const UNIT = String.raw`(?:grams|gram|gms|gm|gr|g|kilos|kilo|kgs|kg|mls|ml|litres|litre|liters|liter|ltr|lt|l|each|ea|pieces|piece|pcs|pc|x)`;

const LEADING = new RegExp(String.raw`^(${NUM})\s*(${UNIT})?(?=\s|$)\s*(?:x\s+)?(?:of\s+)?(.*)$`, "i");
const TRAILING = new RegExp(String.raw`^(.*?)\s+(?:x\s*)?(${NUM})\s*(${UNIT})?$`, "i");

export function parseNumberToken(raw: string): number | null {
  const s = raw.trim().replace(",", ".");
  if (!s) return null;
  if (VULGAR[s] != null) return VULGAR[s];
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[2]) === 0 ? null : Number(frac[1]) / Number(frac[2]);
  const withVulgar = s.match(/^(\d*\.?\d+)([½¼¾⅓⅔⅛])$/);
  if (withVulgar) return Number(withVulgar[1]) + VULGAR[withVulgar[2]];
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function unitFromWord(w: string | undefined): LineUnit | null {
  if (!w) return null;
  return UNIT_WORDS[w.toLowerCase()] ?? null;
}

export function parseLineInput(input: string): ParsedLineInput {
  const text = input.trim().replace(/\s+/g, " ");
  if (!text) return { qty: null, unit: null, query: "" };

  const lead = text.match(LEADING);
  if (lead) {
    const qty = parseNumberToken(lead[1]);
    if (qty != null) {
      let unit = unitFromWord(lead[2]);
      let rest = (lead[3] ?? "").trim();
      // "2 x egg": the x has been consumed as the unit → each
      if (!unit && /^x\s+/i.test(rest)) {
        unit = "each";
        rest = rest.replace(/^x\s+/i, "");
      }
      return { qty, unit, query: rest };
    }
  }

  const trail = text.match(TRAILING);
  if (trail && trail[1].trim()) {
    const qty = parseNumberToken(trail[2]);
    if (qty != null) {
      return { qty, unit: unitFromWord(trail[3]), query: trail[1].trim() };
    }
  }

  return { qty: null, unit: null, query: text };
}

/** Default line unit for something bought / yielded in `base`. */
export function defaultLineUnit(base: PackUnit): LineUnit {
  return base === "kg" ? "g" : base === "L" ? "ml" : "each";
}

export interface ResolvedUnit {
  unit: LineUnit;
  /** true when the typed unit could not be used (family mismatch) and a default was substituted */
  adjusted: boolean;
}

/**
 * Pick the line unit for a component. No unit typed → sensible default for the pack unit.
 * A typed unit in the wrong family (e.g. "180g" of something bought per each) → default + adjusted flag.
 */
export function resolveLineUnit(typed: LineUnit | null, base: PackUnit): ResolvedUnit {
  if (!typed) return { unit: defaultLineUnit(base), adjusted: false };
  if (unitBase(typed) === base) return { unit: typed, adjusted: false };
  return { unit: defaultLineUnit(base), adjusted: true };
}

/** Human quantity: 180 g, 0.5 each, 1.25 L */
export function formatQty(qty: number, unit: LineUnit): string {
  let n = Number(qty) || 0;
  // show small metric amounts the way a chef reads them: 0.18 kg → 180 g, 0.06 L → 60 ml
  if (unit === "kg" && n > 0 && n < 1) return formatQty(Math.round(n * 1000 * 1000) / 1000, "g");
  if (unit === "L" && n > 0 && n < 1) return formatQty(Math.round(n * 1000 * 1000) / 1000, "ml");
  n = Math.round(n * 1000) / 1000;
  const s = n.toLocaleString("en-AU", { maximumFractionDigits: 3 });
  return unit === "each" ? `${s} ea` : `${s} ${unit}`;
}

/** Tidy an ALL-CAPS supplier description into Title Case ("CHICKEN THIGH FILLET S/L" → "Chicken Thigh Fillet S/L"). */
export function titleCase(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) => {
      if (/^[a-z]\/[a-z]$/i.test(w)) return w.toUpperCase(); // S/L, B/L
      if (/^\d/.test(w)) return w.replace(/(\d)(kg|g|ml|l|ea)\b/g, (_m, d: string, u: string) => `${d}${u === "l" ? "L" : u}`);
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
}
