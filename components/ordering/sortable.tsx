"use client";

/**
 * A reorderable list for Ordering Setup (categories, products). Three ways to move a row, all visible and all 44 x 44:
 *   - the drag handle on the left (pointer events, so it works with a finger, a pen and a mouse; the page scrolls itself when
 *     a row is dragged near the top or bottom edge),
 *   - an Up and a Down button on the right,
 *   - the arrow keys on the focused handle.
 * `onMove(from, to)` is called once per move with the indexes in the list as given; the caller writes the new order.
 * A short sentence is announced to screen readers after every move.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { cx } from "@/components/ui";

interface DragState {
  id: string;
  from: number;
  to: number;
  /** pointer offset since the drag started, in page pixels */
  dy: number;
  height: number;
}

const BTN = "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-label-2 transition-colors active:bg-fill enabled:hover:bg-fill disabled:opacity-30";

export function SortableRows<T>({
  items,
  getId,
  getLabel,
  onMove,
  renderBody,
  disabled,
  className,
}: {
  items: readonly T[];
  getId: (item: T) => string;
  /** the row's name, for the buttons' labels and the announcement */
  getLabel: (item: T) => string;
  onMove: (from: number, to: number) => void;
  renderBody: (item: T, index: number) => React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [announce, setAnnounce] = useState("");
  const rows = useRef(new Map<string, HTMLLIElement>());
  const geometry = useRef<{ mids: number[]; startPageY: number } | null>(null);
  const pointer = useRef(0);
  const raf = useRef(0);
  const refocus = useRef<string | null>(null);

  const move = useCallback(
    (from: number, to: number) => {
      if (disabled || to < 0 || to >= items.length || to === from) return;
      const id = getId(items[from]);
      setAnnounce(`${getLabel(items[from])} moved to position ${to + 1} of ${items.length}`);
      onMove(from, to);
      return id;
    },
    [disabled, items, getId, getLabel, onMove],
  );

  // after a button or key move, put focus back on the control that was used (the DOM node moved)
  useLayoutEffect(() => {
    const key = refocus.current;
    if (!key) return;
    refocus.current = null;
    const [id, which] = key.split("|");
    const root = rows.current.get(id);
    const el = root?.querySelector<HTMLButtonElement>(`[data-sort="${which}"]:not(:disabled)`) ?? root?.querySelector<HTMLButtonElement>(`[data-sort="handle"]`);
    el?.focus();
  });

  const stopLoop = () => {
    window.cancelAnimationFrame(raf.current);
    raf.current = 0;
  };
  useEffect(() => stopLoop, []);

  const update = useCallback(
    (state: DragState) => {
      const g = geometry.current;
      if (!g) return;
      const pageY = pointer.current + window.scrollY;
      const dy = pageY - g.startPageY;
      const draggedMid = g.mids[state.from] + dy;
      let to = 0;
      g.mids.forEach((m, i) => {
        if (i !== state.from && m < draggedMid) to += 1;
      });
      setDrag({ ...state, dy, to });
    },
    [],
  );

  const onDown = (e: React.PointerEvent<HTMLButtonElement>, index: number) => {
    if (disabled || e.button > 0) return;
    const id = getId(items[index]);
    const mids = items.map((it) => {
      const el = rows.current.get(getId(it));
      const r = el?.getBoundingClientRect();
      return r ? r.top + window.scrollY + r.height / 2 : 0;
    });
    const el = rows.current.get(id);
    const height = el?.getBoundingClientRect().height ?? 56;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointer.current = e.clientY;
    geometry.current = { mids, startPageY: e.clientY + window.scrollY };
    const state: DragState = { id, from: index, to: index, dy: 0, height };
    setDrag(state);
    // scroll the page while the row is held near the top or bottom edge
    const loop = () => {
      const y = pointer.current;
      const edge = 90;
      if (y < edge) window.scrollBy(0, -Math.ceil((edge - y) / 6));
      else if (y > window.innerHeight - edge) window.scrollBy(0, Math.ceil((y - (window.innerHeight - edge)) / 6));
      setDrag((d) => {
        if (!d) return d;
        const g = geometry.current;
        if (!g) return d;
        const dy = pointer.current + window.scrollY - g.startPageY;
        const draggedMid = g.mids[d.from] + dy;
        let to = 0;
        g.mids.forEach((m, i) => {
          if (i !== d.from && m < draggedMid) to += 1;
        });
        return d.dy === dy && d.to === to ? d : { ...d, dy, to };
      });
      raf.current = window.requestAnimationFrame(loop);
    };
    raf.current = window.requestAnimationFrame(loop);
  };
  const onMovePointer = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    pointer.current = e.clientY;
    update(drag);
  };
  const end = (commit: boolean) => {
    stopLoop();
    const d = drag;
    geometry.current = null;
    setDrag(null);
    if (commit && d && d.to !== d.from) {
      refocus.current = `${d.id}|handle`;
      move(d.from, d.to);
    }
  };

  const shift = (index: number): number => {
    if (!drag) return 0;
    if (index === drag.from) return drag.dy;
    const { from, to, height } = drag;
    if (from < to && index > from && index <= to) return -height;
    if (from > to && index < from && index >= to) return height;
    return 0;
  };

  return (
    <>
      <ul className={cx("group-list", className)}>
        {items.map((item, i) => {
          const id = getId(item);
          const label = getLabel(item);
          const dragging = drag?.id === id;
          return (
            <li
              key={id}
              ref={(el) => {
                if (el) rows.current.set(id, el);
                else rows.current.delete(id);
              }}
              style={{ transform: shift(i) ? `translateY(${shift(i)}px)` : undefined }}
              className={cx("relative flex items-center gap-2 bg-surface px-2 py-1", drag && !dragging && "transition-transform duration-150 motion-reduce:transition-none", dragging && "z-10 rounded-xl bg-surface-2 shadow-float")}
            >
              <button
                type="button"
                data-sort="handle"
                aria-label={`Drag ${label} to reorder. Or use the arrow keys.`}
                disabled={disabled}
                onPointerDown={(e) => onDown(e, i)}
                onPointerMove={onMovePointer}
                onPointerUp={() => end(true)}
                onPointerCancel={() => end(false)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    e.preventDefault();
                    refocus.current = `${id}|handle`;
                    move(i, i + (e.key === "ArrowUp" ? -1 : 1));
                  }
                }}
                style={{ touchAction: "none" }}
                className={cx(BTN, "cursor-grab active:cursor-grabbing")}
              >
                <GripVertical className="h-5 w-5" aria-hidden />
              </button>
              <div className="min-w-0 flex-1">{renderBody(item, i)}</div>
              <button
                type="button"
                data-sort="up"
                aria-label={`Move ${label} up`}
                disabled={disabled || i === 0}
                onClick={() => {
                  refocus.current = `${id}|up`;
                  move(i, i - 1);
                }}
                className={BTN}
              >
                <ArrowUp className="h-5 w-5" aria-hidden />
              </button>
              <button
                type="button"
                data-sort="down"
                aria-label={`Move ${label} down`}
                disabled={disabled || i === items.length - 1}
                onClick={() => {
                  refocus.current = `${id}|down`;
                  move(i, i + 1);
                }}
                className={BTN}
              >
                <ArrowDown className="h-5 w-5" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
    </>
  );
}
