import { describe, expect, it } from "vitest";
import { checkedSave, SaveRaceError, threeWay, withoutStamps, type CheckDeps, type CommitArgs, type Fresh } from "@/lib/edit-conflict";
import type { MenuItem, RecipeLine } from "@/lib/types";

const item = (over: Partial<MenuItem> = {}): MenuItem => ({
  id: "i1",
  name: "Mai Tai",
  venue_id: 1,
  category: "Cocktails",
  section: null,
  portions: 1,
  sell_price_inc: 20,
  target_override: null,
  hh_price_inc: null,
  active: true,
  source: null,
  notes: null,
  method: ["Shake", "Strain"],
  garnish: ["Lime"],
  ...over,
});

let n = 0;
const line = (id: string, over: Partial<RecipeLine> = {}): RecipeLine => ({
  id,
  parent_type: "item",
  parent_id: "i1",
  component_type: "ingredient",
  component_id: `c-${id}`,
  qty: 30,
  unit: "ml",
  note: null,
  sort: ++n,
  ...over,
});

const A = line("a");
const B = line("b", { qty: 15 });
const C = line("c", { qty: 10 });
const base = item();
const baseLines = [A, B, C];

function run(opts: { mine?: Partial<MenuItem>; theirs?: Partial<MenuItem>; mineLines?: RecipeLine[]; theirsLines?: RecipeLine[] }) {
  return threeWay<MenuItem>({
    base,
    mine: item(opts.mine),
    theirs: item(opts.theirs),
    baseLines,
    mineLines: opts.mineLines ?? baseLines,
    theirsLines: opts.theirsLines ?? baseLines,
  });
}

