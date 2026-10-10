import { tidyName } from "./name-tidy";

/**
 * Menu groups (Troy, 10 Oct 2026): items that are flavours of one thing (the Kids Milkshakes, the Spiders) share a
 * `cost_menu_items.menu_group` name, and the Drinks Station shows them as ONE card that opens to the flavours.
 *
 * DISPLAY ONLY. Every item stays a separate record with its own recipe, price, cost, GP, photo, alerts and history; costing,
 * insights, the dashboard, the POS list and print never read the group (tests/menu-groups.test.ts pins that). Pure (no React,
 * no database) so every rule is tested.
 */

/** How a group name is compared: capitals, spacing and the edges do not matter ("Kids  milkshakes" is "Kids Milkshakes"). */
export function groupKey(name: string | null | undefined): string {
  return (name ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** The group name as it is stored: tidied (spacing and Title Case), or null for empty so clearing the field removes the group. */
export function cleanGroupName(raw: string | null | undefined): string | null {
  const t = tidyName(raw ?? "");
  return t || null;
}

/**
 * The group names already used at one venue, for the editor's tap chips: one per group (case-insensitive), spelled the way
 * most of its members spell it, sorted. `except` leaves out one item (the record being edited, whose own draft is not yet saved).
 */
export function groupNamesAt(items: readonly { id: string; venue_id: number; menu_group?: string | null }[], venueId: number, except?: string): string[] {
  const spellings = new Map<string, Map<string, number>>();
  for (const i of items) {
    if (i.venue_id !== venueId || i.id === except) continue;
    const name = (i.menu_group ?? "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    const k = groupKey(name);
    const counts = spellings.get(k) ?? new Map<string, number>();
    counts.set(name, (counts.get(name) ?? 0) + 1);
    spellings.set(k, counts);
  }
  return [...spellings.values()]
    .map((counts) => [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0])
    .sort((a, b) => a.localeCompare(b));
}

/**
 * True when the database has the menu_group column. Rows read with select("*") carry the key (null when empty) once the
 * migration is applied and lack it before, so the editor only offers the field, and only ever writes it, when it is there.
 */
export function hasGroupColumn(items: readonly object[]): boolean {
  return items.some((i) => "menu_group" in i);
}

/* ---------------------------------------------------------------- Drinks Station */

export interface GroupableItem {
  id: string;
  name: string;
  /** the item's menu group as the station received it; null/absent = stands alone (an older copy or a database without the column) */
  menuGroup?: string | null;
}

export type StationCard<T extends GroupableItem> = { kind: "item"; key: string; item: T } | { kind: "group"; key: string; name: string; members: T[] };

/** Smallest number of items in view that makes a group card; fewer show as ordinary cards. */
export const MIN_GROUP = 2;

/** Whether a drink matches what was typed in the station's search: its own name or its group name. Case does not matter. */
export function matchesSearch(item: GroupableItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return item.name.toLowerCase().includes(q) || (item.menuGroup ?? "").toLowerCase().includes(q);
}

/** "4 flavours" / "1 flavour". */
export function flavourCount(n: number): string {
  return `${n} ${n === 1 ? "flavour" : "flavours"}`;
}

const byName = (a: string, b: string) => a.localeCompare(b, "en-AU", { sensitivity: "base" });

/**
 * The cards the station grid shows for the drinks IN VIEW (after the category chip or the search).
 *  - Searching: every drink is its own card, flat. (The card shows its group name as a quiet line.)
 *  - Otherwise items that share a group (compared by `groupKey`) and number two or more in view become ONE group card;
 *    a group with fewer in view (the chip took the rest away) shows its item as an ordinary card.
 * Ordinary cards keep the order they came in; a group card sits among them by its name, ahead of the first ordinary card
 * whose name sorts after it. Members keep the order they came in.
 */
export function stationCards<T extends GroupableItem>(view: readonly T[], opts: { searching?: boolean } = {}): StationCard<T>[] {
  const plain = (i: T): StationCard<T> => ({ kind: "item", key: i.id, item: i });
  if (opts.searching) return view.map(plain);
  const buckets = new Map<string, T[]>();
  for (const i of view) {
    const k = groupKey(i.menuGroup);
    if (!k) continue;
    buckets.set(k, [...(buckets.get(k) ?? []), i]);
  }
  const groups = new Map<string, T[]>([...buckets].filter(([, m]) => m.length >= MIN_GROUP));
  if (!groups.size) return view.map(plain);

  const cards: StationCard<T>[] = view.filter((i) => !groups.has(groupKey(i.menuGroup))).map(plain);
  const named = [...groups].map(([key, members]) => {
    // spelled the way most members spell it
    const counts = new Map<string, number>();
    for (const m of members) {
      const n = (m.menuGroup ?? "").replace(/\s+/g, " ").trim();
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    const name = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    return { key, name, members };
  });
  named.sort((a, b) => byName(a.name, b.name));
  for (const g of named) {
    const at = cards.findIndex((c) => c.kind === "item" && byName(c.item.name, g.name) > 0);
    const card: StationCard<T> = { kind: "group", key: g.key, name: g.name, members: g.members };
    if (at < 0) cards.push(card);
    else cards.splice(at, 0, card);
  }
  return cards;
}

/** The drinks the grid is built from: the search matches, or the chosen category (null = All). */
export function drinksInView<T extends GroupableItem & { category: string }>(items: readonly T[], opts: { query: string; category: string | null }): T[] {
  if (opts.query.trim()) return items.filter((i) => matchesSearch(i, opts.query));
  return opts.category ? items.filter((i) => i.category === opts.category) : [...items];
}

/* ---------------------------------------------------------------- station navigation */

/**
 * Where the station is. `group` is the open flavour list (null = the main grid); `selectedId` is the open recipe (null = none).
 * Back from a recipe returns to where it was opened (the flavour list or the grid); back from the flavour list returns to the grid.
 */
export interface StationNav {
  group: string | null;
  selectedId: string | null;
}

export const NAV_START: StationNav = { group: null, selectedId: null };

export type StationScreen = { name: "grid" } | { name: "group"; card: Extract<StationCard<GroupableItem>, { kind: "group" }> } | { name: "detail"; id: string };

export function openGroup(nav: StationNav, key: string): StationNav {
  return { ...nav, group: key, selectedId: null };
}
export function openDrink(nav: StationNav, id: string): StationNav {
  return { ...nav, selectedId: id };
}
/** One step back: out of a recipe, else out of a flavour list. */
export function goBack(nav: StationNav): StationNav {
  if (nav.selectedId != null) return { ...nav, selectedId: null };
  return { group: null, selectedId: null };
}
/** The idle return: all the way to the main grid. */
export function goHome(): StationNav {
  return NAV_START;
}

/**
 * What to show now, given the live data, so a refresh that removes the open recipe or flavour list (deleted, made inactive,
 * a flavour left alone in its group) drops back instead of showing a blank screen. A recipe that vanishes returns to its
 * flavour list when that still stands, else to the grid. `cards` are the group-aware cards of the unsearched view.
 */
export function resolveScreen<T extends GroupableItem>(nav: StationNav, items: readonly T[], cards: readonly StationCard<T>[]): { screen: "grid" | "group" | "detail"; nav: StationNav; group: Extract<StationCard<T>, { kind: "group" }> | null; item: T | null } {
  const group = nav.group != null ? ((cards.find((c) => c.kind === "group" && c.key === nav.group) as Extract<StationCard<T>, { kind: "group" }> | undefined) ?? null) : null;
  const item = nav.selectedId != null ? (items.find((i) => i.id === nav.selectedId) ?? null) : null;
  const next: StationNav = { group: group ? nav.group : null, selectedId: item ? nav.selectedId : null };
  if (item) return { screen: "detail", nav: next, group, item };
  if (group) return { screen: "group", nav: next, group, item: null };
  return { screen: "grid", nav: next, group: null, item: null };
}

/** Same position? (so an effect only writes state when a refresh really changed something) */
export function sameNav(a: StationNav, b: StationNav): boolean {
  return a.group === b.group && a.selectedId === b.selectedId;
}
