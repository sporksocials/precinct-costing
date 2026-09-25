# Precinct Costing — Claude Code guide

Recipe costing app for the Caloundra Food Precinct (Drift Bar, Chiobu, Greedy Gringo's, Gelato Rumba), built by SPORK Socials for Troy.
Live: https://precinct-costing.vercel.app — pushes to `main` auto-deploy on Vercel (project `precinct-costing`, team sporksocials-projects).

## How to work here
- Act as the orchestrator. Split any job with independent parts across parallel subagents (use worktrees when they touch different files), then review, merge, and run the checks below yourself before committing.
- Make and own design calls; say what you decided and why. Don't ship something and wait for Troy to spot problems, and don't reply "I agree" to a flaw you introduced — fix it.
- Before every commit: `npx tsc --noEmit`, `npm test` (vitest), `npm run build`. For UI changes, design and check BOTH phone (390px) and desktop widths every time, including small requests and subagent briefs; never ship one and leave the other behind (Troy's standing rule).
- Commit and push to `main` when the checks pass, then confirm the Vercel deploy is READY.
- Keep the repo clean: no scratch files, screenshots or exports committed.
- **Where files live:** every file we create or receive for this project (client workbooks, source spreadsheets, exports, research, scripts, analysis) lives in `files/` inside this folder, and nowhere else (not `~/SPORK`, not a `Claude outputs` folder, not Downloads copies). `files/` is gitignored because the repo is public and the files hold client pricing. Layout: `files/client-sent/` (what went to the client, dated), `files/source/` (originals still needed), `files/research/`, `files/archive/<date>-<topic>/` (finished work kept for the record). Session scratch goes in the session scratchpad and is not kept.
- **Always clean up:** when a file is superseded or a task is finished, remove it in the same session: move working copies to the macOS Trash (recoverable), keep only the final version in `client-sent/`, archive scripts and analysis worth keeping under `archive/`, and delete the rest. Never leave duplicate copies (top-level, outputs folders, Downloads). Delete finished agent worktrees and their merged branches (`git worktree remove --force <path>`, `git branch -d <branch>`) after merging. Never touch the client's original files in Downloads.
- **Push check:** `git config core.hooksPath .githooks` (once per clone) enables `.githooks/pre-push`, which blocks a push when tracked files have uncommitted changes, the type check fails, or tests fail (`PREPUSH_BUILD=1` adds the build). Vercel builds whatever is committed, so never push without it.

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
- Information architecture: every kind of thing has one home. **Menu** (`app/(app)/menu`) lists everything sold (food, drinks, tap beer rows, gelato flavours); venue tiles and category chips only filter it. **Ingredients** has an Ingredients | Preps control (`?type=preps`). Tap beer detail is `/beers/[id]`, gelato Price Grid `/gelato`, serves `/gelato/serves`; old `/recipes`, `/beers`, `/items`, `/preps` redirect (next.config.mjs).
- `components/venue.tsx` — VenueFilter (five separate tiles: All / Drift / Chiobu / Greedy / Gelato; selected tile fills with the venue colour and a tick) sits on Home, Menu, Ingredients > Preps and Specials; the choice lives in `?venue=` (no storage, default All) and the accent follows it only on those pages. Targets in the DB stay at 72% everywhere (Troy's call). Record pages use `VenueAccent` (the record's own venue); everything else is neutral sand.
- Demo mode for local visual QA: `NEXT_PUBLIC_DEMO=1 npx next dev -p 3100` (reads `.demo/`, local only).

## Design rules (Apple HIG thinking)
- One dark Caloundra Food Precinct theme. Page titles in the `display` (Bebas) class; venue fonts only in venue logos. Accents: Drift #B3E3F2, Chiobu #C6102E (text #FF5A70), Greedy #F26345, Gelato #ED8CCD, precinct sand #D9C3A0.
- Title Case for buttons, tabs, segments, titles and section headers ("Menu Items", "Update Price"); sentence case for helper text.
- **No hidden controls**: no dropdown pills, no controls tucked in menus when a visible row works. One round + (AddButton) top right to add; no floating buttons.
- Show impact before saving (e.g. Update Price previews which dishes fall below target). One-tap "Set $X" fixes are always undoable.
- `.anim-page` must stay opacity-only (a transform traps fixed children). Tailwind opacity modifiers don't work on CSS-var colours — use the `--*-soft` tokens.
- Users: owners/managers on phones, head chefs in the kitchen, office/bookkeeper and exec chef on desktop. Tables on desktop, rows on phones.

## Target GP
Every venue and category is 72% (Troy's decision, Sep 2026). Per-item, per-beer and per-gelato-serve overrides were cleared on 26 Sep 2026 (old values kept in `backup.menu_items_20260925d`, `backup.beers_20260925d`, `backup.gelato_serves_20260925d`); the fallback default is 72% too. Change targets in Settings; an item can still override its own target under Details.

## Backlog (Oct 2026)
1. (Done) Settings target GP grid. Also done: price picker, price history, Review and Apply, Specials and combos.
2. Supplier price matching: apply the 224 matches Troy approves (`files/source/Supplier price matching ...xlsx`), then refresh the Price check and Naming sheets.
3. Naming clean-up: standard applied 26 Sep 2026 (high-confidence renames: 269 ingredients, 43 preps, 83 menu items, 1 supplier; backups in `backup.*_20260925c`; `cost_preps` is now unique(name, venue_id)). Remaining medium/low rows and duplicate groups are in the client workbook `files/client-sent/Questions to Confirm (sent 2026-09-25).xlsx` (Part 2), with the analysis in `files/archive/2026-09-26-naming-analysis/`, awaiting the customer's answers. Nothing merged or deleted yet.
4. Differing (64) and missing (40) prices from the client price check sheet (pepper and bacon typos first).
5. After Troy confirms: back up, then delete the 296 old gelato and 116 old tap beer menu items.
6. (Done) Matt, Mon and Brendan added under Who Can Sign In. Add more there as needed.
7. Supplier volume deals (effective price), prep-first costing, variants, allergen tags, import from old sheets.
8. Phase 2: invoice upload → match supplier + code → update price → Today feed.
Open client questions: which cocoa is "130 or 250"; replacements for Latte Xtra (Mixed Berry, Rum & Raisin, Strawberry mixes) and Mascargel (Caramelised Fig Mascarpone).
