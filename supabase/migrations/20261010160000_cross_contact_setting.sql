-- Venue cross-contact line (Troy, 10 Oct 2026): a short standing line per venue, printed in the footer of every Allergy Matrix sheet
-- and shown on the kitchen iPad matrix ("Shared fryer and grill: cross-contact is possible. Ask the head chef if unsure.").
-- cost_settings.value is numeric, so it cannot hold text. The smallest change is one nullable text column beside it:
--   key = 'cross_contact_<venue slug>' (for example cross_contact_drift), value = 0, text_value = the line.
-- Everything else reads only the keys it knows (gst_rate, round_to, alert_pct, gelato_wastage), so these rows are invisible to costing.
-- cost_settings already has the audit and change history triggers, so an edit lands in the Change Log with no further change.
-- A venue with no row (or a blank text_value) uses the default line in the app and in cost_kitchen_matrix. Idempotent.
alter table public.cost_settings add column if not exists text_value text;

comment on column public.cost_settings.text_value is 'Text settings: key cross_contact_<venue slug> holds that venue''s standing cross-contact line (value is 0 for these rows).';
