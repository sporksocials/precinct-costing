import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Troy (5 Oct 2026): keep the ordering process as simple as possible and be good at what we say no to. These are the things
 * that were taken out of the order and count screens, so they are not put back by accident.
 */
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("the order screen stays simple", () => {
  const card = read("components/ordering/orders/order-card.tsx");
  const panel = read("components/ordering/orders/send-panel.tsx");
  const lines = read("components/ordering/orders/line-editor.tsx");
  const screen = read("components/ordering/orders/orders-screen.tsx");

  it("has no Show Order Text preview (the lines and the email draft are the preview)", () => {
    expect(panel).not.toMatch(/Show Order Text|Hide Order Text/);
  });
  it("has no per-order price switch (prices follow the supplier's own setting)", () => {
    expect(card).not.toMatch(/Show Prices On This Order|setShowPrices/);
    expect(card).toMatch(/const showPrices = supplier\.show_prices_on_order/);
  });
  it("has no Hide button on a supplier card", () => {
    expect(card).not.toMatch(/"Hide"|>Hide</);
  });
  it("has no rep name, rep phone or account number in the card header", () => {
    expect(card).not.toMatch(/rep_name|rep_phone|account_no/);
  });
  it("has no way-sent question in Mark As Sent", () => {
    expect(card).not.toMatch(/How did you send it|SEND_METHOD_OPTIONS|chosenMethod|ChoiceChips/);
    expect(card).toMatch(/Mark This Order As Sent\?/);
    expect(card).toMatch(/defaultSendMethod\(lastAction, supplier\.method\)/);
  });
  it("has no separate Suggested text and no ex GST on a line", () => {
    expect(lines).not.toMatch(/Suggested|ex GST/);
  });
  it("has no earlier-counts chips (orders use the latest finished count)", () => {
    expect(screen).not.toMatch(/Choose a finished count|ChoiceChips|countChips/);
    expect(screen).toMatch(/Edit Count/);
  });
});

describe("the Finish Count sheet stays simple", () => {
  const sheet = read("components/ordering/count/review-sheet.tsx");
  it("lists only what is not counted", () => {
    expect(sheet).toMatch(/title="Not Counted"/);
    expect(sheet).not.toMatch(/Over Build To|One Place Blank/);
    expect(sheet).toMatch(/Finish And Go To Orders/);
  });
  it("never blocks finishing on uncounted products", () => {
    expect(sheet).not.toMatch(/disabled=\{[^}]*uncounted/);
  });
});
