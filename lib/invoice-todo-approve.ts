// placeholder: the orchestrator overwrites this with the real file
export interface ApproveCounts {
  prices: number;
  checks: number;
}
export function useApproveCounts(venue: string | null): { data: ApproveCounts | null; loading: boolean; reload: () => void } {
  void venue;
  return { data: null, loading: false, reload: () => {} };
}
