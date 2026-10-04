import type { GlassType } from "@/lib/bar";

/** Line icon of a glass (stroke only, currentColor). Shapes from the approved bar display design. */
export function GlassIcon({ type, size = 22, className }: { type: GlassType; size?: number; className?: string }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {type === "martini" ? (
        <>
          <path d="M4 4 L20 4 L12 13 Z" />
          <line x1="12" y1="13" x2="12" y2="20" />
          <line x1="8" y1="20" x2="16" y2="20" />
        </>
      ) : type === "highball" ? (
        <>
          <rect x="7" y="4" width="10" height="16" rx="1.5" />
          <line x1="7" y1="9" x2="17" y2="9" />
        </>
      ) : type === "coupe" ? (
        <>
          <path d="M4 6 Q12 15 20 6" />
          <line x1="12" y1="15" x2="12" y2="20" />
          <line x1="8" y1="20" x2="16" y2="20" />
        </>
      ) : type === "wine" ? (
        <>
          <path d="M6 5 C6 12 8 15 12 15 C16 15 18 12 18 5 Z" />
          <line x1="12" y1="15" x2="12" y2="20" />
          <line x1="8" y1="20" x2="16" y2="20" />
        </>
      ) : (
        <>
          <rect x="5" y="9" width="14" height="11" rx="1.5" />
          <line x1="5" y1="13" x2="19" y2="13" />
        </>
      )}
    </svg>
  );
}

/** Line icon of a labelled bottle, for the Pre-Mix Bottles row and cards. Same stroke style as the glasses. */
export function BottleIcon({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10 3 H14 M10.5 3 V7 C10.5 8.5 8 9 8 12 V20 A1 1 0 0 0 9 21 H15 A1 1 0 0 0 16 20 V12 C16 9 13.5 8.5 13.5 7 V3" />
      <rect x="8" y="13" width="8" height="5" rx="0.5" />
    </svg>
  );
}
