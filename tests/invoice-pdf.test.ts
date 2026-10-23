import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { PdfError, countPages, splitPages, toBase64 } from "@/lib/invoice-pdf";

/** A PDF generated here: page i says "Page i". No client files. */
async function makePdf(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= n; i++) {
    const page = doc.addPage([300, 200]);
    page.drawText(`Page ${i}`, { x: 20, y: 100, size: 24, font });
  }
  return doc.save();
}

describe("countPages", () => {
  it("counts pages", async () => {
    expect(await countPages(await makePdf(1))).toBe(1);
    expect(await countPages(await makePdf(4))).toBe(4);
  });
  it("refuses something that is not a PDF, in plain words", async () => {
    await expect(countPages(new TextEncoder().encode("hello, not a pdf"))).rejects.toThrow(PdfError);
    await expect(countPages(new Uint8Array())).rejects.toThrow(/not a PDF/);
  });
});

describe("splitPages", () => {
  it("returns a new PDF with just those 1-based pages, in the order asked", async () => {
    const src = await makePdf(4);
    const out = await splitPages(src, [4, 1]);
    expect(await countPages(out)).toBe(2);
    expect(await countPages(src)).toBe(4); // the original is untouched
    // the page sizes survive (all 300 x 200) and the file is a PDF
    const reopened = await PDFDocument.load(out);
    expect(reopened.getPage(0).getSize()).toEqual({ width: 300, height: 200 });
    expect(Buffer.from(out.slice(0, 5)).toString()).toBe("%PDF-");
  });
  it("can pull out a single page, and a run of pages", async () => {
    const src = await makePdf(5);
    expect(await countPages(await splitPages(src, [3]))).toBe(1);
    expect(await countPages(await splitPages(src, [2, 3, 4]))).toBe(3);
  });
  it("refuses pages that are not in the file, or no pages", async () => {
    const src = await makePdf(2);
    await expect(splitPages(src, [3])).rejects.toThrow(/Page 3 is not in this file \(it has 2\)/);
    await expect(splitPages(src, [0])).rejects.toThrow(PdfError);
    await expect(splitPages(src, [1.5])).rejects.toThrow(PdfError);
    await expect(splitPages(src, [])).rejects.toThrow(/no pages/);
  });
});

describe("toBase64", () => {
  it("round-trips", () => {
    const b = new Uint8Array([37, 80, 68, 70]);
    expect(Buffer.from(toBase64(b), "base64").toString()).toBe("%PDF");
  });
});
