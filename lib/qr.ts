/**
 * QR codes for the printed Allergy Matrix footer (Troy, 10 Oct 2026). The encoder is `qrcode-generator` (MIT, no dependencies,
 * about 20 KB), loaded by dynamic import so it only reaches the browser on the print page. Error correction M (a laminated, slightly
 * scuffed sheet still scans). `tests/qr.test.ts` decodes the result with `jsqr` and checks it holds exactly the address it was given.
 */

/** The dark modules of the code, row by row (true = dark). The quiet zone is NOT included; `qrSvg` adds it. */
export async function qrModules(text: string): Promise<boolean[][]> {
  const { default: qrcode } = await import("qrcode-generator");
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** One SVG path for every dark module, joining runs along a row so the markup stays small. */
export function qrPath(modules: readonly (readonly boolean[])[], quiet = 2): string {
  const parts: string[] = [];
  modules.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      let run = 1;
      while (x + run < row.length && row[x + run]) run += 1;
      parts.push(`M${x + quiet} ${y + quiet}h${run}v1h-${run}z`);
      x += run;
    }
  });
  return parts.join("");
}

/** Side length in modules including the quiet zone on both sides. */
export function qrSize(modules: readonly (readonly boolean[])[], quiet = 2): number {
  return modules.length + quiet * 2;
}

/** The code as pixels (RGBA, black on white) for tests and anything that wants a bitmap. `scale` pixels per module, `quiet` modules of white all round. */
export function qrBitmap(modules: readonly (readonly boolean[])[], scale = 8, quiet = 4): { data: Uint8ClampedArray; width: number; height: number } {
  const side = (modules.length + quiet * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  modules.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const i = (((r + quiet) * scale + dy) * side + (c + quiet) * scale + dx) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
    }),
  );
  return { data, width: side, height: side };
}
