import { readMarks, readOptions } from "./diet-options";
import type { SignOffState } from "./dish-allergens";

/**
 * "Finish Setting Up This Dish" (Troy, 10 Oct 2026): the checklist at the top of a FOOD dish's page, shown until every step is done.
 * Pure: the editor passes in what the draft holds and draws the rows; each row scrolls to its section.
 *
 *   1 Ingredients Added            at least one ingredient or prep on the recipe
 *   2 Dish Allergens Confirmed     a VALID sign-off (a dish whose ingredients changed since reads "Re-check"; ingredients nobody has
 *                                  checked for allergens block it and are counted in the line under the label)
 *   3 Menu Labels                  informational: "2 set" or "None set" (the GF, V, VG marks and GFO, VO, VGO, DFO options). It is done once the
 *                                  allergens are confirmed (no flag of its own)
 *   4 Kitchen Method Written       at least one assembly step
 *   5 Ready For Kitchen            the head chef's switch is on
 * The first step that is not done is the highlighted one.
 */

export type SetupStepId = "ingredients" | "allergens" | "marks" | "method" | "ready";

export interface SetupStep {
  id: SetupStepId;
  label: string;
  done: boolean;
  /** one short line under the label */
  sub: string;
  /** the element id the row scrolls to */
  anchor: string;
}

export const SETUP_ANCHORS: Record<SetupStepId, string> = {
  ingredients: "setup-ingredients",
  // Dish Allergens and Menu Labels are two blocks of ONE card (Allergens And Dietary); each row goes to its own block
  allergens: "allergens-dietary",
  marks: "menu-labels",
  method: "kitchen-method",
  ready: "kitchen-ready",
};

export interface SetupInput {
  /** ingredient and prep lines with a component chosen */
  lineCount: number;
  signOff: SignOffState;
  /** how many of the dish's ingredients nobody has checked for allergens yet (they block the confirm); 0 or absent = none */
  unreviewed?: number;
  dietOptions: unknown;
  kitchenMethod: readonly string[] | null | undefined;
  kitchenReady: boolean | null | undefined;
}

export interface SetupModel {
  steps: SetupStep[];
  complete: boolean;
  /** the first step not done (the highlighted one), or null when everything is */
  next: SetupStepId | null;
  doneCount: number;
}

/** "2 set" or "None set": the Menu Labels the dish has, its marks (GF, V, VG) and options (GFO, VO, VGO, DFO). */
export function menuLabelsSummary(dietOptions: unknown): string {
  const n = readMarks(dietOptions).length + readOptions(dietOptions).length;
  return n ? `${n} set` : "None set";
}

export function setupModel(i: SetupInput): SetupModel {
  const allergensDone = i.signOff === "valid";
  const methodDone = !!i.kitchenMethod && i.kitchenMethod.some((s) => s.trim());
  const steps: SetupStep[] = [
    { id: "ingredients", label: "Ingredients Added", done: i.lineCount > 0, sub: i.lineCount > 0 ? `${i.lineCount} on the recipe` : "Add what goes in the dish", anchor: SETUP_ANCHORS.ingredients },
    {
      id: "allergens",
      label: "Dish Allergens Confirmed",
      done: allergensDone,
      sub: allergensDone
        ? "Confirmed"
        : i.unreviewed
          ? `${i.unreviewed} ${i.unreviewed === 1 ? "ingredient needs" : "ingredients need"} their allergens checked first`
          : i.signOff === "changed" || i.signOff === "legacy"
            ? "Ingredients changed. Re-check and confirm again"
            : "Check what the ingredients give, then confirm",
      anchor: SETUP_ANCHORS.allergens,
    },
    { id: "marks", label: "Menu Labels", done: allergensDone, sub: menuLabelsSummary(i.dietOptions), anchor: SETUP_ANCHORS.marks },
    { id: "method", label: "Kitchen Method Written", done: methodDone, sub: methodDone ? "Written" : "Add the assembly steps", anchor: SETUP_ANCHORS.method },
    { id: "ready", label: "Ready For Kitchen", done: !!i.kitchenReady, sub: i.kitchenReady ? "On" : "Switch on when the head chef has checked it", anchor: SETUP_ANCHORS.ready },
  ];
  const first = steps.find((s) => !s.done);
  return { steps, complete: !first, next: first?.id ?? null, doneCount: steps.filter((s) => s.done).length };
}
