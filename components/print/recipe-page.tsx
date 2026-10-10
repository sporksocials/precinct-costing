"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { hasLogo } from "../brand";
import { fitFontSize, INVERT_LOGO_ON_PAPER, titleScale, type FitResult, type PrintRecipe } from "@/lib/print-recipe";

/** Logo height on paper in mm: Drift's anchor is nearly square, so it is drawn taller to read the same size as the wide marks. */
const LOGO_MM: Record<string, number> = { drift: 15, chiobu: 11, greedy: 11, gelato: 11 };

/** Ingredient lists this long are set in two columns so a long recipe keeps its large type. */
const TWO_COLUMNS_FROM = 10;

/**
 * One recipe on one A4 page (186 x 272mm of content), black on white. The base font size is set by `refit`: it applies a size,
 * measures whether the body fits the page's printable height, and steps down from 15pt to the 14pt floor. A recipe that still
 * does not fit keeps 14pt, is marked `data-long` (so it flows onto a second sheet when printed) and reports `fits: false`.
 * The size and `data-long` are set straight on the element, never through React state, so a re-render cannot undo them.
 */
export function RecipePage({ recipe, register, onFit }: { recipe: PrintRecipe; register: (id: string, refit: () => void) => () => void; onFit: (id: string, r: FitResult) => void }) {
  const pageRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [photoOk, setPhotoOk] = useState(true);
  const photo = photoOk ? recipe.photo : null;

  const refit = useCallback(() => {
    const page = pageRef.current;
    const body = bodyRef.current;
    if (!page || !body) return;
    // measure against the fixed page height, never the grown one
    page.removeAttribute("data-long");
    const r = fitFontSize((pt) => {
      page.style.setProperty("--fs", `${pt}pt`);
      return body.scrollHeight <= body.clientHeight;
    });
    if (!r.fits) page.setAttribute("data-long", "");
    onFit(recipe.id, r);
  }, [recipe.id, onFit]);

  useLayoutEffect(() => {
    refit();
  }, [refit, recipe, photo]);
  useEffect(() => register(recipe.id, refit), [register, recipe.id, refit]);

  const a = recipe.allergens;
  const cols = recipe.lines.length >= TWO_COLUMNS_FROM ? "2" : "1";
  const logo = recipe.venue.slug && hasLogo(recipe.venue.slug) ? recipe.venue.slug : null;
  const mm = logo ? LOGO_MM[logo] ?? 11 : 11;
  const facts = [recipe.glass ? ["Glass", recipe.glass] : null, recipe.garnish.length ? ["Garnish", recipe.garnish.join(", ")] : null, recipe.storage ? ["Storage", recipe.storage] : null].filter((f): f is string[] => !!f);

  return (
    <div ref={pageRef} className="pr-page" data-recipe={recipe.id}>
      <div className="pr-head">
        <div className="pr-head-main">
          <div className="pr-brand">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/brand/${logo}.svg`} alt="" className="pr-logo" style={{ height: `${mm}mm` }} data-invert={INVERT_LOGO_ON_PAPER.has(logo) ? "" : undefined} draggable={false} onLoad={refit} />
            ) : null}
            <span className="pr-venue">{recipe.venue.name}</span>
          </div>
          <h1 className="pr-title" style={{ fontSize: `${titleScale(recipe.title)}em` }}>
            {recipe.title}
          </h1>
          <p className="pr-sub">{[recipe.subtitle, recipe.detail].filter(Boolean).join("  ·  ")}</p>
        </div>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" className="pr-photo" onError={() => setPhotoOk(false)} />
        ) : null}
      </div>

      <div ref={bodyRef} className="pr-body">
        {recipe.lines.length ? (
          <section className="pr-sec">
            <h2 className="pr-h">Ingredients</h2>
            <ul className="pr-ing" data-cols={cols}>
              {recipe.lines.map((l, i) => (
                <li key={i}>
                  <span className="pr-amt">{[l.amount.value, l.amount.unit].filter(Boolean).join(" ")}</span>
                  <span className="pr-nm">
                    {l.name}
                    {l.note ? <span className="pr-note">{`, ${l.note}`}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {facts.length ? (
          <section className="pr-sec">
            {facts.map(([label, text]) => (
              <p key={label} className="pr-fact">
                <b>{label}:</b> {text}
              </p>
            ))}
          </section>
        ) : null}

        {recipe.method.length ? (
          <section className="pr-sec">
            <h2 className="pr-h">Method</h2>
            <ol className="pr-steps">
              {recipe.method.map((s, i) => (
                <li key={i}>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {recipe.plating.length ? (
          <section className="pr-sec">
            <h2 className="pr-h">Plating</h2>
            <ol className="pr-steps">
              {recipe.plating.map((s, i) => (
                <li key={i}>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {recipe.options.length ? (
          <section className="pr-sec pr-options" aria-label="Options">
            <h2 className="pr-h">Options</h2>
            {recipe.options.map((o) => (
              <p key={o.letter} className="pr-fact">
                <b>{o.letter}</b> {o.label}: {o.text}
              </p>
            ))}
          </section>
        ) : null}

        <div className="pr-grow" />

        <section className="pr-allergens">
          <h2 className="pr-h">Allergens</h2>
          <p>
            <b>{a.contains.split(":")[0]}:</b>
            {a.contains.slice(a.contains.indexOf(":") + 1)}
          </p>
          {a.mayContain ? <p>{a.mayContain}</p> : null}
          {a.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
          {a.marks.length ? (
            <p>
              {a.marks.map((k, i) => (
                <span key={k.letter}>
                  {i ? ", " : ""}
                  <b>{k.letter}</b> {k.label}
                </span>
              ))}
            </p>
          ) : null}
          {a.seafood ? <p>{a.seafood}</p> : null}
          {a.notChecked ? <p className="pr-checked">{a.notChecked}</p> : null}
          <p>{a.notice}</p>
        </section>
      </div>

      <div className="pr-foot">{recipe.footer}</div>
    </div>
  );
}