describe("threeWay: fields", () => {
  it("nothing changed by anyone: no changes, no conflicts, nothing to write", () => {
    const r = run({});
    expect(r.theirs.changed).toBe(false);
    expect(r.conflicts).toEqual([]);
    expect(r.resolutions.mine.patch).toEqual({});
    expect(r.resolutions.mine.linesChanged).toBe(false);
  });

  it("only they changed a field: not a conflict, and my save does not write it (their value stays)", () => {
    const r = run({ theirs: { sell_price_inc: 22 } });
    expect(r.theirs.changed).toBe(true);
    expect(r.theirs.labels).toEqual(["Price"]);
    expect(r.conflicts).toEqual([]);
    expect(r.resolutions.mine.patch).toEqual({});
    expect(r.resolutions.mine.record.sell_price_inc).toBe(22);
  });

  it("only I changed a field: written, no conflict, they changed nothing", () => {
    const r = run({ mine: { name: "Mai Tai Royale" } });
    expect(r.theirs.changed).toBe(false);
    expect(r.conflicts).toEqual([]);
    expect(r.resolutions.mine.patch).toEqual({ name: "Mai Tai Royale" });
  });

  it("different fields changed by each side merge: mine written, theirs kept", () => {
    const r = run({ mine: { name: "Mai Tai Royale" }, theirs: { sell_price_inc: 22 } });
    expect(r.conflicts).toEqual([]);
    expect(r.resolutions.mine.patch).toEqual({ name: "Mai Tai Royale" });
    expect(r.resolutions.mine.record).toMatchObject({ name: "Mai Tai Royale", sell_price_inc: 22 });
  });

  it("the same field changed differently by both is a conflict", () => {
    const r = run({ mine: { sell_price_inc: 21 }, theirs: { sell_price_inc: 22 } });
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({ kind: "field", label: "Price", keys: ["sell_price_inc"], mine: { sell_price_inc: 21 }, theirs: { sell_price_inc: 22 } });
  });

  it("the same field changed identically by both is not a conflict and needs no write", () => {
    const r = run({ mine: { sell_price_inc: 22 }, theirs: { sell_price_inc: 22 } });
    expect(r.conflicts).toEqual([]);
    expect(r.resolutions.mine.patch).toEqual({});
  });

  it("a field I did not change is never a conflict, whatever they did to it", () => {
    const r = run({ theirs: { name: "Other", sell_price_inc: 99, notes: "x" } });
    expect(r.conflicts).toEqual([]);
    expect(r.resolutions.mine.patch).toEqual({});
  });

  it("Keep Mine writes my value for the conflict; Use Theirs writes nothing for it but still saves my other edits", () => {
    const r = run({ mine: { sell_price_inc: 21, name: "Mai Tai Royale" }, theirs: { sell_price_inc: 22 } });
    expect(r.resolutions.mine.patch).toEqual({ sell_price_inc: 21, name: "Mai Tai Royale" });
    expect(r.resolutions.theirs.patch).toEqual({ name: "Mai Tai Royale" });
    expect(r.resolutions.theirs.record.sell_price_inc).toBe(22);
    expect(r.resolutions.mine.record.sell_price_inc).toBe(21);
  });

  it("null, undefined, empty and numeric strings compare by content", () => {
    expect(run({ mine: { notes: null }, theirs: { notes: undefined } }).conflicts).toEqual([]);
    // I cleared a note they also cleared: same
    const b = item({ notes: "x" });
    const r = threeWay<MenuItem>({ base: b, mine: item({ notes: null }), theirs: item({ notes: null }), baseLines: [], mineLines: [], theirsLines: [] });
    expect(r.conflicts).toEqual([]);
    // they set it to a value, I cleared it: conflict
    const r2 = threeWay<MenuItem>({ base: b, mine: item({ notes: null }), theirs: item({ notes: "y" }), baseLines: [], mineLines: [], theirsLines: [] });
    expect(r2.conflicts).toHaveLength(1);
    // "22" and 22 are the same price
    expect(run({ mine: { sell_price_inc: 22 }, theirs: { sell_price_inc: "22" as unknown as number } }).conflicts).toEqual([]);
  });

  it("the stamps never count as a change or a conflict", () => {
    const r = threeWay<MenuItem>({
      base: item({ updated_at: "2026-10-04T01:00:00Z", updated_by: "a@x" }),
      mine: item({ updated_at: "2026-10-04T01:00:00Z", updated_by: "a@x", name: "New" }),
      theirs: item({ updated_at: "2026-10-04T03:00:00Z", updated_by: "brendan@x" }),
      baseLines,
      mineLines: baseLines,
      theirsLines: baseLines,
    });
    expect(r.theirs.changed).toBe(false);
    expect(r.theirs.updatedBy).toBe("brendan@x");
    expect(r.theirs.updatedAt).toBe("2026-10-04T03:00:00Z");
    expect(r.resolutions.mine.patch).toEqual({ name: "New" });
    expect(withoutStamps({ id: "x", updated_at: "t", updated_by: "u", name: "n" })).toEqual({ name: "n" });
  });

  it("a column this editor never had is not counted as their change", () => {
    const b = { ...item() } as Record<string, unknown>;
    const t = { ...item(), brand_new_column: "v" } as unknown as MenuItem;
    const r = threeWay({ base: b as unknown as MenuItem, mine: b as unknown as MenuItem, theirs: t, baseLines: [], mineLines: [], theirsLines: [] });
    expect(r.theirs.changed).toBe(false);
  });

  it("Batch Yield amount and unit are one label: both sides changing either is one conflict", () => {
    const b = { id: "p1", name: "Sauce", yield_qty: 2, yield_unit: "kg" };
    const r = threeWay({ base: b, mine: { ...b, yield_qty: 3 }, theirs: { ...b, yield_qty: 4 }, baseLines: [], mineLines: [], theirsLines: [] });
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({ label: "Batch Yield", keys: ["yield_qty"], mine: { yield_qty: 3, yield_unit: "kg" }, theirs: { yield_qty: 4, yield_unit: "kg" } });
  });
});

