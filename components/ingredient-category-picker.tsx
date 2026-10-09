"use client";

/**
 * Ingredient category pick-list, two shapes of the same thing:
 *  - CategoryChips: a visible, wrapping group of chips under four small labels, for the New Ingredient sheet.
 *  - CategoryPickerSheet: a grouped list with a tick on the current one, for the ingredient page.
 * Every control is at least 44px high at EVERY width (the shared Chips and .btn shrink at sm:, so they are not used here).
 * A stored value that is not in the list is shown as it is, under "Not In The List", and never rewritten.
 */
import { categoriesByGroup, isListedCategory } from "@/lib/ingredient-categories";
import { cx, Row, Sheet } from "./ui";

const GROUP_LABEL = "px-1 pb-1.5 text-[13px] font-medium text-label-2";

export function CategoryChips({ value, onChange, extra, className }: { value: string; onChange: (v: string) => void; extra?: string | null; className?: string }) {
  const unlisted = extra && !isListedCategory(extra) ? extra : null;
  const chip = (name: string) => {
    const on = name === value;
    return (
      <button
        key={name}
        type="button"
        role="radio"
        aria-checked={on}
        onClick={() => onChange(name)}
        className={cx(
          "min-h-[44px] max-w-full rounded-full px-4 text-left text-[15px] font-medium transition-[background-color,color,transform] duration-200 ease-ios active:scale-[0.97]",
          on ? "bg-accent-fill text-accent-on" : "bg-surface text-label shadow-[inset_0_0_0_0.5px_var(--separator)] hover:bg-surface-2",
        )}
      >
        {name}
      </button>
    );
  };
  return (
    <div role="radiogroup" aria-label="Category" className={cx("space-y-3", className)}>
      {categoriesByGroup().map((g) => (
        <div key={g.group} role="group" aria-label={g.group}>
          <p className={GROUP_LABEL}>{g.group}</p>
          <div className="flex flex-wrap gap-2">{g.names.map(chip)}</div>
        </div>
      ))}
      {unlisted ? (
        <div role="group" aria-label="Not In The List">
          <p className={GROUP_LABEL}>Not In The List</p>
          <div className="flex flex-wrap gap-2">{chip(unlisted)}</div>
        </div>
      ) : null}
    </div>
  );
}

export function CategoryPickerSheet({ open, value, onPick, onClose }: { open: boolean; value: string; onPick: (v: string) => void; onClose: () => void }) {
  const unlisted = !isListedCategory(value) && value.trim() ? value : null;
  return (
    <Sheet open={open} onClose={onClose} title="Category" cancelLabel={null} action={{ label: "Done", onClick: onClose }}>
      <div className="space-y-4 pb-2 pt-3">
        {unlisted ? (
          <div>
            <p className={GROUP_LABEL}>Not In The List</p>
            <div className="group-list">
              <Row title={unlisted} onClick={onClose} trailing={<span className="text-accent">✓</span>} />
            </div>
          </div>
        ) : null}
        {categoriesByGroup().map((g) => (
          <div key={g.group}>
            <p className={GROUP_LABEL}>{g.group}</p>
            <div className="group-list">
              {g.names.map((name) => (
                <Row key={name} title={name} onClick={() => onPick(name)} trailing={value === name ? <span className="text-accent">✓</span> : null} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
