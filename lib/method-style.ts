/**
 * The built-in method step tidy: turns a typed or suggested step into the house style and picks where it belongs.
 * Pure and deterministic (no network, no clock), so it is also the fallback when the smart tidy is unavailable.
 *
 * House style (the same rules the smart tidy is given, see lib/method-assist.ts):
 *   one short imperative sentence, sentence case, Australian English, no full stop at the end unless the step has two
 *   sentences, no em or en dashes, amounts as numerals with units (30 ml, 12 seconds), the bar verbs this menu uses.
 *
 * Steps are placed by the usual order of a drink: glass prep (chill, rim), ingredients, shake or stir or blend,
 * strain or dump, top and fill, garnish last.
 */

export type MethodOp = { op: "insert"; index: number; text: string } | { op: "replace"; index: number; text: string };

export interface TidyLine {
  name: string;
  qty?: number;
  unit?: string;
}

export interface TidyInput {
  itemName: string;
  category: string;
  glass: string;
  lines: TidyLine[];
  method: string[];
  mode: "step" | "answer";
  text: string;
  replaces?: string;
  noteTitle?: string;
}

export interface TidyResult {
  ops: MethodOp[];
  source: "ai" | "builtin";
  /** Why the built-in tidy answered instead of the smart one (no_key, timeout, network, credits, http_<status>, bad_reply, unreachable). Never holds the key. */
  fallback?: string;
}

/**
 * Plain words for why Smart Tidy did not answer; every smart helper's note shares it. Empty when the reason is unknown.
 * `unreachable` is worded by the caller, since it names the thing that could not be reached.
 */
export function smartTidyWhy(fallback: string | undefined, unreachable: string): string {
  const f = fallback ?? "";
  return f === "no_key" ? "Smart Tidy is not switched on: the server has no key."
    : f === "credits" ? "Smart Tidy could not run: the account has no credit left."
    : f === "http_401" || f === "http_403" ? "Smart Tidy could not run: the key was refused."
    : f === "timeout" ? "Smart Tidy took too long."
    : f === "network" ? "Smart Tidy could not be reached."
    : f.startsWith("bad_reply") ? `Smart Tidy gave a reply that did not pass the checks (${f.slice(10).replace(/^_/, "") || "format"}).`
    : f === "unreachable" ? unreachable
    : f.startsWith("http_") ? `Smart Tidy could not run (error ${f.slice(5)}).`
    : "";
}

/** Plain words for a manager under the preview: which tidy wrote the step, and why not the smart one. */
export function tidyNote(r: Pick<TidyResult, "source" | "fallback">): string {
  if (r.source === "ai") return "Wording by Smart Tidy.";
  const why = smartTidyWhy(r.fallback, "The tidy service could not be reached, so this page did it.");
  return why ? `Wording by Built-In Tidy. ${why}` : "Wording by Built-In Tidy.";
}

/** The typed text cannot be turned into a step (empty, a link, too long to be one step). */
export class TidyError extends Error {}

export const STEP_MIN = 3;
export const STEP_MAX = 140;

// ---------------------------------------------------------------- vocabulary

/** Method and drink words used on this menu. Spelling is corrected towards these (plus the recipe's own words). */
const BAR_WORDS = `
add adding build built blend blended blender chill chilled clap crush crushed dump dumped dry fill filled fine double strain strained
float floated garnish garnished glass glasses jar tin shaker shaken shake shaking stir stirred stirring strainer top topped pour poured
press pressed muddle muddled rim rimmed wet wetted coat dip dipped salt salted sugar cinnamon coconut ice cubes cube freezer frost frosted
hard gently slowly side tall short coupe martini margarita rocks highball poco wine flute spritz sour fizz mojito daiquiri
seconds second minutes minute shots shot dash dashes drop drops splash pinch grind slice slices wedge wedges wheel wheels sprig leaf leaves
twist peel zest express spray rinse swirl layer drizzle spoon serve served finish line half third quarter three over into onto through
vodka gin rum tequila whisky whiskey bourbon brandy mezcal prosecco champagne wine beer cider vermouth bitters liqueur syrup agave honey
juice lime lemon orange grapefruit passionfruit pineapple apple cranberry tomato coffee espresso milk cream egg white soda tonic sprite cola
ginger mint basil chilli pepper cherry olive cucumber strawberry raspberry mango lychee peach watermelon banana berries berry
foam foamy thick smooth frozen chilled cold hot warm fresh pre mix batch bottle bottles tap keg cup kids small large
until then once twice again first last each every well fully lightly quickly evenly together apart aside stop start low high speed
shake tin cocktail mocktail drink drinks ingredients ingredient liquid liquids spirits spirit remaining rest
remove discard keep hold rest repeat place put cover rolled roll squeeze squeezed cut halve halved lightly gently
`
  .split(/\s+/)
  .filter(Boolean);

