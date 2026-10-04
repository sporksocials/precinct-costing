-- Security tidy-up: the two access-check helpers answer true or false for the signed-in person and are only used by the
-- row rules, which apply to signed-in users. A signed-out visitor never needed to call them (the Supabase advisor flagged
-- them). Signed-in users keep EXECUTE. The two public iPad functions (cost_bar_menu, cost_bar_premix, cost_kitchen_data)
-- stay public on purpose: they return display fields only, never prices.
revoke execute on function public.cost_is_allowed() from public, anon;
revoke execute on function public.cost_is_owner() from public, anon;
grant execute on function public.cost_is_allowed() to authenticated, service_role;
grant execute on function public.cost_is_owner() to authenticated, service_role;
