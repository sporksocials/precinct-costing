/**
 * Browser side of the smart allergen suggestions: asks /api/allergen-assist and, whenever that is not available (offline,
 * signed out, a server error, a reply that does not check out), runs the keyword check right here. It never throws, and
 * it only proposes: ticking anything is up to the person.
 */
import { isAllergenId, isAnimalFlag, type AllergenId, type AnimalFlag } from "./allergens";
import {
  BATCH_MAX,
  builtinItems,
  isValidReason,
  timeoutFor,
  type AllergenAssistItem,
  type AllergenAssistResult,
  type AssistIngredient,
} from "./allergen-assist";

/** The answer in the shape the screens use, or null when it does not line up with what was asked. */
function okItems(items: unknown, asked: readonly AssistIngredient[]): AllergenAssistItem[] | null {
  if (!Array.isArray(items) || items.length !== asked.length) return null;
  const byKey = new Map<string, AllergenAssistItem>();
  for (const it of items as Record<string, unknown>[]) {
    if (!it || typeof it.key !== "string" || byKey.has(it.key) || !Array.isArray(it.allergens) || !Array.isArray(it.diet)) return null;
    const allergens = it.allergens as Record<string, unknown>[];
    const diet = it.diet as Record<string, unknown>[];
    if (allergens.some((a) => !a || typeof a.id !== "string" || !isAllergenId(a.id) || !isValidReason(a.reason))) return null;
    if (diet.some((d) => !d || typeof d.flag !== "string" || !isAnimalFlag(d.flag) || !isValidReason(d.reason))) return null;
    if (new Set(allergens.map((a) => a.id)).size !== allergens.length || new Set(diet.map((d) => d.flag)).size !== diet.length) return null;
    byKey.set(it.key, {
      key: it.key,
      allergens: allergens.map((a) => ({ id: a.id as AllergenId, reason: a.reason as string })),
      diet: diet.map((d) => ({ flag: d.flag as AnimalFlag, reason: d.reason as string })),
    });
  }
  const out = asked.map((a) => byKey.get(a.key));
  return out.every(Boolean) ? (out as AllergenAssistItem[]) : null;
}

/** One call, one to 20 ingredients. */
export async function requestAllergenSuggestions(ingredients: AssistIngredient[], fetchImpl: typeof fetch = fetch): Promise<AllergenAssistResult> {
  const input = { ingredients: ingredients.slice(0, BATCH_MAX) };
  try {
    const res = await fetchImpl("/api/allergen-assist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutFor(input.ingredients.length) + 4000),
    });
    if (res.ok) {
      const body = (await res.json()) as Partial<AllergenAssistResult>;
      const items = okItems(body.items, input.ingredients);
      if (items) return { items, source: body.source === "ai" ? "ai" : "builtin", fallback: typeof body.fallback === "string" ? body.fallback.slice(0, 40) : undefined };
    }
  } catch {
    // fall through to the keyword check below
  }
  return { items: builtinItems(input), source: "builtin", fallback: "unreachable" };
}

/** The most ingredients one dish helper will check in one go (three calls of 20). */
export const DISH_MAX = BATCH_MAX * 3;

/** Any number of ingredients (up to DISH_MAX), sent in calls of 20 one after another. One note covers them all: it is the smart one only if every call was. */
export async function requestAllergenSuggestionsBatched(ingredients: AssistIngredient[], fetchImpl: typeof fetch = fetch): Promise<AllergenAssistResult> {
  const asked = ingredients.slice(0, DISH_MAX);
  const parts: AllergenAssistResult[] = [];
  for (let i = 0; i < asked.length; i += BATCH_MAX) parts.push(await requestAllergenSuggestions(asked.slice(i, i + BATCH_MAX), fetchImpl));
  const builtin = parts.find((p) => p.source === "builtin");
  return {
    items: parts.flatMap((p) => p.items),
    source: builtin ? "builtin" : "ai",
    fallback: builtin?.fallback,
  };
}