/** Everyday words that lose a spelling tie against a drink word ("sode" is soda, not side). */
const WEAK_WORDS = new Set(["side", "tall", "short", "line", "half", "third", "quarter", "low", "high", "cup", "kids", "small", "large", "last", "first", "each", "every", "well", "hot", "cold", "cut", "keep", "hold", "rest", "stop", "start", "speed", "apart", "aside", "peel", "spray", "leaf", "once", "twice", "again", "tin", "jar"]);

/** Short function words, so they are never "corrected" into something else. */
const COMMON_WORDS = `
a an the and or of to in on at by for with without from into onto over under through up down off out it its this that these those
then than so as is are be been was not no do does don't dont only just also too very all any both either neither more most less least
about around across along inside outside against until while when before after during both you your we our they them their
`
  .split(/\s+/)
  .filter(Boolean);

/** Words kept in capitals mid-sentence (brands and names the menu uses). */
const PROPER_WORDS = ["Aperol", "Campari", "Kraken", "Bacardi", "Patron", "Sprite", "Tabasco", "Worcestershire", "Baileys", "Kahlua", "Cointreau", "Disaronno", "Malibu", "Hendrick's", "Bulcock", "Pete's", "Fireball", "Midori", "Chambord", "Frangelico", "Angostura", "Drift", "Greedy", "Gringo's", "Chiobu", "Pimm's", "Jagermeister", "Absolut", "Smirnoff", "Hennessy", "Jameson", "Havana", "Cuervo", "Lipton", "Coke", "Pepsi", "Red Bull"].flatMap((w) => w.split(" "));

/** Bar verbs, base form. Their -s, -ing and -ed forms are generated. */
const VERBS = [
  "add", "build", "blend", "chill", "clap", "crush", "dump", "fill", "strain", "float", "garnish", "pour", "press", "muddle", "rim", "wet", "coat", "dip",
  "stir", "shake", "top", "serve", "finish", "drizzle", "spoon", "squeeze", "twist", "express", "spray", "rinse", "swirl", "layer", "drop", "place", "put",
  "cover", "roll", "cut", "slice", "halve", "discard", "remove", "mix", "combine", "use", "hold", "rest", "repeat", "salt", "sugar", "frost", "freeze", "whip",
  "sprinkle", "dust", "skewer", "spear", "balance", "pop", "light", "torch", "measure", "taste", "warm", "heat", "cool", "refresh", "shape", "scoop", "pull",
];

const IRREGULAR: Record<string, { ed: string[]; ing?: string }> = {
  shake: { ed: ["shaken", "shook"] },
  build: { ed: ["built"] },
  put: { ed: ["put"], ing: "putting" },
  wet: { ed: ["wet", "wetted"], ing: "wetting" },
  cut: { ed: ["cut"], ing: "cutting" },
  pull: { ed: ["pulled"] },
  freeze: { ed: ["frozen", "froze"] },
  hold: { ed: ["held"] },
};

const DOUBLING = new Set(["stir", "top", "rim", "drop", "pop"]);

function inflect(v: string): { s: string; ing: string; ed: string[] } {
  const irr = IRREGULAR[v];
  const endsE = v.endsWith("e");
  const s = /(?:ch|sh|ss|x|z)$/.test(v) ? `${v}es` : `${v}s`;
  const ing = irr?.ing ?? (endsE ? `${v.slice(0, -1)}ing` : DOUBLING.has(v) ? `${v}${v[v.length - 1]}ing` : `${v}ing`);
  const regular = endsE ? `${v}d` : DOUBLING.has(v) ? `${v}${v[v.length - 1]}ed` : `${v}ed`;
  return { s, ing, ed: irr ? [...irr.ed] : [regular] };
}

const PARTICIPLE_TO_VERB = new Map<string, string>();
const GERUND_TO_VERB = new Map<string, string>();
const THIRD_TO_VERB = new Map<string, string>();
for (const v of VERBS) {
  const f = inflect(v);
  for (const e of f.ed) if (!PARTICIPLE_TO_VERB.has(e) && e !== v) PARTICIPLE_TO_VERB.set(e, v);
  GERUND_TO_VERB.set(f.ing, v);
  THIRD_TO_VERB.set(f.s, v);
}
const VERB_SET = new Set(VERBS);

