import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildPosRows, type PosInput, type PosSheet, type PosVenue } from "@/lib/pos-list";
import { buildPosXlsx, GST_CELL, HEADER_ROW, POS_HEADERS } from "@/lib/pos-list-xlsx";
import type { MenuItem } from "@/lib/types";

const chiobu: PosVenue = { id: 2, slug: "chiobu", name: "Chiobu", short: "Chiobu" };
const drift: PosVenue = { id: 1, slug: "drift", name: "Drift", short: "Drift" };

let n = 0;
const item = (p: Partial<MenuItem> & { name: string }): MenuItem => {
  n += 1;
  return { id: `x${n}`, venue_id: 2, category: "Food", section: null, portions: 1, sell_price_inc: 20, target_override: null, hh_price_inc: null, active: true, source: null, notes: null, ...p };
};

function sheets(): PosSheet[] {
  const input: PosInput = {
    items: [
      item({ name: "roti and satay", section: "Small chow", sell_price_inc: 12 }),
      item({ name: "No Price Dish", section: "Small chow", sell_price_inc: null }),
      item({ name: "House Red - 150ml Glass", category: "Wine", sell_price_inc: 9.5 }),
      item({ name: "House Red - Bottle", category: "Wine", sell_price_inc: 43, hh_price_inc: 38 }),
      item({ name: "Drift Burger", venue_id: 1, sell_price_inc: 25 }),
    ],
    beers: [],
    beerServes: [],
    gelatoServes: [],
  };
  return [
    { venue: drift, rows: buildPosRows(input, 1) },
    { venue: chiobu, rows: buildPosRows(input, 2) },
  ];
}

async function roundTrip(s: PosSheet[], gstRate = 0.1) {
  const buf = await buildPosXlsx(s, { gstRate, dateLabel: "7 Oct 2026" });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  return { wb, buf };
}

describe("POS list workbook", () => {
  it("has one tab per venue named by short name, then Notes", async () => {
    const { wb } = await roundTrip(sheets());
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Drift", "Chiobu", "Notes"]);
  });

  it("writes a title, a subtitle with venue and date, the GST cell and the header row", async () => {
    const { wb } = await roundTrip(sheets());
    const ws = wb.getWorksheet("Chiobu")!;
    expect(ws.getCell("A1").value).toBe("Chiobu POS List");
    expect(String(ws.getCell("A2").value)).toContain("Chiobu");
    expect(String(ws.getCell("A2").value)).toContain("7 Oct 2026");
    expect(ws.getCell("F2").value).toBe("GST rate");
    expect(ws.getCell(GST_CELL).value).toBe(0.1);
    expect(ws.getCell(GST_CELL).numFmt).toBe("0%");
    expect(POS_HEADERS.map((_, i) => ws.getRow(HEADER_ROW).getCell(i + 1).value)).toEqual([...POS_HEADERS]);
  });

  it("freezes the header row and sets widths and an autofilter", async () => {
    const { wb } = await roundTrip(sheets());
    const ws = wb.getWorksheet("Chiobu")!;
    const view = ws.views[0] as { state?: string; ySplit?: number };
    expect(view.state).toBe("frozen");
    expect(view.ySplit).toBe(HEADER_ROW);
    for (let c = 1; c <= 8; c += 1) expect(ws.getColumn(c).width).toBeGreaterThan(10);
    expect(ws.autoFilter).toBeTruthy();
  });

  it("writes ex GST as a real formula off the GST cell, formatted as dollars", async () => {
    const { wb } = await roundTrip(sheets());
    const ws = wb.getWorksheet("Chiobu")!;
    // rows: Small chow (No Price Dish, Roti and Satay alphabetically), Wine (House Red x3)
    const dish = ws.getRow(HEADER_ROW + 2); // Roti and Satay
    expect(dish.getCell(2).value).toBe("Roti and Satay");
    expect(dish.getCell(5).value).toBe(12);
    const f = dish.getCell(6).value as { formula: string; result?: number };
    expect(f.formula).toBe(`E${HEADER_ROW + 2}/(1+$G$2)`);
    expect(f.result).toBeCloseTo(12 / 1.1, 6);
    expect(dish.getCell(5).numFmt).toBe("$#,##0.00");
    expect(dish.getCell(6).numFmt).toBe("$#,##0.00");
  });

  it("highlights a no-price row yellow and leaves the others plain", async () => {
    const { wb } = await roundTrip(sheets());
    const ws = wb.getWorksheet("Chiobu")!;
    const bad = ws.getRow(HEADER_ROW + 1); // No Price Dish
    expect(bad.getCell(2).value).toBe("No Price Dish");
    expect(bad.getCell(8).value).toBe("No price set");
    expect(bad.getCell(6).value).toBeNull();
    for (let c = 1; c <= 8; c += 1) {
      const fill = bad.getCell(c).fill as ExcelJS.FillPattern;
      expect(fill.fgColor?.argb).toBe("FFFFF2A8");
    }
    const ok = ws.getRow(HEADER_ROW + 2);
    expect((ok.getCell(1).fill as ExcelJS.FillPattern).pattern).not.toBe("solid");
  });

  it("writes happy hour and splits wine sizes into their own columns", async () => {
    const { wb } = await roundTrip(sheets());
    const ws = wb.getWorksheet("Chiobu")!;
    const glass = ws.getRow(HEADER_ROW + 3);
    const bottle = ws.getRow(HEADER_ROW + 4);
    expect([glass.getCell(1).value, glass.getCell(2).value, glass.getCell(4).value, glass.getCell(5).value]).toEqual(["Wine", "House Red", "150ml Glass", 9.5]);
    expect([bottle.getCell(4).value, bottle.getCell(5).value, bottle.getCell(7).value]).toEqual(["Bottle", 43, 38]);
  });

  it("changes the formula's rate when the GST cell changes (the cell is the only source)", async () => {
    const { wb } = await roundTrip(sheets(), 0.15);
    const ws = wb.getWorksheet("Chiobu")!;
    expect(ws.getCell(GST_CELL).value).toBe(0.15);
    expect((ws.getRow(HEADER_ROW + 2).getCell(6).value as { formula: string }).formula).toContain("$G$2");
  });

  it("has a Notes tab that explains the file and names no POS vendor path", async () => {
    const { wb } = await roundTrip(sheets());
    const text = (wb.getWorksheet("Notes")!.getColumn(1).values as unknown[]).filter(Boolean).join("\n");
    expect(text).toContain("one row per size");
    expect(text).toContain("time-based price");
    expect(text).toContain("Yellow rows");
    expect(text).toContain("G2");
    expect(text.toLowerCase()).not.toMatch(/toast|http|menus >|bulk/);
    expect(text).not.toMatch(/[–—]/);
  });

  it("contains no cost, GP or target text anywhere in the file", async () => {
    const { wb } = await roundTrip(sheets());
    const all: string[] = [];
    wb.eachSheet((ws) => ws.eachRow((r) => r.eachCell((c) => all.push(typeof c.value === "object" ? JSON.stringify(c.value) : String(c.value)))));
    const text = all.join("\n").toLowerCase();
    for (const bad of ["cost", "gp ", "target", "margin"]) expect(text).not.toContain(bad);
  });

  it("makes a single-venue file with one venue tab plus Notes", async () => {
    const { wb } = await roundTrip([sheets()[1]]);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Chiobu", "Notes"]);
  });
});
