"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ClipboardCheck, TriangleAlert } from "lucide-react";
import { useStore } from "@/lib/store";
import { allTodos, approvalCount, reviewHref, type VenueTodo } from "@/lib/matrix-todo";
import type { MatrixRow } from "@/lib/allergy-matrix";
import { Group, PageHeader, Row } from "../ui";
import { useAllergenIndex } from "../allergen-picker";
import { useVenue, VenueFilter, VENUE_SHORT } from "../venue";
import { PrintStatusBlock, sheetName } from "./printed";

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
  const waiting = withDishes.reduce((n, t) => n + approvalCount(t), 0);
  const nothing = withDishes.every((t) => !approvalCount(t) && !t.marks.length && !t.reprint.length);

  return (
    <div>
      <Link href={venue ? `/matrix?venue=${venue.slug}` : "/matrix"} className="btn-text -ml-2 !min-h-[44px] !gap-0 !text-accent">
        <ChevronLeft className="h-6 w-6" strokeWidth={2.25} aria-hidden />
        Allergy Matrix
      </Link>
      <PageHeader title="To Do" subtitle={venue ? `${VENUE_SHORT[venue.slug] ?? venue.name} · Allergy Matrix` : "Allergy Matrix, every venue"} />
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
  const waiting = approvalCount(todo);
  const clear = !waiting && !todo.marks.length && !todo.reprint.length;
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

      <DishGroup title="New, Never Confirmed" rows={todo.never} footer="These dishes have never been signed off, so they read Not Checked on the matrix. Newly added dishes start off the menu until they are confirmed." />
      <DishGroup title="Ingredients Changed, Re-Check" rows={todo.changed} footer="The ingredients changed after the sign-off (or it was made before changes were tracked), so the sign-off no longer counts. Check the allergens and confirm again." warn />

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

function DishGroup({ title, rows, footer, warn }: { title: string; rows: MatrixRow[]; footer: string; warn?: boolean }) {
  const [all, setAll] = useState(false);
  if (!rows.length) return null;
  const list = all ? rows : rows.slice(0, SHOW);
  return (
    <Group title={`${title} (${rows.length})`} className="mt-5" footer={footer}>
      {list.map((r) => (
        <Row
          key={r.dish.id}
          href={`/items/${r.dish.id}`}
          title={r.dish.name}
          sub={r.dish.section ?? undefined}
          trailing={
            warn ? (
              <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-warn">
                <TriangleAlert aria-hidden className="h-3.5 w-3.5" strokeWidth={2.5} /> Re-check
              </span>
            ) : (
              <span className="text-[13px] font-semibold text-warn">New</span>
            )
          }
          chevron
        />
      ))}
      {rows.length > SHOW ? <Row onClick={() => setAll((x) => !x)} title={<span className="text-accent">{all ? "Show Fewer" : `Show All ${rows.length}`}</span>} /> : null}
    </Group>
  );
}
