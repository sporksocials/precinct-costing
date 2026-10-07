import { FONT_START_PT } from "@/lib/print-recipe";

/**
 * The preview and print stylesheet, rendered inside the print preview only (so it exists while the preview is open and is gone
 * when it closes: nothing here can touch any other screen or any other print).
 *
 * One page = one `.pr-item`: a warning strip (screen only) over a `.pr-scale` box that holds the A4 `.pr-sheet`. On screen the
 * sheet is the real A4 size, scaled down with a transform to fit the screen width. When printing the transform and the
 * padding go (the @page margin takes over) and everything outside #print-root is hidden, so the app shell and the toolbar
 * never reach paper. Everything on the page is black on white: no fills, no grey, nothing a mono printer would smudge.
 *
 * Sizes: the recipe's base font size is the CSS variable --fs, set by the fit (lib/print-recipe.ts fitFontSize) from 15pt down
 * to a floor of 14pt. Every other size on the page is in em of that, except the footer (10pt). The page box is 186 x 272mm: the
 * printable area of A4 with a 12mm margin is 186 x 273mm, and the 1mm spare stops a rounding error making a blank extra page.
 */
export const PRINT_CSS = `
@page { size: A4 portrait; margin: 12mm; }

#print-root { position: fixed; inset: 0; z-index: 100; overflow: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; background: var(--bg); color: var(--label); }
.pr-stage { display: flex; flex-direction: column; align-items: center; gap: 22px; padding: 16px 16px calc(40px + env(safe-area-inset-bottom)); }
.pr-item { flex: none; }
.pr-warn { margin: 0 0 8px; padding: 10px 14px; border-radius: 12px; font-size: 15px; line-height: 1.35; font-weight: 600; background: var(--warn-soft); color: var(--warn); }
.pr-scale { position: relative; flex: none; }
.pr-sheet { box-sizing: border-box; width: 210mm; min-height: 297mm; padding: 12mm; background: #fff; color: #000; transform-origin: top left; box-shadow: 0 2px 16px rgba(0, 0, 0, 0.55); }

.pr-page { box-sizing: border-box; width: 186mm; height: 272mm; display: flex; flex-direction: column; font-family: var(--font-body), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: var(--fs, ${FONT_START_PT}pt); line-height: 1.3; color: #000; background: #fff; -webkit-text-size-adjust: none; text-size-adjust: none; }
.pr-page[data-long] { height: auto; min-height: 272mm; }
.pr-page[data-long] .pr-body { flex: 0 0 auto; min-height: 0; }
.pr-page * { box-sizing: border-box; }

.pr-head { display: flex; gap: 5mm; align-items: flex-start; padding-bottom: 3mm; border-bottom: 0.6mm solid #000; }
.pr-head-main { flex: 1 1 0; min-width: 0; }
.pr-brand { display: flex; align-items: center; gap: 3.5mm; min-height: 11mm; }
.pr-logo { display: block; width: auto; max-width: 52mm; object-fit: contain; object-position: left center; }
.pr-logo[data-invert] { filter: invert(1); }
.pr-venue { font-size: 0.9em; font-weight: 700; letter-spacing: 0.01em; }
.pr-title { margin: 2mm 0 0; font-weight: 800; line-height: 1.04; letter-spacing: -0.01em; overflow-wrap: anywhere; }
.pr-sub { margin: 2mm 0 0; font-weight: 600; }
.pr-photo { flex: none; display: block; width: 36mm; height: 36mm; object-fit: cover; border: 0.35mm solid #000; border-radius: 1.5mm; }

.pr-body { flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; }
.pr-body > * { flex: none; }
.pr-body > .pr-grow { flex: 1 0 3.5mm; }
.pr-sec { margin-top: 3.5mm; }
.pr-h { margin: 0 0 1.2mm; font-size: 1em; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }

.pr-ing { list-style: none; margin: 0; padding: 0; }
.pr-ing[data-cols="2"] { column-count: 2; column-gap: 8mm; }
.pr-ing li { display: grid; grid-template-columns: 5.4em minmax(0, 1fr); column-gap: 0.6em; align-items: baseline; padding: 0.14em 0; border-bottom: 0.2mm dotted #000; break-inside: avoid; }
.pr-amt { text-align: right; font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pr-nm { min-width: 0; overflow-wrap: anywhere; }
.pr-note { font-style: italic; }

.pr-steps { list-style: none; counter-reset: pr-step; margin: 0; padding: 0; }
.pr-steps li { counter-increment: pr-step; display: grid; grid-template-columns: 1.9em minmax(0, 1fr); column-gap: 0.4em; padding: 0.14em 0; break-inside: avoid; }
.pr-steps li::before { content: counter(pr-step) "."; font-weight: 800; text-align: right; }

.pr-fact { margin: 0; padding: 0.1em 0; }
.pr-fact b { font-weight: 800; }

.pr-allergens { padding-top: 2.5mm; border-top: 0.6mm solid #000; }
.pr-allergens p { margin: 0.1em 0; }
.pr-allergens b { font-weight: 800; }
.pr-checked { margin: 0.25em 0 !important; padding: 0.25em 0.5em; border: 0.5mm solid #000; font-weight: 800; }

.pr-foot { flex: none; margin-top: 3mm; padding-top: 1.5mm; border-top: 0.3mm solid #000; font-size: 10pt; line-height: 1.3; white-space: pre-wrap; }

@media print {
  html[data-print-job] { background: #fff !important; color-scheme: light !important; }
  html[data-print-job] body { background: #fff !important; min-height: 0 !important; }
  html[data-print-job] body > *:not(#print-root) { display: none !important; }
  #print-root { position: static !important; inset: auto !important; overflow: visible !important; background: #fff !important; z-index: auto !important; }
  .pr-noprint { display: none !important; }
  .pr-stage { display: block !important; padding: 0 !important; gap: 0 !important; }
  .pr-item { width: auto !important; break-after: page; page-break-after: always; }
  .pr-item:last-child { break-after: auto; page-break-after: auto; }
  .pr-scale { position: static !important; width: auto !important; height: auto !important; }
  .pr-sheet { transform: none !important; box-shadow: none !important; padding: 0 !important; margin: 0 !important; width: 186mm !important; min-height: 0 !important; }
}
`;
