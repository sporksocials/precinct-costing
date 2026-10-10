import { describe, expect, it } from "vitest";
import jsQR from "jsqr";
import { liveMatrixUrl } from "@/lib/allergy-matrix-print";
import { qrBitmap, qrModules, qrPath, qrSize } from "@/lib/qr";

/** The footer QR code on a printed sheet must open the live iPad matrix. The encoder is qrcode-generator; jsqr (a dev dependency) reads it back. */
describe("the printed sheet's QR code", () => {
  const decode = async (text: string) => {
    const bmp = qrBitmap(await qrModules(text), 6, 4);
    return jsQR(bmp.data, bmp.width, bmp.height)?.data ?? null;
  };

  it("builds the address of the LIVE kitchen matrix for the venue", () => {
    expect(liveMatrixUrl("https://precinct-costing.vercel.app", "drift")).toBe("https://precinct-costing.vercel.app/kitchen/drift/matrix");
    expect(liveMatrixUrl("https://precinct-costing.vercel.app///", "drift")).toBe("https://precinct-costing.vercel.app/kitchen/drift/matrix");
    expect(liveMatrixUrl("http://localhost:3100", "chiobu")).toBe("http://localhost:3100/kitchen/chiobu/matrix");
  });
  it("encodes exactly that address: decoding the code gives the URL back", async () => {
    const url = liveMatrixUrl("https://precinct-costing.vercel.app", "drift");
    expect(await decode(url)).toBe(url);
  });
  it("decodes for every kitchen venue address", async () => {
    for (const slug of ["drift", "chiobu", "greedy", "gelato"]) {
      const url = liveMatrixUrl("https://precinct-costing.vercel.app", slug);
      expect(await decode(url)).toBe(url);
    }
  });
  it("a different address gives a different code", async () => {
    const a = await qrModules(liveMatrixUrl("https://x.test", "drift"));
    const b = await qrModules(liveMatrixUrl("https://x.test", "chiobu"));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
  it("is a square of dark and light modules with a path the sheet can draw", async () => {
    const m = await qrModules("https://precinct-costing.vercel.app/kitchen/drift/matrix");
    expect(m.length).toBeGreaterThanOrEqual(21);
    expect(m.every((row) => row.length === m.length)).toBe(true);
    const path = qrPath(m);
    expect(path.startsWith("M")).toBe(true);
    expect(path).toMatch(/^(M\d+ \d+h\d+v1h-\d+z)+$/);
    expect(qrSize(m)).toBe(m.length + 4);
  });
  it("is loaded by dynamic import, on the print page only", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("lib/qr.ts", "utf8")).toMatch(/await import\("qrcode-generator"\)/);
    expect(readFileSync("lib/qr.ts", "utf8")).not.toMatch(/^import .*qrcode-generator/m);
    const users = ["components/matrix/print-view.tsx"].filter((f) => readFileSync(f, "utf8").includes("@/lib/qr"));
    expect(users).toEqual(["components/matrix/print-view.tsx"]);
    for (const f of ["components/matrix/matrix-page.tsx", "components/kitchen/matrix.tsx", "components/dashboard.tsx"]) expect(readFileSync(f, "utf8")).not.toContain("@/lib/qr");
  });
});
