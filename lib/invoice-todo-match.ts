// placeholder: the orchestrator overwrites this with the real file
export interface MatchCounts {
  items: number;
  suppliers: number;
}
export function useMatchCounts(venue: string | null): { data: MatchCounts | null; loading: boolean; reload: () => void } {
  void venue;
  return { data: null, loading: false, reload: () => {} };
}
