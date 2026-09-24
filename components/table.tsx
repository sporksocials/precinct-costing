"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cx } from "./ui";

export interface Column<T> {
  key: string;
  label: string;
  align?: "left" | "right";
  /** cell content */
  render: (row: T) => React.ReactNode;
  /** value used for sorting; omit for an unsortable column */
  sort?: (row: T) => string | number | null;
  className?: string;
  /** hide below this breakpoint's width (desktop tables only render at lg+) */
  hideBelow?: "xl";
}

/**
 * Desktop data table: sticky header, sortable columns, whole row opens the record.
 * Phones keep the grouped lists; this renders only at lg and up.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  href,
  initialSort,
  limit,
  className,
  rowClassName,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  href?: (row: T) => string;
  initialSort?: { key: string; dir: "asc" | "desc" } | null;
  limit?: number;
  className?: string;
  rowClassName?: (row: T) => string | undefined;
}) {
  const router = useRouter();
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(initialSort ?? null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const get = col.sort;
    const out = [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return sort.dir === "asc" ? c : -c;
    });
    return out;
  }, [rows, columns, sort]);
  const shown = limit ? sorted.slice(0, limit) : sorted;

  return (
    <div className={cx("overflow-clip rounded-2xl bg-surface", className)}>
      <table className="w-full border-collapse text-[14px] tnum">
        <thead>
          <tr className="text-label-2">
            {columns.map((c) => {
              const on = sort?.key === c.key;
              const Icon = on && sort?.dir === "asc" ? ArrowUp : ArrowDown;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={on ? (sort?.dir === "asc" ? "ascending" : "descending") : undefined}
                  className={cx("sticky top-0 z-10 whitespace-nowrap bg-surface px-4 py-2.5 text-[12px] font-medium shadow-[inset_0_-0.5px_0_var(--separator)]", c.align === "right" ? "text-right" : "text-left", c.hideBelow === "xl" && "hidden xl:table-cell")}
                >
                  {c.sort ? (
                    <button
                      type="button"
                      onClick={() =>
                        setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === "asc" ? "desc" : "asc" } : { key: c.key, dir: c.align === "right" ? "desc" : "asc" }))
                      }
                      className={cx("inline-flex items-center gap-1 transition-colors hover:text-label", on && "text-label", c.align === "right" && "flex-row-reverse")}
                    >
                      {c.label}
                      <Icon className={cx("h-3 w-3 transition-opacity", on ? "opacity-100" : "opacity-0")} strokeWidth={2.5} />
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const to = href?.(r);
            return (
              <tr
                key={rowKey(r)}
                onClick={to ? () => router.push(to) : undefined}
                className={cx("group border-t-[0.5px] border-sep transition-colors duration-150 first:border-t-0", to && "cursor-pointer hover:bg-surface-2", rowClassName?.(r))}
              >
                {columns.map((c, i) => (
                  <td key={c.key} className={cx("px-4 py-2.5 align-middle", i > 0 && "whitespace-nowrap", c.align === "right" ? "text-right" : "text-left", c.hideBelow === "xl" && "hidden xl:table-cell", c.className)}>
                    {i === 0 && to ? (
                      <Link href={to} className="outline-none focus-visible:underline" onClick={(e) => e.stopPropagation()}>
                        {c.render(r)}
                      </Link>
                    ) : (
                      c.render(r)
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
