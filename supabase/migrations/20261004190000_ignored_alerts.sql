-- Ignored alerts: the Today feed's "Ignore" and its "Ignored" tab. One row per ignored alert, shared by everyone who can
-- sign in. `alert_key` says what was ignored and the state it was ignored in (see lib/ignored-alerts.ts), for example
-- 'below_target:<item id>:<price in cents>' or 'price_rise:<ingredient id>:<price log id>', so a later, different
-- situation (a new price rise, a changed price) is a new key and shows again. Restore deletes the row.
create table if not exists public.cost_ignored_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_key text not null unique,
  kind text not null,
  -- where the alert opens in the app (a path such as /items/<id>), so the Ignored tab can link to it
  ref text,
  -- what the alert was called when it was ignored, so the Ignored tab can say what it was without recomputing it
  title text,
  ignored_by text,
  ignored_at timestamptz not null default now()
);

create index if not exists cost_ignored_alerts_ignored_at_idx on public.cost_ignored_alerts (ignored_at desc);

alter table public.cost_ignored_alerts enable row level security;
drop policy if exists cost_allowed_all on public.cost_ignored_alerts;
create policy cost_allowed_all on public.cost_ignored_alerts for all to authenticated
  using (public.cost_is_allowed()) with check (public.cost_is_allowed());

comment on table public.cost_ignored_alerts is 'Alerts on the Today feed that someone chose to ignore (shared by all signed-in users). Delete the row to restore the alert.';
