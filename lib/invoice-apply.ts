/**
 * STUB, NOT THE REAL MODULE. Agent D owns lib/invoice-apply.ts; the orchestrator overwrites this file with D's version.
 * It exists only so the screens in this worktree type-check. Signatures are exactly the ones in lib/invoice-interfaces.ts.
 */
import type { ApplyDocumentAuto, ApplyLine, UndoChange, UndoDocument } from "./invoice-interfaces";

const notBuilt = (name: string): never => {
  throw new Error(`${name} is not built yet (stub)`);
};

export const applyLine: ApplyLine = async () => notBuilt("applyLine");
export const applyDocumentAuto: ApplyDocumentAuto = async () => notBuilt("applyDocumentAuto");
export const undoChange: UndoChange = async () => notBuilt("undoChange");
export const undoDocument: UndoDocument = async () => notBuilt("undoDocument");
