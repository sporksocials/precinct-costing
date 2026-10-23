/**
 * STUB. Agent D builds the real lib/invoice-apply.ts; the orchestrator will overwrite this file on merge.
 * It exists only so this branch type-checks on its own. Do not rely on it.
 */
import type { ApplyDocumentAuto, ApplyLine, UndoChange, UndoDocument } from "./invoice-interfaces";

const stub = (): never => {
  throw new Error("lib/invoice-apply.ts is a stub in this branch");
};

export const applyLine: ApplyLine = async () => stub();
export const applyDocumentAuto: ApplyDocumentAuto = async () => stub();
export const undoChange: UndoChange = async () => stub();
export const undoDocument: UndoDocument = async () => stub();
