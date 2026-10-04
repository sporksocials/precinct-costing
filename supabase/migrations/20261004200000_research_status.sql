-- Research This Drink: only a NEW cocktail or mocktail is offered the button.
-- cost_menu_items.research_status says where a drink is in that offer:
--   null       never offered (every drink that exists today, and every other category)
--   'offered'  a new cocktail or mocktail: the recipe page shows Research This Drink and Skip
--   'done'     the research ran and its notes were filed (the card is gone for good)
--   'skipped'  Skip was tapped (final)
-- Nullable with no default on purpose: the ~90 existing cocktails and mocktails stay null and never show the button.
-- Idempotent.
alter table public.cost_menu_items
  add column if not exists research_status text
  constraint cost_menu_items_research_status_check check (research_status in ('offered', 'done', 'skipped'));

comment on column public.cost_menu_items.research_status is 'Research This Drink offer: null = never offered, offered = new cocktail or mocktail awaiting a decision, done = research ran, skipped = Skip tapped.';