describe("threeWay: list fields (method, garnish) are compared whole", () => {
  it("only I changed the method: written", () => {
    const r = run({ mine: { method: ["Shake", "Strain", "Garnish"] } });
    expect(r.conflicts).toEqual([]);
    expect(r.resolutions.mine.patch).toEqual({ method: ["Shake", "Strain", "Garnish"] });
  });
  it("both changed the method differently: one conflict on Method; Keep Mine and Use Theirs pick a whole list", () => {
    const r = run({ mine: { method: ["Shake hard", "Strain"] }, theirs: { method: ["Shake", "Strain", "Top"] } });
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({ label: "Method", keys: ["method"] });
    expect(r.resolutions.mine.patch.method).toEqual(["Shake hard", "Strain"]);
    expect(r.resolutions.theirs.record.method).toEqual(["Shake", "Strain", "Top"]);
  });
  it("both changed the method to the same steps: no conflict", () => {
    expect(run({ mine: { method: ["A"] }, theirs: { method: ["A"] } }).conflicts).toEqual([]);
  });
  it("garnish changed by them and method by me merge", () => {
    const r = run({ mine: { method: ["Only"] }, theirs: { garnish: ["Mint"] } });
    expect(r.conflicts).toEqual([]);
    expect(r.resolutions.mine.record).toMatchObject({ method: ["Only"], garnish: ["Mint"] });
  });
  it("an empty list and null are the same thing only if both are empty-ish: [] vs null differ", () => {
    // I cleared garnish to [], they left it: written
    expect(run({ mine: { garnish: [] } }).resolutions.mine.patch).toEqual({ garnish: [] });
  });
});

