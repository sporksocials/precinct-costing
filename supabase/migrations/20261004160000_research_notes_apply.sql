-- Research notes that can be applied to the recipe when Approve is tapped.
--   method_step     a suggested method step to add (the app tidies it into the house style and picks its place)
--   method_replaces text of an existing step this suggestion replaces (optional)
--   answer_prompt   when set, the note is a question for the venue: Approve asks for a short typed answer first
--   applied         what Approve changed, so it can be undone or reopened:
--                   {"at": ts, "lines": [{"line_id", "before_qty", "after_qty"} or {"created_line_id"}], "method_before": [...], "method_after": [...]}
alter table public.cost_research_notes
  add column if not exists method_step text,
  add column if not exists method_replaces text,
  add column if not exists answer_prompt text,
  add column if not exists applied jsonb;
