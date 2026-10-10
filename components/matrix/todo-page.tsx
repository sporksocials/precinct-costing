"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, TriangleAlert } from "lucide-react";
import { useStore } from "@/lib/store";
import { allTodos, approvalCount, reviewHref, waitingText, type VenueTodo } from "@/lib/matrix-todo";
import { CHECK_ALL_INGREDIENTS_HREF } from "@/lib/dish-allergens";
import type { MatrixRow } from "@/lib/allergy-matrix";
import { Group, PageHeader, Row } from "../ui";
import { useAllergenIndex } from "../allergen-picker";
import { useVenue, VenueFilter, VENUE_SHORT } from "../venue";
import { PrintStatusBlock, sheetName } from "./printed";
import { AllergenTabs } from "./allergen-tabs";

const SHOW = 8;

/**
 * Allergy Matrix To Do (Troy, 10 Oct 2026): everything that needs doing, per venue, in one place, each row going straight to the dish
 * or the sheet. (a) Dishes Need Approval (new, never confirmed; ingredients changed, re-check) with a big Start Review button,
 * (b) Marks Disagree, (c) Matrix Needs Reprinting. Nothing here changes anything: it lists, and links to where the fixing is done.
 */
export function MatrixTodoPage() {
  const store = useStore();
  const idx = useAllergenIndex();
  const { venue } = useVenue();
  const { loadMatrixPrints, matrixPrints } = store;
  useEffect(() => {
    loadMatrixPrints();
  }, [loadMatrixPrints]);

  const todos = useMemo(() => allTodos(store.venues, store.items, idx, matrixPrints), [store.venues, store.items, idx, matrixPrints]);
  const shown = venue ? todos.filter((t) => t.venue.id === venue.id) : todos;
  const withDishes = shown.filter((t) => t.rows.length > 0);
  // Start Review only offers the dishes that can be confirmed now; dishes waiting on ingredients are handled by Check Ingredients
  const waiting = withDishes.reduce((n, t) => n + t.ready.length, 0);
  const nothing = withDishes.every((t) => !approvalCount(t) && !t.marks.length && !t.reprint.length);

  return (
    <div>
      <PageHeader title="Allergens" subtitle={venue ? `${VENUE_SHORT[venue.slug] ?? venue.name} · What needs doing` : "What needs doing, every venue"} />
      <AllergenTabs current="todo" venueSlug={venue?.slug} />
      <VenueFilter className="mb-3" stats={false} compact />

      {waiting > 0 ? (
        <Link href={reviewHref(venue?.slug ?? null)} className="btn-primary mb-4 flex w-full !min-h-[56px] items-center justify-center gap-2 !text-[17px] sm:max-w-sm">
          <ClipboardCheck className="h-5 w-5" strokeWidth={2.25} aria-hidden />
          Start Review ({waiting})
        </Link>
      ) : null}

      {!store.ready ? null : withDishes.length === 0 ? (
        <p className="py-6 text-[15px] text-label-2">No active food dishes yet. Add dishes on the Menu page and they appear here.</p>
      ) : nothing ? (
        <div className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-good-soft text-good">
            <ClipboardCheck className="h-5 w-5" strokeWidth={2.5} aria-hidden />
          </span>
          <span>
            <span className="block text-[17px] font-semibold sm:text-[15px]">All Clear</span>
            <span className="block text-[15px] text-label-2 sm:text-[13px]">Every dish is confirmed and every printed sheet matches the matrix.</span>
          </span>
        </div>
      ) : (
        withDishes.map((t) => <VenueTodoBlock key={t.venue.id} todo={t} showName={!venue} />)
      )}
    </div>
  );
}