// ---------------------------------------------------------------- spelling

/** Optimal string alignment distance (adjacent swaps count as one edit), with an early exit above `max`. */
export function editDistance(a: string, b: string, max = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2: number[] = [];
  let prev: number[] = [];
  let cur: number[] = [];
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2.length = 0;
    prev2.push(...prev);
    prev = cur;
  }
  return prev[b.length];
}

interface Vocab {
  /** lowercase word -> weight (higher wins ties) */
  words: Map<string, number>;
  /** lowercase word -> the capitalised form to keep mid-sentence */
  proper: Map<string, string>;
}

function wordsOf(s: string): string[] {
  return s.match(/[A-Za-z][A-Za-z'’]*/g) ?? [];
}

/** The words this step may use: the menu's bar words, plus this recipe's own ingredient, glass and method words. */
export function buildVocab(input: Pick<TidyInput, "itemName" | "glass" | "lines" | "method">): Vocab {
  const words = new Map<string, number>();
  const proper = new Map<string, string>();
  const add = (w: string, weight: number) => {
    const l = w.toLowerCase().replace(/’/g, "'");
    if (l.length < 2) return;
    words.set(l, Math.max(words.get(l) ?? 0, weight));
  };
  for (const w of COMMON_WORDS) add(w, 2);
  for (const w of BAR_WORDS) add(w, WEAK_WORDS.has(w) ? 2.5 : 3);
  for (const v of VERBS) {
    const f = inflect(v);
    for (const w of [v, f.s, f.ing, ...f.ed]) add(w, 3);
  }
  for (const w of PROPER_WORDS) {
    add(w, 3);
    proper.set(w.toLowerCase(), w);
  }
  for (const l of input.lines) {
    const ws = wordsOf(l.name);
    for (const w of ws) add(w, 4);
    // a pre-mix is named after its drink ("Bulcock Banger Pre-Mix"): every word of it is a name
    if (/pre-?mix$/i.test(l.name.trim())) for (const w of ws) if (!/^pre$|^mix$/i.test(w)) proper.set(w.toLowerCase(), w[0].toUpperCase() + w.slice(1));
  }
  for (const w of wordsOf(input.itemName)) add(w, 4);
  for (const w of wordsOf(input.glass)) add(w, 4);
  for (const step of input.method) {
    const ws = wordsOf(step);
    ws.forEach((w, i) => {
      add(w, 4);
      // a word capitalised in the middle of a step is a name (Aperol, Pete's)
      if (i > 0 && /^[A-Z]/.test(w) && !/^[A-Z]+$/.test(w)) proper.set(w.toLowerCase().replace(/’/g, "'"), w);
    });
  }
  // "pre-mix" is one word on this menu
  words.set("pre-mix", 4);
  return { words, proper };
}

/** The closest vocabulary word within a small edit distance, or null (then the word is left exactly as typed). */
export function spellFix(word: string, vocab: Vocab): string | null {
  const w = word.toLowerCase().replace(/’/g, "'");
  if (w.length < 3 || vocab.words.has(w) || !/^[a-z]+$/.test(w)) return null;
  const max = w.length >= 8 ? 2 : 1;
  let best: { word: string; dist: number; weight: number; sameLen: boolean } | null = null;
  for (const [cand, weight] of vocab.words) {
    if (!/^[a-z]+$/.test(cand) || Math.abs(cand.length - w.length) > max) continue;
    if (cand.length < 3) continue;
    if (w.length <= 4 && cand[0] !== w[0]) continue; // short words: a wrong first letter is too risky to guess
    const dist = editDistance(w, cand, max);
    if (dist > max) continue;
    const sameLen = cand.length === w.length;
    const better =
      !best ||
      dist < best.dist ||
      (dist === best.dist && weight > best.weight) ||
      (dist === best.dist && weight === best.weight && sameLen && !best.sameLen) ||
      (dist === best.dist && weight === best.weight && sameLen === best.sameLen && cand < best.word);
    if (better) best = { word: cand, dist, weight, sameLen };
  }
  return best ? best.word : null;
}

// ---------------------------------------------------------------- text rules

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60 };

/** "30ml" -> "30 ml", "12secs" -> "12 seconds", "twelve seconds" -> "12 seconds", "20-30 secs" -> "20 to 30 seconds". */
export function normaliseAmounts(s: string): string {
  let t = s;
  t = t.replace(/(\d)\s*[-‐-―]\s*(\d)/g, "$1 to $2");
  t = t.replace(new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join("|")})\\s+(?=(?:ml|mls|millilit(?:re|er)s?|seconds?|secs?|minutes?|mins?|shots?|dashes|drops|grams?|g|cl|oz)\\b)`, "gi"), (_m, w: string) => `${NUMBER_WORDS[w.toLowerCase()]} `);
  t = t.replace(/(\d+(?:\.\d+)?)\s*(?:mls?|millilit(?:re|er)s?)\b/gi, "$1 ml");
  t = t.replace(/(\d+(?:\.\d+)?)\s*cls?\b/gi, "$1 cl");
  t = t.replace(/(\d+(?:\.\d+)?)\s*(?:oz|ounces?)\b/gi, "$1 oz");
  t = t.replace(/(\d+(?:\.\d+)?)\s*kgs?\b/gi, "$1 kg");
  t = t.replace(/(\d+(?:\.\d+)?)\s*(?:g|grams?)\b/gi, "$1 g");
  t = t.replace(/(\d+(?:\.\d+)?)\s*(?:secs?|seconds?|s)\b/gi, (_m, n: string) => `${n} ${Number(n) === 1 ? "second" : "seconds"}`);
  t = t.replace(/(\d+(?:\.\d+)?)\s*(?:mins?|minutes?)\b/gi, (_m, n: string) => `${n} ${Number(n) === 1 ? "minute" : "minutes"}`);
  return t;
}

/** Em and en dashes and spaced hyphens become commas; stray leading and trailing hyphens go. */
export function stripDashes(s: string): string {
  return s
    .replace(/\s*[‒-―−]\s*/g, ", ")
    .replace(/\s+-+\s+/g, ", ")
    .replace(/^[-,\s]+|[-,\s]+$/g, "")
    .replace(/,\s*,/g, ",")
    .replace(/\s+,/g, ",");
}

const FILLER =
  /^(?:please |pls |plz |then |next |now |also |and then |and |first |firstly |finally |lastly |after that |afterwards |you (?:should|must|need to|have to|can|will) |we (?:should|must|need to|can) |i (?:would|think we should|think you should) |make sure (?:that )?(?:you |to |it is |it's )?|be sure to |remember to |don'?t forget to |try to |ensure (?:that )?(?:you |to )?|it(?:'s| is) (?:best|important|better) to |it should be |it needs to be |it must be )/i;

const PASSIVE = /^(?:(?:the )?(drink|cocktail|mix|mixture|liquid|ingredients?|everything|it) )?(?:should|needs to|must|has to|have to|ought to) be /i;
const SUBJECT_PASSIVE = /^(the [a-z ]{3,20}?) (?:should|needs to|must|has to|have to|ought to) be ([a-z]+) ?(.*)$/i;

function participleToVerb(w: string): string | null {
  const l = w.toLowerCase();
  if (PARTICIPLE_TO_VERB.has(l)) return PARTICIPLE_TO_VERB.get(l)!;
  if (VERB_SET.has(l)) return l;
  return null;
}

/** Rewrites "should be strained over ice" style phrasing into a plain instruction; leaves other text alone. */
export function toImperative(text: string): string {
  let t = text.trim();
  for (let i = 0; i < 4; i++) {
    const before = t;
    t = t.replace(FILLER, "");
    if (t === before) break;
  }
  // "the glass should be chilled first" -> "Chill the glass first"
  const sp = SUBJECT_PASSIVE.exec(t);
  if (sp && !/^(the )?(drink|cocktail|mix|mixture|liquid|ingredients?|everything)$/i.test(sp[1])) {
    const v = participleToVerb(sp[2]);
    if (v) return `${v} ${sp[1]}${sp[3] ? ` ${sp[3]}` : ""}`.trim();
  }
  const pm = PASSIVE.exec(t);
  if (pm) {
    t = t.slice(pm[0].length);
    // the participle can follow a modifier: "double strained", "fine strained", "gently stirred"
    const parts = t.split(" ");
    for (let i = 0; i < Math.min(3, parts.length); i++) {
      const v = participleToVerb(parts[i]);
      if (v && (PARTICIPLE_TO_VERB.has(parts[i].toLowerCase()) || i === 0)) {
        parts[i] = v;
        break;
      }
    }
    t = parts.join(" ");
  }
  // "strained over ice" / "double strained into the glass" -> "strain over ice" / "double strain into the glass"
  {
    const parts = t.split(" ");
    const lead = ["double", "fine", "gently", "lightly", "well", "hard"];
    for (const i of lead.includes(parts[0]?.toLowerCase()) ? [0, 1] : [0]) {
      const w = parts[i]?.toLowerCase();
      if (w && PARTICIPLE_TO_VERB.has(w) && !VERB_SET.has(w)) {
        parts[i] = PARTICIPLE_TO_VERB.get(w)!;
        t = parts.join(" ");
        break;
      }
    }
  }
  // "straining over ice" / "strains over ice" -> "strain over ice"
  const first = t.split(" ")[0]?.toLowerCase() ?? "";
  const rest = t.slice(first.length);
  if (GERUND_TO_VERB.has(first)) t = `${GERUND_TO_VERB.get(first)}${rest}`;
  else if (THIRD_TO_VERB.has(first) && !VERB_SET.has(first)) t = `${THIRD_TO_VERB.get(first)}${rest}`;
  const toVerb = /^to ([a-z]+)\b/i.exec(t);
  if (toVerb && VERB_SET.has(toVerb[1].toLowerCase())) t = t.slice(3);
  return t.trim();
}

function sentenceCase(s: string, proper: Map<string, string>): string {
  // lowercase everything, restore names, then capitalise the first letter of each sentence
  const out = s.replace(/[A-Za-z][A-Za-z'’]*/g, (w) => {
    const l = w.toLowerCase().replace(/’/g, "'");
    return proper.get(l) ?? l;
  });
  // "Pre-Mix" is written with capitals on this menu ("2.5 shots of Bulcock Banger Pre-Mix")
  return out.replace(/\bpre-mix\b/gi, "Pre-Mix").replace(/(^|[.!?]\s+)([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
}

/** The house-style version of `text` for this recipe. Throws TidyError when there is nothing usable. */
export function tidyStepText(text: string, ctx: Pick<TidyInput, "itemName" | "glass" | "lines" | "method">): string {
  let t = String(text ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/https?:\/\/|www\./i.test(t)) throw new TidyError("A step cannot hold a link");
  t = t.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "").replace(/^(?:[-*•]+|\d+[.)])\s+/, "");
  t = stripDashes(t);
  t = normaliseAmounts(t);
  t = t.replace(/\b(do|does|did|is|are|was|were|has|have|had|should|would|could|can|must|wo)nt\b/gi, (_m, w: string) => (w.toLowerCase() === "wo" ? "won't" : `${w}n't`)).replace(/\bcant\b/gi, "can't");
  if (!/[A-Za-z]/.test(t)) throw new TidyError("A step needs some words");

  const vocab = buildVocab(ctx);
  // spelling: fix each word towards the menu's own words. A word capitalised mid-sentence is probably a name, so it is
  // left alone unless the whole line is Title Case or SHOUTED.
  const tokens = wordsOf(t);
  const capCount = tokens.filter((w) => w.length >= 3 && /^[A-Z]/.test(w)).length;
  const longCount = tokens.filter((w) => w.length >= 3).length;
  const titleish = longCount > 0 && capCount / longCount >= 0.6;
  const fixed = tokens.map((w, i) => {
    if (i > 0 && /^[A-Z]/.test(w) && !titleish) return w;
    return spellFix(w, vocab) ?? w;
  });
  // an unknown word typed with a capital mid-sentence is kept as typed
  tokens.forEach((w, i) => {
    if (i > 0 && /^[A-Z]/.test(w) && !titleish && !vocab.words.has(w.toLowerCase().replace(/’/g, "'"))) vocab.proper.set(w.toLowerCase().replace(/’/g, "'"), w);
  });
  let k = 0;
  t = t.replace(/[A-Za-z][A-Za-z'’]*/g, () => fixed[k++]);
  // phrasing needs lowercase to match; names are restored afterwards
  const lowered = t.replace(/[A-Za-z][A-Za-z'’]*/g, (w) => w.toLowerCase());
  const imperative = toImperative(lowered);
  t = sentenceCase(imperative, vocab.proper);

  t = t.replace(/\s+/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
  // a full stop only when the step has two sentences
  const sentences = t.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length <= 1) t = t.replace(/[.!?]+$/g, "");
  else t = sentences.map((s) => (/[.!?]$/.test(s) ? s : `${s}.`)).join(" ");
  t = t.replace(/[!?]+/g, ".").replace(/\.{2,}/g, ".");

  if (t.length > STEP_MAX) {
    const cut = t.slice(0, STEP_MAX);
    t = cut.slice(0, Math.max(cut.lastIndexOf(" "), STEP_MIN)).replace(/[\s,;:.]+$/, "");
  }
  if (t.length < STEP_MIN) throw new TidyError("A step needs a few more words");
  return t;
}

// ---------------------------------------------------------------- placement

/** Order of a drink: 0 glass prep, 1 ingredients, 2 shake or stir or blend, 3 strain or dump, 4 top and fill, 5 garnish. */
export function stageOf(step: string): number | null {
  const s = step.toLowerCase();
  const first = s.match(/[a-z']+/)?.[0] ?? "";
  const verbStage: Record<string, number> = {
    chill: 0, wet: 0, rim: 0, frost: 0, coat: 0, dip: 0, salt: 0, sugar: 0, cool: 0,
    add: 1, muddle: 1, press: 1, clap: 1, squeeze: 1, crush: 1, combine: 1, measure: 1, drop: 1, put: 1, place: 1, build: 1, pour: 1, drizzle: 1, use: 1, cut: 1, slice: 1, halve: 1,
    shake: 2, stir: 2, blend: 2, whip: 2, mix: 2, swirl: 2, dry: 2, roll: 2, torch: 2,
    strain: 3, double: 3, fine: 3, dump: 3, spoon: 3, scoop: 3,
    top: 4, fill: 4, float: 4, layer: 4,
    garnish: 5, serve: 5, finish: 5, dust: 5, sprinkle: 5, express: 5, twist: 5, skewer: 5, spear: 5, rest: 5, spray: 5, light: 5,
  };
  let stage: number | null = verbStage[first] ?? null;
  const gentle = /\b(slowly|gently)\b|\bdown the side\b|\bpoured in\b/.test(s) && !/\b(press|muddle|clap|crush)\b/.test(s);
  if (gentle && (first === "add" || first === "pour")) stage = 4;
  if (first === "pour" && /\b(top|soda|sprite|tonic|prosecco|ginger beer)\b/.test(s) && /\b(in|top)\b/.test(s) && !/\b(shaker|jar|tin)\b/.test(s) && /\b(gently|slowly|top)\b/.test(s)) stage = 4;
  if (stage == null) {
    if (/\b(garnish|serve)\b/.test(s)) stage = 5;
    else if (/\b(chill|rim)\b.*\bglass\b|\bwet\b.*\b(rim|glass)\b/.test(s)) stage = 0;
    else if (/\b(strain|dump)\b/.test(s)) stage = 3;
    else if (/\b(shake|stir|blend)\b/.test(s)) stage = 2;
    else if (/\b(top|fill)\b/.test(s)) stage = 4;
    else if (/\badd\b/.test(s)) stage = 1;
  }
  return stage;
}

/** Where a step of this kind goes: after the last step that comes before or at the same stage, else by default. */
export function chooseIndex(method: readonly string[], text: string): number {
  const s = stageOf(text);
  if (s == null) return method.length;
  let last = -1;
  method.forEach((m, i) => {
    const ms = stageOf(m);
    if (ms != null && ms <= s) last = i;
  });
  if (last >= 0) return last + 1;
  // nothing at or before this stage: a glass step goes first, anything else goes before the first later step
  if (s === 0) return 0;
  const firstLater = method.findIndex((m) => {
    const ms = stageOf(m);
    return ms != null && ms > s;
  });
  return firstLater >= 0 ? firstLater : method.length;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The index of the existing step that holds `needle` (case and punctuation insensitive), or -1. */
export function findStepIndex(method: readonly string[], needle: string | null | undefined): number {
  const n = norm(needle ?? "");
  if (!n) return -1;
  const exact = method.findIndex((m) => norm(m) === n);
  if (exact >= 0) return exact;
  const inside = method.findIndex((m) => norm(m).includes(n));
  if (inside >= 0) return inside;
  return method.findIndex((m) => n.includes(norm(m)) && norm(m).length >= 8);
}

/** The built-in tidy: the same answer shape as the smart tidy. */
export function tidyBuiltin(input: TidyInput): TidyResult {
  const method = input.method.map((m) => String(m));
  const text = tidyStepText(input.text, { itemName: input.itemName, glass: input.glass, lines: input.lines, method });
  const at = findStepIndex(method, input.replaces);
  if (at >= 0) return { ops: [{ op: "replace", index: at, text }], source: "builtin" };
  return { ops: [{ op: "insert", index: chooseIndex(method, text), text }], source: "builtin" };
}
