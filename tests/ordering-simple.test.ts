import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
  it("has no price switch at all, per order or per supplier: a line shows its price whenever there is one (changed on purpose, 23 Nov 2026)", () => {
    expect(card).not.toMatch(/Show Prices On This Order|setShowPrices|show_prices_on_order|showPrices=\{/);
    expect(lines).not.toMatch(/show_prices_on_order/);
    // the screen decides from the lines themselves, and the order is always saved as "prices not in the text"
    expect(lines).toMatch(/const showPrices = lines\.some\(\(l\) => l\.price != null \|\| l\.noPrice\)/);
    expect(card).toMatch(/showPrices: false, lines: draftsToOrderLines\(lines\)/);
    expect(card).toMatch(/warningText: send\.warning, showPrices: false/);
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

/**
 * ONE CARD PER PRODUCT (Troy, 23 Nov 2026). The order item is a thin per-venue shell and the ingredient page is its only
 * editor. These are the pieces that were taken out that day, so they are not put back by accident: the product page's
 * inputs, Add Product with a typed name, Copy Products From Another Venue, Other Supplier, Change Ingredient / Remove Link
 * and the supplier's Show Prices On Order switch.
 */
describe("order items stay thin", () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of readdirSync(join(__dirname, "..", dir))) {
      const p = join(dir, e);
      if (statSync(join(__dirname, "..", p)).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(e)) out.push(p);
    }
    return out;
  };
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const ORDERING_SCREENS = [...walk("components/ordering"), ...walk("app/(app)/ordering"), "components/ingredient-ordering.tsx"];
  const productPage = read("app/(app)/ordering/[venue]/setup/products/[id]/page.tsx");
  const productList = read("app/(app)/ordering/[venue]/setup/products/page.tsx");
  const supplierPage = read("app/(app)/ordering/[venue]/setup/suppliers/[id]/page.tsx");

  it("the product page has no inputs: it sends the person to the ingredient, or shows the read-only fallback card", () => {
    expect(productPage).not.toMatch(/TextField|TouchChips|ChoiceBlock|IngredientPickerSheet/);
    expect(productPage).not.toMatch(/Build To \(/);
    expect(productPage).toContain("router.replace(goTo)");
    expect(productPage).toContain("NEEDS_INGREDIENT");
    // the one thing still switched there is Active, for an old item with no ingredient
    expect(productPage).toContain("<ActiveSwitch");
    expect(productPage).toContain("Nothing here can be edited");
  });
  it("there is no Change Ingredient, Remove Link or Link An Ingredient anywhere", () => {
    for (const f of ORDERING_SCREENS) expect(strip(read(f)), f).not.toMatch(/Change Ingredient|Remove Link|Link An Ingredient|Linked Costing Ingredient|ingredient_id: null/);
    expect(existsSync(join(__dirname, "..", "components/ordering/ingredient-picker.tsx"))).toBe(false);
  });
  it("there is no Add Product with a typed name in Setup: a product is added from its ingredient", () => {
    expect(productList).not.toMatch(/TouchAddButton|createProduct|blankProduct|title="Add Product"|Product Name/);
    expect(productList).toContain("Open Ingredients");
    expect(productList).toContain("ingredientOrderingHref(p.ingredient_id)");
    // Setup > Products changes only the shelf order
    expect([...strip(productList).matchAll(/\b(saveSortChanges|updateProduct|createProduct|insertRow)\(/g)].map((m) => m[1])).toEqual(["saveSortChanges"]);
    // (the order card's own "Add Product" adds an existing product to an ORDER, which is a different thing and stays)
    expect(read("components/ordering/orders/order-card.tsx")).toContain("Add Product");
  });
  it("Copy Products From Another Venue is gone: no sheet, no button, no data function", () => {
    expect(existsSync(join(__dirname, "..", "components/ordering/copy-venue-sheet.tsx"))).toBe(false);
    for (const f of [...ORDERING_SCREENS, "lib/ordering-setup.ts", "lib/ordering-screens-data.ts"]) expect(strip(read(f)), f).not.toMatch(/CopyVenueSheet|copyVenueSetup|planVenueCopy|Copy Products|copy another venue/i);
  });
  it("Other Supplier is not shown or written anywhere", () => {
    for (const f of [...ORDERING_SCREENS, "lib/ordering-orders-ui.ts", "lib/ordering-link.ts", "lib/ordering-setup.ts"]) expect(strip(read(f)), f).not.toMatch(/Other Supplier|alt_supplier_name|alt_item_code|alt_price_inc_gst|alt_price_on|supplier-compare|switchNote/);
  });
  it("the supplier's Show Prices On Order switch is gone from Setup > Suppliers", () => {
    expect(supplierPage).not.toMatch(/Show Prices On Order|show_prices_on_order|Order Text/);
  });
  it("no ordering screen writes a product's price, item code, name, supplier, carton size or deal", () => {
    const WRITES = /(?:updateProduct|persist|changeOrderingProduct|saveField)\([^;]*?\b(price_inc_gst|supplier_item_code|costing_packs_per_unit|deal_buy_qty|deal_free_qty|supplier_id|name)\s*:/;
    for (const f of ORDERING_SCREENS) expect(strip(read(f)).match(WRITES)?.[0], f).toBeUndefined();
  });
  it("order emails still never carry prices, and the long order path is kept", () => {
    const ui = read("lib/ordering-orders-ui.ts");
    expect(ui).toContain("showPrices: false, senderName: i.senderName");
    expect(strip(ui)).not.toMatch(/showPrices: (true|i\.showPrices)/);
    expect(ui).toContain("Copy And Open Email");
    expect(ui).toContain("LONG_ORDER_NOTE");
    expect(read("lib/ordering.ts")).toContain("export const MAX_LINK_LENGTH = 1900;");
  });
});
