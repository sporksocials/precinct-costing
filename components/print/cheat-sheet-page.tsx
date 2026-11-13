"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { hasLogo } from "../brand";
import { INVERT_LOGO_ON_PAPER } from "@/lib/print-recipe";
import {
  fitScale,
  footerLine,
  HEADER_DISHES,
  HEADER_KEY,
  HOW_TO_READ,
  KEY_EMPTY,
  KEY_TITLE,
  NO_PHOTO,
  pageOf,
  ROLES,
  roleDef,
  SHEET_TITLE,
  sauceUseText,
  type CheatDish,
  type CheatPage,
  type CheatSheet,
  type ScaleFit,
} from "@/lib/cheat-sheet";

/**
 * One Kitchen Cheat Sheet page: A4 landscape, either five dish columns or the Sauce Key. Props only (no store), so it renders
 * stand-alone. The text size is the CSS variable --cs on the page element, set straight on the element by `refit` (never
 * through React state, so a re-render cannot undo it): it applies a scale, measures whether any column overflows, and steps
 * down from 1.25 to 0.55. A page that still overflows at the floor reports `fits: false` and the preview warns.
 */
export function CheatSheetPage({
  page,
  venue,
  printedOn,
  total,
  register,
  onFit,
}: {
  page: CheatPage;
  venue: CheatSheet["venue"];
  printedOn: string;
  total: number;
  register?: (id: string, refit: () => void) => () => void;
  onFit?: (id: string, r: ScaleFit) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = String(page.n);

  const refit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = fitScale((s) => {
      el.style.setProperty("--cs", String(s));
      return nothingOverflows(el);
    });
    el.style.setProperty("--cs", String(r.scale));
    onFit?.(id, r);
  }, [id, onFit]);

  useLayoutEffect(() => {
    refit();
  }, [refit, page]);
  useEffect(() => (register ? register(id, refit) : undefined), [register, id, refit]);

  const logo = venue.slug && hasLogo(venue.slug) ? venue.slug : null;
  const key = page.kind === "key";

  return (
    <div ref={ref} className="cs-page" data-page={page.n}>
      <div className="cs-hd">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/brand/${logo}.svg`} alt="" className="cs-logo" data-invert={INVERT_LOGO_ON_PAPER.has(logo) ? "" : undefined} draggable={false} onLoad={refit} />
        ) : (
          <span className="cs-venue">{venue.name}</span>
        )}
        <h1>{SHEET_TITLE}</h1>
        <div className="cs-hd-sub">{key ? HEADER_KEY : HEADER_DISHES}</div>
      </div>

      {page.kind === "dishes" ? (
        <div className="cs-cols">
          {page.dishes.map((d) => (
            <DishColumn key={d.id} dish={d} />
          ))}
        </div>
      ) : (
        <div className="cs-keywrap">
          <div className="cs-note">
            <b>How to read the sheet.</b> {HOW_TO_READ}
          </div>
          <div className="cs-keybox">
            <h2>{KEY_TITLE}</h2>
            {page.entries.length ? (
              <div className="cs-sk" style={{ columnCount: page.entries.length > 21 ? 4 : 3 }}>
                {page.entries.map((e) => (
                  <div key={e.name}>
                    <b>{e.name}</b>
                    {e.uses.map(sauceUseText).join(", ")}
                  </div>
                ))}
              </div>
            ) : (
              <p className="cs-empty">{KEY_EMPTY}</p>
            )}
          </div>
        </div>
      )}

      <div className="cs-foot">
        <div>{footerLine(venue.short, printedOn)}</div>
        <div className="cs-legend" aria-label="Bar colours">
          {ROLES.map((r) => (
            <span key={r.id} style={{ background: r.bg, color: r.fg }}>
              {r.label}
            </span>
          ))}
        </div>
        <div>{pageOf(page.n, total)}</div>
      </div>
    </div>
  );
}

/** True when no dish column, and not the Sauce Key, has more content than room (measured on the real layout). */
function nothingOverflows(el: HTMLElement): boolean {
  const cols = [...el.querySelectorAll<HTMLElement>(".cs-col")];
  if (!cols.every((c) => c.scrollHeight <= c.clientHeight + 1)) return false;
  const sk = el.querySelector<HTMLElement>(".cs-sk");
  return !sk || (sk.scrollHeight <= sk.clientHeight + 1 && sk.scrollWidth <= sk.clientWidth + 1);
}

function DishColumn({ dish }: { dish: CheatDish }) {
  const [photoOk, setPhotoOk] = useState(true);
  const photo = photoOk ? dish.photo : null;
  return (
    <div className="cs-col" data-dish={dish.id}>
      <div className="cs-sec">{dish.section}</div>
      <h3 className="cs-title">
        {dish.title}
        {dish.pcs ? <span className="cs-pcs">{dish.pcs} PCS</span> : null}
      </h3>
      <div className="cs-photo">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" className="cs-img" onError={() => setPhotoOk(false)} draggable={false} />
        ) : (
          <div className="cs-img cs-img-none">{NO_PHOTO}</div>
        )}
      </div>
      {dish.groups.map((g) => {
        const r = roleDef(g.role);
        return (
          <div key={g.role} className="cs-g">
            <div className="cs-gl" style={{ background: r.bg, color: r.fg }}>
              {r.label}
            </div>
            {g.lines.map((l, i) => (
              <div key={i} className="cs-it">
                <b>{l.name}</b>
                <i>{l.amount}</i>
              </div>
            ))}
          </div>
        );
      })}
      <div className="cs-ves">
        Vessel <span />
      </div>
    </div>
  );
}
