# Precinct Costing — Claude Code guide

Recipe costing app for the Caloundra Food Precinct (Drift Bar, Chiobu, Greedy Gringo's, Gelato Rumba), built by SPORK Socials for Troy.
Live: https://precinct-costing.vercel.app — pushes to `main` auto-deploy on Vercel (project `precinct-costing`, team sporksocials-projects).

## How to work here
- Act as the orchestrator. Split any job with independent parts across parallel subagents (use worktrees when they touch different files), then review, merge, and run the checks below yourself before committing.
- Make and own design calls; say what you decided and why. Don't ship something and wait for Troy to spot problems, and don't reply "I agree" to a flaw you introduced — fix it.
- Before every commit: `npx tsc --noEmit`, `npm test` (vitest), `npm run build`. For UI changes, check both phone (390px) and desktop widths.
- Commit and push to `main` when the checks pass, then confirm the Vercel deploy is READY.
- Keep the repo clean: no scratch files, screenshots or exports committed.

## Hard rules
- **Never commit or deploy `.demo/`** (local QA fixture containing client pricing). Never set `NEXT_PUBLIC_DEMO` on Vercel.
- Never store supplier-portal credentials anywhere; never type passwords into forms.
- Database: Supabase project `precinct-costing`, ref `epktnpxjlkweyozpsvyr` (Sydney). Only use this project. Do NOT touch the `spork-ops` project (nagspgiqaenrzftmjejk) or its Site URL.
- Before any bulk data change: back up the affected tables into the `backup` schema (`backup.<table>_<yyyymmdd>`). Delete data only with Troy's explicit OK.
- Schema changes: apply as a migration AND mirror them in `supabase/schema.sql`. All `cost_*` tables use RLS via `cost_is_allowed()` (emails in `cost_allowed_users`).

## Stack
Next.js 14 (app router, client components + `lib/store.tsx` global store), Tailwind, Supabase JS, lucide-react, vitest.
- `lib/costing.ts` — cost, GP, target resolution, suggested price. Costs ex GST, sell prices inc GST. Suggested price = cost ÷ (1 − target) × 1.1, rounded UP to 20c (`settings.round_to`).
- `lib/gelato.ts` — gelato: flavour = mix prep × `cost_gelato_serves`; virtual items `gelato~<prepId>~<serveId>`. Wastage setting `gelato_wastage`.
- `lib/beer.ts` — tap beer: beer = one keg × `cost_beer_serves` (Pot 285 / Schooner 425 / Pint 570 / Jug 1140 ml); prices in `cost_beer_prices`; virtual items `beer~<beerId>~<serveId>`. **Wastage lives on each keg ingredient's yield** (Troy's decision) — don't add serve-level wastage.
- Virtual items are computed, never stored. Old stored items they replace are hidden via `replacedItemIds` / `legacy_item_id` (296 gelato + 116 tap beer items still in the DB, awaiting Troy's OK to delete).
- `lib/insights.ts` — Today feed: price rises, below target, stale prices (90 days), catalogue gaps.
- `components/ui.tsx` — design primitives (PageHeader, Group, Row, FieldRow, InlineInput, Sheet, Chips, AddButton, Toggle…). Reuse them; don't invent new one-off styles.
- `components/venue.tsx` — VenueFilter (All / Drift / Chiobu / Greedy / Gelato, dot + name) sits on Home, Recipes and Beers only; the choice lives in `?venue=` (no storage, default All) and the accent follows it only on those pages. Record pages use `VenueAccent` (the record's own venue); everything else is neutral sand.
- Demo mode for local visual QA: `NEXT_PUBLIC_DEMO=1 npx next dev -p 3100` (reads `.demo/`, local only).

## Design rules (Apple HIG thinking)
- One dark Caloundra Food Precinct theme. Page titles in the `display` (Bebas) class; venue fonts only in venue logos. Accents: Drift #B3E3F2, Chiobu #C6102E (text #FF5A70), Greedy #F26345, Gelato #ED8CCD, precinct sand #D9C3A0.
- Title Case for buttons, tabs, segments, titles and section headers ("Menu Items", "Update Price"); sentence case for helper text.
- **No hidden controls**: no dropdown pills, no controls tucked in menus when a visible row works. One round + (AddButton) top right to add; no floating buttons.
- Show impact before saving (e.g. Update Price previews which dishes fall below target). One-tap "Set $X" fixes are always undoable.
- `.anim-page` must stay opacity-only (a transform traps fixed children). Tailwind opacity modifiers don't work on CSS-var colours — use the `--*-soft` tokens.
- Users: owners/managers on phones, head chefs in the kitchen, office/bookkeeper and exec chef on desktop. Tables on desktop, rows on phones.

## Target GP defaults
Food 70, Cocktail 75, Mocktail 80, Gelato 72 (take-home ½L/1L 60, 4.5L wholesale 50), Tap beer 70 (Chiobu 72; per-beer overrides 68–75), Packaged beer/cider 70, Wine 80, Spirits 70, RTD 70.

## Backlog (Oct 2026)
1. Redo the Settings target GP grid (least polished screen).
2. Supplier price matching: apply the 224 matches Troy approves in ~/SPORK (sheet), then refresh the Price check and Naming sheets.
3. Naming clean-up: 482 ingredient renames awaiting sign-off; needs `cost_preps` unique(name) → unique(name, venue_id).
4. Differing (64) and missing (40) prices from the client price check sheet (pepper and bacon typos first).
5. After Troy confirms: back up, then delete the 296 old gelato and 116 old tap beer menu items.
6. Add chefs/managers under Settings → Who Can Sign In.
7. Phase 2: invoice upload → match supplier + code → update price → Today feed.
Open client questions: which cocoa is "130 or 250"; replacements for Latte Xtra (Mixed Berry, Rum & Raisin, Strawberry mixes) and Mascargel (Caramelised Fig Mascarpone).