function VenueTodoBlock({ todo, showName }: { todo: VenueTodo; showName: boolean }) {
  const name = VENUE_SHORT[todo.venue.slug] ?? todo.venue.name;
  const waiting = todo.ready.length;
  const clear = !approvalCount(todo) && !todo.marks.length && !todo.reprint.length;
  return (
    <section className="mb-8" aria-label={name}>
      {showName ? (
        <div className="flex items-end justify-between gap-3 px-1 pb-1">
          <h2 className="text-[22px] font-bold tracking-tight">{name}</h2>
          {waiting > 0 ? (
            <Link href={reviewHref(todo.venue.slug)} className="btn-tinted !min-h-[44px] !px-4 !text-[15px]">
              Start Review ({waiting})
            </Link>
          ) : null}
        </div>
      ) : null}
      {clear ? <p className="px-1 py-2 text-[15px] font-medium text-good">Nothing to do for {name}.</p> : null}

      <DishGroup
        title="Ready To Confirm"
        rows={todo.ready}
        footer="The ingredients of these dishes are all checked, so the allergens are worked out. Check them against the menu and confirm. Until then they read Not Checked on the matrix, and new dishes stay off the menu."
      />
      <WaitingGroup todo={todo} />

      {todo.marks.length ? (
        <Group title={`Marks Disagree (${todo.marks.length})`} className="mt-5" inset="1rem" footer="The dish's own allergen list contradicts its GF, V or VG mark. The matrix keeps showing what the dish says until someone fixes the dish.">
          {todo.marks.map((r) => (
            <Row key={r.dish.id} href={`/items/${r.dish.id}`} title={r.dish.name} sub={r.warnings.join(" ")} wrapSub chevron />
          ))}
        </Group>
      ) : null}

      {todo.reprint.length ? (
        <Group title={`Matrix Needs Reprinting (${todo.reprint.length})`} className="mt-5" footer="The printed sheet no longer matches the matrix. Print it again and put the new one on the wall.">
          {todo.reprint.map((s) => (
            <div key={s.key} className="px-4 py-2.5">
              <p className="text-[17px] font-medium sm:text-[15px]">{sheetName(s.key)}</p>
              <PrintStatusBlock status={s.status} venueSlug={todo.venue.slug} sheetKey={s.key} />
            </div>
          ))}
        </Group>
      ) : null}
    </section>
  );
}

/** "New" for a dish never confirmed, "Re-check" for one whose ingredients changed since it was confirmed. A word and an icon, never colour alone. */
function StateTag({ row }: { row: MatrixRow }) {
  return row.signOff === "never" ? (
    <span className="text-[13px] font-semibold text-warn">New</span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-warn">
      <TriangleAlert aria-hidden className="h-3.5 w-3.5" strokeWidth={2.5} /> Re-check
    </span>
  );
}

function DishGroup({ title, rows, footer }: { title: string; rows: MatrixRow[]; footer: string }) {
  const [all, setAll] = useState(false);
  if (!rows.length) return null;
  const list = all ? rows : rows.slice(0, SHOW);
  return (
    <Group title={`${title} (${rows.length})`} className="mt-5" footer={footer}>
      {list.map((r) => (
        <Row key={r.dish.id} href={`/items/${r.dish.id}`} title={r.dish.name} sub={r.dish.section ?? undefined} trailing={<StateTag row={r} />} chevron />
      ))}
      {rows.length > SHOW ? <Row onClick={() => setAll((x) => !x)} title={<span className="text-accent">{all ? "Show Fewer" : `Show All ${rows.length}`}</span>} /> : null}
    </Group>
  );
}

/**
 * Dishes that need approval but cannot be confirmed yet because an ingredient has not been checked for allergens (ingredient first,
 * Troy, 10 Oct 2026). Each names what it waits on, and one button opens the ingredient review, where the work actually gets done.
 */
function WaitingGroup({ todo }: { todo: VenueTodo }) {
  const [all, setAll] = useState(false);
  const rows = todo.blocked;
  if (!rows.length) return null;
  const list = all ? rows : rows.slice(0, SHOW);
  return (
    <Group
      title={`Waiting On Ingredients (${waitingText(rows.length, todo.blockedIngredients.length)})`}
      className="mt-5"
      footer="These dishes cannot be confirmed until every ingredient in them has its allergens checked. Check the ingredients once and every dish that uses them moves up to Ready To Confirm."
    >
      <div className="px-4 py-3">
        <Link href={CHECK_ALL_INGREDIENTS_HREF} className="btn-primary !min-h-[44px] !px-4 !text-[15px]">
          Check Ingredients ({todo.blockedIngredients.length})
        </Link>
      </div>
      {list.map((b) => (
        <Row
          key={b.row.dish.id}
          href={`/items/${b.row.dish.id}`}
          title={b.row.dish.name}
          sub={b.unreviewed.length ? `Waiting on ${unreviewedNames(b.unreviewed)}` : "Cannot be read: check the recipe"}
          wrapSub
          trailing={<StateTag row={b.row} />}
          chevron
        />
      ))}
      {rows.length > SHOW ? <Row onClick={() => setAll((x) => !x)} title={<span className="text-accent">{all ? "Show Fewer" : `Show All ${rows.length}`}</span>} /> : null}
    </Group>
  );
}

/** "Bacon, Eggs and 3 more": the first two names, then a count. */
function unreviewedNames(list: readonly { name: string }[]): string {
  const names = list.map((u) => u.name);
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}
