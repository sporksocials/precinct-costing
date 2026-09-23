# Precinct Costing

Recipe costing and menu pricing for the Caloundra Food Precinct venues (Drift Bar, Chiobu, Greedy Gringo's, Gelato Rumba).

Next.js 14 (app router, TypeScript) + Tailwind + Supabase (magic-link auth, Postgres with RLS). All costing data loads once into the browser and every cost, GP and suggested price is computed in memory, so edits and what-ifs are instant.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in the two values below
npm run dev                  # http://localhost:3000
```

| Variable | Where to find it |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon / public key |

Scripts: `npm run dev`, `npm run build`, `npm start`, `npm run lint`, `npm test` (vitest: costing maths, quantity parser, GP↔price solver, search).

## Supabase auth configuration

Sign-in is by email magic link (`signInWithOtp`). The link returns to `/auth/callback`, which exchanges the code for a session and redirects to the page the user was heading to.

In Supabase → **Authentication → URL Configuration**:

- **Site URL**: your production URL, e.g. `https://<vercel-domain>`
- **Redirect URLs**: add
  - `https://<vercel-domain>/auth/callback`
  - `http://localhost:3000/auth/callback` (for local dev)
  - any preview domains you use (`https://*-<team>.vercel.app/auth/callback` works with wildcards)

Without the redirect URL entry the magic link will land on the Site URL without a code and the user stays logged out.

## Access control

- `middleware.ts` requires a Supabase session for every route except `/login` and `/auth/callback`.
- Row-level security on every `cost_*` table only allows users whose email is in `cost_allowed_users` (see `supabase/schema.sql` for the policy pattern). A signed-in user who is not on the list sees "Your email isn't on the access list — ask SPORK".
- Manage the list under **Settings → Allowed users**.

## Database

The app is built against the `cost_*` tables in the `public` schema. `supabase/schema.sql` is a reference copy of the shape (tables, price-log trigger, RLS policies) — the production project already has these, so treat the file as documentation rather than a migration to run.

Important behaviours the app relies on:

- A trigger on `cost_ingredients` writes to `cost_price_log` and sets `previous_price` / `last_price_update` whenever `pack_price` changes. The app never inserts log rows itself; it only updates `pack_price` (and optionally `source` as the note for that change).
- `cost_portal_prices` is read-only reference data scraped from supplier portals. The app shows the latest batch per supplier and can pre-fill a new ingredient from a row.

## Costing maths

All in `lib/costing.ts` (pure functions, tested in `tests/costing.test.ts`):

- Ex-GST pack price: `pack_price` if GST-free; `pack_price / (1 + gst)` if priced inc GST; otherwise `pack_price`.
- Cost per base unit (kg / L / each): `(exGST − rebate) / pack_size / yield_pct`.
- Line units: g→kg ×0.001, ml→L ×0.001, kg / L / each ×1. A line whose unit family differs from the component's base unit is flagged as a unit mismatch (still costed).
- Prep batch cost = sum of lines (nested preps resolved recursively, cycle-guarded, max depth 5); cost per unit = batch cost / yield qty.
- Item cost per portion = recipe cost / portions. Sell ex = sell inc / (1 + gst); GP$ = sell ex − cost; GP% = GP$ / sell ex.
- Target GP = item override → venue × category target → 70%.
- Suggested price inc GST = `ceil(cost / (1 − target) × (1 + gst) / round_to) × round_to` (rounds **up** to the nearest 50c by default).

## App structure

Apple-HIG style UI (system font, grouped inset lists, sheets, light/dark via `prefers-color-scheme`). The accent colour follows the selected venue (CSS variables set from `<html data-venue>`; see `app/globals.css`). Phones get a bottom tab bar (Home · Recipes · Ingredients · Search · More); ≥1024px gets a sidebar and a ⌘K / Ctrl+K (or `/`) command palette.

| Route | What it does |
| --- | --- |
| `/` | Home: average GP (simple mean of active priced items) with Food · Drinks split, a card per venue, and at most two "Needs attention" rows. |
| `/recipes` | Menu items / Preps, venue chips, fuzzy search, category chips, sort menu. `/items` and `/preps` redirect here. |
| `/items/[id]`, `/preps/[id]` | One-screen recipe editor with autosave (debounced ~700 ms), smart "Add ingredient — 180g chicken thigh" entry (parser in `lib/parse-qty.ts`), linked sell price ↔ GP (`lib/solver.ts`), undo on line removal. |
| `/ingredients`, `/ingredients/[id]` | List with 30-day price movement; detail with big "Update price" sheet that shows the GP impact on every recipe using it, price history, Advanced fields. |
| `/search` | Global typo-tolerant search (`lib/search.ts`) across recipes, preps, ingredients and the supplier catalogue; recent items when empty. |
| `/alerts`, `/specials`, `/portal-prices`, `/settings`, `/more` | Full alert lists, specials calculator cards, supplier catalogue browse ("Add as ingredient"), settings and targets, More menu. |

The venue choice is kept in `?venue=slug` and localStorage. The last full dataset is cached in localStorage (`precinct-cache-v1`) and painted instantly on open, then refreshed from Supabase in the background.

## Demo mode (local visual QA only)

`NEXT_PUBLIC_DEMO=1` swaps the Supabase client for an in-memory stand-in (`lib/supabase/demo-client.ts`) fed by `/api/demo-data`, which reads `.demo/data.json` from disk and returns 404 unless the flag is set. Middleware skips auth in demo mode. `.demo/` is gitignored, `.vercelignore`d and excluded from output tracing — it holds client pricing data and must never be deployed. Never set `NEXT_PUBLIC_DEMO` on Vercel.

```bash
NEXT_PUBLIC_DEMO=1 npm run build && NEXT_PUBLIC_DEMO=1 npm start -- -p 3100
node .demo/shoot.mjs   # Playwright screenshots → .demo/shots/
node .demo/flow.mjs    # smoke test of the new-recipe / autosave / undo flows
```

## Deploying to Vercel

1. Import the repo, framework preset Next.js.
2. Add the two environment variables.
3. Add the production (and preview) `/auth/callback` URLs to Supabase as described above.
