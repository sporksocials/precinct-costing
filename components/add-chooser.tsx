"use client";

import { ChevronLeft } from "lucide-react";
import { ADD_CHOICES, type AddChoice } from "@/lib/add-choices";
import { Sheet } from "./ui";

/**
 * Step one of adding to the Menu: what is being added. One tap on a tile goes straight to that form (no Next button).
 * Tiles are two to a row at every width (a 390px phone and the 448px desktop sheet alike), so nothing scrolls sideways,
 * and every tile is at least 56px high (the 44px tap rule has room to spare).
 */
export function AddChooserSheet({ onPick, onClose, hide }: { onPick: (choice: AddChoice) => void; onClose: () => void; hide?: (choice: AddChoice) => boolean }) {
  const choices = ADD_CHOICES.filter((c) => !hide?.(c));
  return (
    <Sheet open onClose={onClose} title="What Are You Adding?">
      <div className="grid grid-cols-2 gap-2.5 pb-2 pt-3" role="group" aria-label="What are you adding">
        {choices.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onPick(c)}
            className="flex min-h-[56px] items-center justify-center rounded-xl bg-fill px-3 py-2 text-center text-[17px] font-semibold leading-tight text-label transition active:scale-[0.98] active:opacity-80 hover:bg-fill-2 sm:text-[15px]"
          >
            {c.label}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** "Back" at the top of a form opened from the chooser: returns to the chooser (Cancel still closes the sheet). 44px at every width. */
export function SheetBack({ onClick, label = "Back" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="-ml-1 inline-flex min-h-[44px] items-center pr-3 text-[17px] text-accent active:opacity-60 sm:text-[15px]">
      <ChevronLeft className="h-6 w-6" strokeWidth={2.25} aria-hidden />
      {label}
    </button>
  );
}