describe("threeWay: ingredient lines", () => {
  it("no line changes: nothing to write", () => {
    const r = run({});
    expect(r.resolutions.mine.lines.map((l) => l.id)).toEqual(["a", "b", "c"]);
    expect(r.resolutions.mine.linesChanged).toBe(false);
  });

  it("a line THEY added is kept when I save my own line changes (the silent deletion bug)", () => {
    const D = line("d", { qty: 5 });
    const r = run({ mineLines: [A, { ...B, qty: 20 }, C], theirsLines: [A, B, C, D] });
    expect(r.conflicts).toEqual([]);
    const ids = r.resolutions.mine.lines.map((l) => l.id);
    expect(ids).toContain("d");
    expect(r.resolutions.mine.lines.find((l) => l.id === "b")!.qty).toBe(20);
    expect(r.resolutions.mine.linesChanged).toBe(true);
    expect(r.theirs.lines.added).toBe(1);
  });

  it("a line I added is kept alongside a line they added, mine after theirs, in a stable order", () => {
    const D = line("d");
    const E = line("e");
    const r = run({ mineLines: [A, B, C, E], theirsLines: [A, B, C, D] });
    expect(r.resolutions.mine.lines.map((l) => l.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(r.resolutions.mine.lines.map((l) => l.sort)).toEqual([1, 2, 3, 4, 5]);
  });

  it("a line I added when they changed nothing: a plain add, written", () => {
    const E = line("e");
    const r = run({ mineLines: [A, B, C, E] });
    expect(r.resolutions.mine.lines.map((l) => l.id)).toEqual(["a", "b", "c", "e"]);
    expect(r.resolutions.mine.linesChanged).toBe(true);
  });

  it("only they edited a line: theirs wins, not a conflict, nothing for me to write", () => {
    const r = run({ theirsLines: [A, { ...B, qty: 99 }, C] });
    expect(r.conflicts).toEqual([]);
    expect(r.resolutions.mine.lines.find((l) => l.id === "b")!.qty).toBe(99);
    expect(r.resolutions.mine.linesChanged).toBe(false);
  });

  it("only I edited a line: mine wins and is written", () => {
    const r = run({ mineLines: [A, { ...B, qty: 99 }, C] });
    expect(r.resolutions.mine.lines.find((l) => l.id === "b")!.qty).toBe(99);
    expect(r.resolutions.mine.linesChanged).toBe(true);
  });

  it("both edited the same line identically: no conflict", () => {
    const r = run({ mineLines: [A, { ...B, qty: 20 }, C], theirsLines: [A, { ...B, qty: 20 }, C] });
    expect(r.conflicts).toEqual([]);
    expect(r.resolutions.mine.linesChanged).toBe(false);
  });

  it("both edited the same line differently: a conflict; Keep Mine and Use Theirs each pick one", () => {
    const r = run({ mineLines: [A, { ...B, qty: 20 }, C], theirsLines: [A, { ...B, qty: 25 }, C] });
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({ kind: "line", id: "b", why: "both-edited" });
    expect(r.resolutions.mine.lines.find((l) => l.id === "b")!.qty).toBe(20);
    expect(r.resolutions.theirs.lines.find((l) => l.id === "b")!.qty).toBe(25);
    expect(r.resolutions.theirs.linesChanged).toBe(false);
    expect(r.resolutions.mine.linesChanged).toBe(true);
  });

  it("qty, unit, note and component each count as an edit", () => {
    for (const change of [{ qty: 1 }, { unit: "g" as const }, { note: "fresh" }, { component_id: "other" }]) {
      const r = run({ mineLines: [A, { ...B, ...change }, C], theirsLines: [A, { ...B, qty: 77 }, C] });
      expect(r.conflicts.length, JSON.stringify(change)).toBe(change.qty === 77 ? 0 : 1);
    }
  });

  it("I removed a line they edited: a conflict; Keep Mine removes it, Use Theirs keeps their edit", () => {
    const r = run({ mineLines: [A, C], theirsLines: [A, { ...B, qty: 99 }, C] });
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({ kind: "line", id: "b", why: "mine-removed", mine: null });
    expect(r.resolutions.mine.lines.map((l) => l.id)).toEqual(["a", "c"]);
    expect(r.resolutions.theirs.lines.map((l) => l.id)).toEqual(["a", "b", "c"]);
  });

  it("they removed a line I edited: a conflict; Keep Mine restores my edited line, Use Theirs leaves it removed", () => {
    const r = run({ mineLines: [A, { ...B, qty: 20 }, C], theirsLines: [A, C] });
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({ why: "theirs-removed", theirs: null });
    expect(r.resolutions.mine.lines.map((l) => l.id)).toEqual(["a", "b", "c"]);
    expect(r.resolutions.theirs.lines.map((l) => l.id)).toEqual(["a", "c"]);
  });

  it("I removed a line they did not touch: removed. They removed one I did not touch: removed, nothing to write", () => {
    const r = run({ mineLines: [A, C] });
    expect(r.resolutions.mine.lines.map((l) => l.id)).toEqual(["a", "c"]);
    const r2 = run({ theirsLines: [A, C] });
    expect(r2.resolutions.mine.lines.map((l) => l.id)).toEqual(["a", "c"]);
    expect(r2.resolutions.mine.linesChanged).toBe(false);
    expect(r2.conflicts).toEqual([]);
  });

  it("both removed the same line: removed, no conflict", () => {
    const r = run({ mineLines: [A, C], theirsLines: [A, C] });
    expect(r.conflicts).toEqual([]);
    expect(r.resolutions.mine.lines.map((l) => l.id)).toEqual(["a", "c"]);
  });

  it("reordering alone is never a conflict: my order wins when only I moved, theirs when only they moved", () => {
    const mineMoved = run({ mineLines: [C, A, B] });
    expect(mineMoved.conflicts).toEqual([]);
    expect(mineMoved.resolutions.mine.lines.map((l) => l.id)).toEqual(["c", "a", "b"]);
    expect(mineMoved.resolutions.mine.linesChanged).toBe(true);

    const theirsMoved = run({ theirsLines: [B, C, A] });
    expect(theirsMoved.conflicts).toEqual([]);
    expect(theirsMoved.resolutions.mine.lines.map((l) => l.id)).toEqual(["b", "c", "a"]);
    expect(theirsMoved.resolutions.mine.linesChanged).toBe(false);
  });

  it("both reordered: the person saving wins the order, still no conflict", () => {
    const r = run({ mineLines: [C, B, A], theirsLines: [B, A, C] });
    expect(r.conflicts).toEqual([]);
    expect(r.resolutions.mine.lines.map((l) => l.id)).toEqual(["c", "b", "a"]);
  });

  it("blank rows (no component) are ignored on every side", () => {
    const blank = line("blank", { component_id: "" });
    const r = run({ mineLines: [A, B, C, blank] });
    expect(r.resolutions.mine.lines.map((l) => l.id)).toEqual(["a", "b", "c"]);
    expect(r.resolutions.mine.linesChanged).toBe(false);
  });

  it("settling one conflict one way never touches the rest: fields and lines mix", () => {
    const r = run({ mine: { sell_price_inc: 21 }, theirs: { sell_price_inc: 22 }, mineLines: [A, { ...B, qty: 20 }, C], theirsLines: [A, { ...B, qty: 25 }, C, line("d")] });
    expect(r.conflicts).toHaveLength(2);
    expect(r.resolutions.theirs.patch).toEqual({});
    expect(r.resolutions.theirs.lines.find((l) => l.id === "b")!.qty).toBe(25);
    expect(r.resolutions.mine.lines.find((l) => l.id === "b")!.qty).toBe(20);
    expect(r.resolutions.mine.lines.map((l) => l.id)).toContain("d");
    expect(r.resolutions.theirs.lines.map((l) => l.id)).toContain("d");
  });

  it("an empty recipe on every side is fine", () => {
    const r = threeWay<MenuItem>({ base, mine: base, theirs: base, baseLines: [], mineLines: [], theirsLines: [] });
    expect(r.conflicts).toEqual([]);
    expect(r.resolutions.mine.lines).toEqual([]);
    expect(r.theirs.changed).toBe(false);
  });
});

// ---------------------------------------------------------------- the save decision

function fake(opts: { fresh: Fresh<MenuItem> | (() => Fresh<MenuItem>)[]; stale?: number; fetchError?: Error }) {
  const commits: CommitArgs[] = [];
  let fetches = 0;
  let staleLeft = opts.stale ?? 0;
  const deps: CheckDeps<MenuItem> = {
    fetchFresh: async () => {
      fetches += 1;
      if (opts.fetchError) throw opts.fetchError;
      const f = Array.isArray(opts.fresh) ? opts.fresh[Math.min(fetches - 1, opts.fresh.length - 1)]() : opts.fresh;
      return f;
    },
    commit: async (a) => {
      if (a.guard && staleLeft > 0) {
        staleLeft -= 1;
        return { stale: true };
      }
      commits.push(a);
      return { stale: false };
    },
  };
  return { deps, commits, get fetches() { return fetches; } };
}

const input = (mine: Partial<MenuItem>, mineLines = baseLines) => ({ base, baseLines, mine: item(mine), mineLines });

describe("checkedSave", () => {
  it("(a) nothing changed underneath: saves exactly what the person changed", async () => {
    const f = fake({ fresh: { row: item({ updated_at: "T1" }), lines: baseLines } });
    const out = await checkedSave(f.deps, input({ name: "New" }));
    expect(out.status).toBe("saved");
    expect(out.status === "saved" && out.theirs.changed).toBe(false);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0].patch).toEqual({ name: "New" });
    expect(f.commits[0].lines).toBeUndefined();
    expect(f.commits[0].guard).toBe("T1");
  });

  it("(b) others changed other things: saves the merge and keeps their added line", async () => {
    const D = line("d");
    const f = fake({ fresh: { row: item({ sell_price_inc: 22, updated_by: "brendan@x", updated_at: "T2" }), lines: [A, B, C, D] } });
    const out = await checkedSave(f.deps, input({ name: "New" }, [A, { ...B, qty: 20 }, C]));
    expect(out.status).toBe("saved");
    if (out.status !== "saved") return;
    expect(out.theirs).toMatchObject({ changed: true, updatedBy: "brendan@x" });
    expect(out.record).toMatchObject({ name: "New", sell_price_inc: 22 });
    expect(out.lines.map((l) => l.id)).toEqual(["a", "b", "c", "d"]);
    expect(f.commits[0].patch).toEqual({ name: "New" });
    expect(f.commits[0].lines?.map((l) => l.id)).toEqual(["a", "b", "c", "d"]);
    expect(f.commits[0].freshLines.map((l) => l.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("(c) conflicts: writes nothing and hands back the conflicts", async () => {
    const f = fake({ fresh: { row: item({ sell_price_inc: 22, updated_at: "T2" }), lines: baseLines } });
    const out = await checkedSave(f.deps, input({ sell_price_inc: 21 }));
    expect(out.status).toBe("conflict");
    expect(f.commits).toHaveLength(0);
    if (out.status === "conflict") expect(out.conflicts.map((c) => c.id)).toEqual(["field:Price"]);
  });

  it("settling exactly those conflicts saves: Keep Mine writes mine, Use Theirs writes nothing for it", async () => {
    const fresh = { row: item({ sell_price_inc: 22, updated_at: "T2" }), lines: baseLines };
    const mine = fake({ fresh });
    const o1 = await checkedSave(mine.deps, { ...input({ sell_price_inc: 21, name: "New" }), settle: { choice: "mine", ids: ["field:Price"] } });
    expect(o1.status).toBe("saved");
    expect(mine.commits[0].patch).toEqual({ sell_price_inc: 21, name: "New" });
    const theirs = fake({ fresh });
    const o2 = await checkedSave(theirs.deps, { ...input({ sell_price_inc: 21, name: "New" }), settle: { choice: "theirs", ids: ["field:Price"] } });
    expect(o2.status).toBe("saved");
    expect(theirs.commits[0].patch).toEqual({ name: "New" });
  });

  it("a NEW conflict that appeared after the person chose still stops the save", async () => {
    const f = fake({ fresh: { row: item({ sell_price_inc: 22, notes: "n" }), lines: baseLines } });
    const out = await checkedSave(f.deps, { ...input({ sell_price_inc: 21, notes: "mine" }), settle: { choice: "mine", ids: ["field:Price"] } });
    expect(out.status).toBe("conflict");
    expect(f.commits).toHaveLength(0);
  });

  it("(e) a failed fresh read throws: nothing is written", async () => {
    const f = fake({ fresh: { row: item(), lines: [] }, fetchError: new Error("Failed to fetch") });
    await expect(checkedSave(f.deps, input({ name: "New" }))).rejects.toThrow("Failed to fetch");
    expect(f.commits).toHaveLength(0);
  });

  it("the record was deleted by someone else: reported as gone, nothing written", async () => {
    const f = fake({ fresh: { row: null, lines: [] } });
    expect((await checkedSave(f.deps, input({ name: "New" }))).status).toBe("gone");
    expect(f.commits).toHaveLength(0);
  });

  it("(f) a stale guard re-reads and re-checks once, then saves", async () => {
    const f = fake({ fresh: [() => ({ row: item({ updated_at: "T1" }), lines: baseLines }), () => ({ row: item({ updated_at: "T2", notes: "theirs" }), lines: baseLines })], stale: 1 });
    const out = await checkedSave(f.deps, input({ name: "New" }));
    expect(out.status).toBe("saved");
    expect(f.fetches).toBe(2);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0].guard).toBe("T2");
    expect(out.status === "saved" && out.record.notes).toBe("theirs");
  });

  it("(f) a stale guard whose re-read now conflicts asks instead of writing", async () => {
    const f = fake({ fresh: [() => ({ row: item({ updated_at: "T1" }), lines: baseLines }), () => ({ row: item({ updated_at: "T2", name: "Theirs" }), lines: baseLines })], stale: 1 });
    const out = await checkedSave(f.deps, input({ name: "Mine" }));
    expect(out.status).toBe("conflict");
    expect(f.commits).toHaveLength(0);
  });

  it("(f) two stale guards in a row give up with a plain error", async () => {
    const f = fake({ fresh: { row: item({ updated_at: "T1" }), lines: baseLines }, stale: 5 });
    await expect(checkedSave(f.deps, input({ name: "New" }))).rejects.toBeInstanceOf(SaveRaceError);
    expect(f.commits).toHaveLength(0);
  });

  it("before the migration (no updated_at on the row) there is no guard, and the check still works on content", async () => {
    const f = fake({ fresh: { row: item({ sell_price_inc: 22 }), lines: baseLines }, stale: 9 });
    const out = await checkedSave(f.deps, input({ name: "New" }));
    expect(out.status).toBe("saved");
    expect(f.commits[0].guard).toBeNull();
    expect(out.status === "saved" && out.theirs.updatedBy).toBeNull();
  });

  it("their copy already holds everything I changed: nothing is written, the local copy only catches up", async () => {
    const f = fake({ fresh: { row: item({ name: "Same", updated_at: "T2" }), lines: baseLines } });
    const out = await checkedSave(f.deps, input({ name: "Same" }));
    expect(out.status).toBe("saved");
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ patch: {}, lines: undefined, guard: null });
  });

  it("lines only: a lines write is sent with the guard so it claims the row", async () => {
    const f = fake({ fresh: { row: item({ updated_at: "T1" }), lines: baseLines } });
    await checkedSave(f.deps, input({}, [A, { ...B, qty: 99 }, C]));
    expect(f.commits[0].patch).toEqual({});
    expect(f.commits[0].lines).toHaveLength(3);
    expect(f.commits[0].guard).toBe("T1");
  });
});
