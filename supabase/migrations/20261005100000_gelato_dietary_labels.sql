-- Gelato dietary labels: the six labels on the laminated Gelato Rumba "Dietary Requirements" sheet.
-- cost_preps.dietary_labels (gelato flavour mixes only; every other prep leaves it null):
--   null   Automatic. The labels are worked out from the flavour's ingredients in the app and never stored,
--          so a new flavour fills itself in as ingredients are added.
--   array  Set by hand (a person on the flavour page, or supabase/seed-gelato-dietary-labels.sql). The full list is
--          stored and the ingredients no longer change it.
-- Allowed ids: dairy_free, vegan, egg, soy, nuts, gluten. An empty array is a real answer (set by hand, no labels).
-- Nullable with no default on purpose: null is how a flavour stays Automatic.
-- The generic history trigger on cost_preps (cost_history_log) already records changes to the new column.
-- Idempotent.
alter table public.cost_preps
  add column if not exists dietary_labels text[]
  constraint cost_preps_dietary_labels_check check (dietary_labels is null or dietary_labels <@ array['dairy_free', 'vegan', 'egg', 'soy', 'nuts', 'gluten']::text[]);

comment on column public.cost_preps.dietary_labels is 'Gelato flavour dietary labels set by hand (dairy_free, vegan, egg, soy, nuts, gluten). Null = Automatic, worked out from the ingredients and never stored.';
