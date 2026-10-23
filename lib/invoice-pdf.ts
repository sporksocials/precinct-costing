/** PDF page counting and splitting for the invoice reader (pdf-lib, pure JavaScript, no native code). SERVER ONLY in practice. */
import { PDFDocument } from "pdf-lib";

/** Raised for a file that is not a readable PDF or a page list that does not fit it. The message is safe to show. */
export class PdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfError";
  }
}

async function open(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    throw new PdfError("That file is not a PDF the reader can open.");
  }
}

/** Number of pages in a PDF. */
export async function countPages(bytes: Uint8Array): Promise<number> {
  return (await open(bytes)).getPageCount();
}

/** A new PDF holding the given 1-based pages of `bytes`, in the order listed. */
export async function splitPages(bytes: Uint8Array, pages: number[]): Promise<Uint8Array> {
  if (pages.length === 0) throw new PdfError("There are no pages to split out.");
  const src = await open(bytes);
  const n = src.getPageCount();
  for (const p of pages) {
    if (!Number.isInteger(p) || p < 1 || p > n) throw new PdfError(`Page ${p} is not in this file (it has ${n}).`);
  }
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, pages.map((p) => p - 1));
  copied.forEach((pg) => out.addPage(pg));
  return out.save();
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
