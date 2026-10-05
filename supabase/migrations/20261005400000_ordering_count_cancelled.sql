-- Ordering: a count in progress can be cancelled (set aside, never deleted).
-- A cancelled count frees the "one count in progress per venue" slot, never becomes "last count" and is never used for orders.
-- Who cancelled it and when is in updated_by / updated_at and the Change Log (the sessions table is already tracked).
alter table public.ordering_count_sessions drop constraint if exists ordering_count_sessions_status_check;
alter table public.ordering_count_sessions add constraint ordering_count_sessions_status_check check (status in ('in_progress', 'finalised', 'cancelled'));
