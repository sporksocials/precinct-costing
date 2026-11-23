import { describe, expect, it } from "vitest";
import {
  MAX_LINK_LENGTH,
  buildOrderText,
  codeSuffix,
  cleanEmailList,
  cleanUrl,
  firstName,
  mailtoUrl,
  methodFromLabel,
  outlookWebUrl,
  parseContactValue,
  plainText,
  qtyWithUnit,
  supplierMethodFromContact,
  toCrlf,
} from "@/lib/ordering";
import type { OrderTextLine } from "@/lib/ordering-types";

const star = { rep_name: "Mark Holden", account_no: "A1001" };
const lines: OrderTextLine[] = [
  { product_name: "Pink Dot", ordered_qty: 36, unit_name: "carton", supplier_item_code: "170240", price_inc_gst: 29.5 },
  { product_name: "Jim Beam", ordered_qty: 6, unit_name: "bottle", supplier_item_code: null, price_inc_gst: 45 },
];

describe("buildOrderText", () => {
  it("is Hi, the venue and account, one line per product, thanks and the sender", () => {
    const t = buildOrderText({ venueName: "Drift", supplier: star, lines, showPrices: false, senderName: "Troy" });
    expect(t.subject).toBe("Drift Order");
    expect(t.body).toBe(["Hi Mark,", "", "Order for Drift, account A1001:", "", "Pink Dot - 36 ctns #170240", "Jim Beam - 6 bottles", "", "Thanks,", "Troy"].join("\n"));
  });
  it("a line with an item code ends with it, a line without one has nothing added", () => {
    const t = buildOrderText({ venueName: "Drift", supplier: star, lines, showPrices: false });
    expect(t.body).toContain("\nPink Dot - 36 ctns #170240\n");
    expect(t.body).toContain("\nJim Beam - 6 bottles\n");
    expect(codeSuffix("150012")).toBe(" #150012");
    expect(codeSuffix(" BF-12 ")).toBe(" #BF-12");
    expect(codeSuffix(null)).toBe("");
    expect(codeSuffix("   ")).toBe("");
    // a blank code never leaves a stray mark on the line
    const blank = buildOrderText({ venueName: "Drift", supplier: star, lines: [{ ...lines[0], supplier_item_code: "  " }], showPrices: false });
    expect(blank.body).toContain("\nPink Dot - 36 ctns\n");
    expect(blank.body).not.toContain("#");
  });
  it("with prices: item code, ex and inc GST on each line, then both totals", () => {
    const t = buildOrderText({ venueName: "Drift", supplier: star, lines, showPrices: true, senderName: "Troy" });
    expect(t.body).toBe(
      [
        "Hi Mark,",
        "",
        "Order for Drift, account A1001:",
        "",
        "Pink Dot - 36 ctns #170240 @ $26.82 ex GST / $29.50 inc GST = $965.45 ex GST / $1,062.00 inc GST",
        "Jim Beam - 6 bottles @ $40.91 ex GST / $45.00 inc GST = $245.45 ex GST / $270.00 inc GST",
        "",
        "Total ex GST: $1,210.91",
        "Total inc GST: $1,332.00",
        "",
        "Thanks,",
        "Troy",
      ].join("\n"),
    );
  });
  it("prices stay out of the text when the switch is off, even if products have prices", () => {
    const t = buildOrderText({ venueName: "Drift", supplier: star, lines, showPrices: false });
    expect(t.body).not.toMatch(/\$|GST|item|paid|free/);
    expect(t.body).not.toMatch(/\d\.\d\d/); // no money amount in any form
  });
  it("a GST free line with prices on: ex is the same as inc, and the totals add each line on its own", () => {
    const t = buildOrderText({ venueName: "Drift", supplier: star, lines: [lines[1], { product_name: "Soda Water (24 x 300ml)", ordered_qty: 2, unit_name: "carton", price_inc_gst: 20, gst_free: true }], showPrices: true });
    expect(t.body).toContain("Soda Water (24 x 300ml) - 2 ctns @ $20.00 ex GST / $20.00 inc GST = $40.00 ex GST / $40.00 inc GST");
    expect(t.body).toContain("Total ex GST: $285.45"); // 245.45 + 40.00, not 310 / 1.1
    expect(t.body).toContain("Total inc GST: $310.00");
  });
  it("leaves out the rep name, the account and the sender when there are none", () => {
    const t = buildOrderText({ venueName: "Greedy", supplier: { rep_name: null, account_no: null }, lines: [lines[1]], showPrices: false });
    expect(t.subject).toBe("Greedy Order");
    expect(t.body).toBe(["Hi,", "", "Order for Greedy:", "", "Jim Beam - 6 bottles", "", "Thanks,"].join("\n"));
  });
  it("skips lines with no quantity", () => {
    const t = buildOrderText({ venueName: "Drift", supplier: star, lines: [...lines, { product_name: "Zero", ordered_qty: 0, unit_name: "carton", price_inc_gst: 5 }], showPrices: true });
    expect(t.body).not.toContain("Zero");
  });
  it("says so when a line has no price instead of guessing", () => {
    const t = buildOrderText({ venueName: "Drift", supplier: star, lines: [lines[0], { product_name: "Mystery", ordered_qty: 2, unit_name: "carton", price_inc_gst: null }], showPrices: true });
    expect(t.body).toContain("Mystery - 2 ctns\n");
    expect(t.body).toContain("Total inc GST: $1,062.00");
    expect(t.body).toContain("(1 item has no price and is not in the total.)");
  });
  it("never contains an em or en dash, even if a product name does", () => {
    const t = buildOrderText({ venueName: "Drift", supplier: { rep_name: "Mark", account_no: "1–2" }, lines: [{ product_name: "Pete’s — Prosecco – Brut", ordered_qty: 4, unit_name: "carton", price_inc_gst: null }], showPrices: false, senderName: "Troy" });
    expect(t.body).not.toMatch(/[—–]/);
    expect(t.body).toContain("Pete’s - Prosecco - Brut - 4 ctns");
    expect(t.subject).not.toMatch(/[—–]/);
  });
  it("pluralises units", () => {
    expect(qtyWithUnit(1, "carton")).toBe("1 ctn");
    expect(qtyWithUnit(3, "carton")).toBe("3 ctns");
    expect(qtyWithUnit(1, "Ctn")).toBe("1 ctn");
    expect(qtyWithUnit(1, "keg")).toBe("1 keg");
    expect(qtyWithUnit(4, "keg")).toBe("4 kegs");
    expect(qtyWithUnit(1, "bag")).toBe("1 bag");
    expect(qtyWithUnit(2, "bag")).toBe("2 bags");
    expect(qtyWithUnit(6, "bottle")).toBe("6 bottles");
    expect(qtyWithUnit(1, "bottle")).toBe("1 bottle");
    expect(qtyWithUnit(2, "box")).toBe("2 boxes");
    expect(qtyWithUnit(5, null)).toBe("5");
    expect(qtyWithUnit(2.5, "keg")).toBe("2.5 kegs");
  });
  it("reads the rep's first name", () => {
    expect(firstName("Mark Holden")).toBe("Mark");
    expect(firstName("Dan G")).toBe("Dan");
    expect(firstName("  Jess ")).toBe("Jess");
    expect(firstName(null)).toBeNull();
    expect(firstName("")).toBeNull();
  });
  it("plainText tidies dashes and spaces", () => {
    expect(plainText("a —  b")).toBe("a - b");
    expect(plainText(null)).toBe("");
  });
});

describe("delivery links", () => {
  const t = buildOrderText({ venueName: "Drift", supplier: star, lines, showPrices: false, senderName: "Troy" });
  it("mailto uses %0D%0A line breaks and encodes the subject and body", () => {
    const m = mailtoUrl({ to: "orders@star.example.com", subject: t.subject, body: t.body });
    expect(m.tooLong).toBe(false);
    expect(m.url.startsWith("mailto:orders@star.example.com?subject=Drift%20Order&body=Hi%20Mark%2C%0D%0A%0D%0AOrder%20for%20Drift")).toBe(true);
    expect(m.url).not.toMatch(/[\r\n ]/);
    expect(decodeURIComponent(m.url.split("&body=")[1])).toBe(toCrlf(t.body));
  });
  it("handles \\r\\n input without doubling the breaks", () => {
    const m = mailtoUrl({ to: "a@b.com", subject: "S", body: "one\r\ntwo\nthree" });
    expect(m.url.endsWith("one%0D%0Atwo%0D%0Athree")).toBe(true);
  });
  it("takes several addresses and tidies them", () => {
    expect(mailtoUrl({ to: "a@x.com; b@y.com ", subject: "S", body: "B" }).url.startsWith("mailto:a@x.com,b@y.com?")).toBe(true);
    expect(mailtoUrl({ to: null, subject: "S", body: "B" }).url.startsWith("mailto:?subject=S")).toBe(true);
  });
  /**
   * THE EMAIL SIZE PROBLEM (Troy: "there was an email size problem we had which is why we removed certain things on the
   * supplier order emails, so keep this in mind"). A mailto link much over 1900 characters would not open, so a long order
   * copies itself and opens an empty draft (tooLong, shortUrl), and prices were taken out of all order text on 29 Oct 2026.
   * Putting the item code back (and the size, which is in the full ingredient name) makes each line longer, so the code is
   * written in its shortest clear form. A typical line was 42 characters (56 in the link) and is now 58 (78 in the link).
   */
  const TYPICAL: [string, number, string, string][] = [
    ["Bombay Sapphire London Dry Gin (700ml)", 6, "bottle", "150012"],
    ["Jack Daniel's Old No. 7 (700ml)", 6, "bottle", "130031"],
    ["Captain Morgan Spiced Gold (700ml)", 6, "bottle", "161050"],
    ["Grey Goose Vodka (700ml)", 6, "bottle", "152210"],
    ["Canadian Club Whisky (700ml)", 12, "bottle", "131044"],
    ["De Kuyper Triple Sec (500ml)", 6, "bottle", "180233"],
    ["Great Northern Super Crisp Keg (49.5L)", 9, "keg", "410233"],
    ["Corona Extra Stubbies (24 x 355ml)", 4, "carton", "401120"],
    ["Mud House Sauvignon Blanc (750ml)", 3, "carton", "520031"],
    ["Smirnoff Red Label Vodka (1L)", 12, "bottle", "152001"],
    ["Bundaberg Original Rum (700ml)", 6, "bottle", "160020"],
    ["Suntory Toki Whisky (700ml)", 2, "bottle", "133870"],
  ];
  const typical = (n: number): OrderTextLine[] => Array.from({ length: n }, (_, i) => TYPICAL[i % TYPICAL.length]).map(([product_name, ordered_qty, unit_name, supplier_item_code]) => ({ product_name, ordered_qty, unit_name, supplier_item_code, price_inc_gst: 51.37 }));
  const TO = "orders@starliquor.example.com";

  it("the item code is written in the shortest clear form: a typical line grows from 42 to 58 characters (56 to 78 in the link)", () => {
    const before = "Bombay Sapphire London Dry Gin - 6 bottles";
    const after = buildOrderText({ venueName: "Drift", supplier: star, lines: typical(1), showPrices: false }).body.split("\n")[4];
    expect(after).toBe("Bombay Sapphire London Dry Gin (700ml) - 6 bottles #150012");
    expect([before.length, encodeURIComponent(before).length]).toEqual([42, 56]);
    expect([after.length, encodeURIComponent(after).length]).toEqual([58, 78]);
    // square brackets would cost 3 more characters a line in the link
    expect(encodeURIComponent(`${before.replace(" - ", " (700ml) - ")} [150012]`).length).toBe(81);
  });
  it("a typical 12 line order with sizes and item codes stays well under the limit, so Open Email still opens it whole", () => {
    const t = buildOrderText({ venueName: "Drift", supplier: star, lines: typical(12), showPrices: false, senderName: "Matt" });
    const m = mailtoUrl({ to: TO, subject: t.subject, body: t.body });
    expect(m.tooLong).toBe(false);
    expect(m.url.length).toBeLessThan(1200);
    expect(m.url.length).toBeLessThan(MAX_LINK_LENGTH);
    expect(decodeURIComponent(m.url.split("&body=")[1])).toBe(toCrlf(t.body));
    expect(t.body.split("\n").filter((l) => /#\d{6}$/.test(l))).toHaveLength(12);
    // and a 20 line order still fits
    const twenty = buildOrderText({ venueName: "Drift", supplier: star, lines: typical(20), showPrices: false, senderName: "Matt" });
    expect(mailtoUrl({ to: TO, subject: twenty.subject, body: twenty.body }).tooLong).toBe(false);
  });
  it("a 60 line order with codes takes the long order path: too long is flagged and the short draft has the address and subject only", () => {
    const t = buildOrderText({ venueName: "Drift", supplier: star, lines: typical(60), showPrices: false, senderName: "Matt" });
    expect(t.body.split("\n").filter((l) => l.includes(" #"))).toHaveLength(60);
    const m = mailtoUrl({ to: TO, subject: t.subject, body: t.body });
    expect(m.tooLong).toBe(true);
    expect(m.url.length).toBeGreaterThan(MAX_LINK_LENGTH);
    expect(m.shortUrl).toBe("mailto:orders@starliquor.example.com?subject=Drift%20Order");
    expect(m.shortUrl).not.toContain("body=");
    expect(m.shortUrl.length).toBeLessThan(100);
  });
  it("no price ever reaches the text, however the lines are priced", () => {
    const t = buildOrderText({ venueName: "Drift", supplier: star, lines: typical(12).map((l) => ({ ...l, deal_buy_qty: 5, deal_free_qty: 1 })), showPrices: false, senderName: "Matt" });
    expect(t.body).not.toMatch(/\$|GST|51\.37|paid|free/);
    expect(t.body).not.toMatch(/[\u2013\u2014]/);
  });
  it("flags a link over about 1900 characters", () => {
    const many: OrderTextLine[] = Array.from({ length: 60 }, (_, i) => ({ product_name: `Some Longer Spirit Name Number ${i}`, ordered_qty: 6, unit_name: "bottle", price_inc_gst: null }));
    const big = buildOrderText({ venueName: "Drift", supplier: star, lines: many, showPrices: false });
    expect(mailtoUrl({ to: "a@b.com", subject: big.subject, body: big.body }).tooLong).toBe(true);
    expect(outlookWebUrl({ to: "a@b.com", subject: big.subject, body: big.body }).tooLong).toBe(true);
    expect(mailtoUrl({ to: "a@b.com", subject: "S", body: "x".repeat(MAX_LINK_LENGTH) }).tooLong).toBe(true);
    expect(mailtoUrl({ to: "a@b.com", subject: "S", body: "short" }).tooLong).toBe(false);
    // the short draft never carries the body, so it opens however long the order is
    const long = mailtoUrl({ to: "a@b.com", subject: "S", body: "x".repeat(20000) });
    expect(long.shortUrl).toBe("mailto:a@b.com?subject=S");
    expect(outlookWebUrl({ to: "a@b.com", subject: "S", body: "x".repeat(20000) }).shortUrl).toBe("https://outlook.office.com/mail/deeplink/compose?to=a%40b.com&subject=S");
  });
  it("Outlook on the web deep link", () => {
    const o = outlookWebUrl({ to: "orders@star.example.com", subject: t.subject, body: t.body });
    expect(o.url.startsWith("https://outlook.office.com/mail/deeplink/compose?to=orders%40star.example.com&subject=Drift%20Order&body=Hi%20Mark%2C%0D%0A")).toBe(true);
    expect(o.tooLong).toBe(false);
  });
});

describe("supplier contact values", () => {
  it("an email address means email", () => {
    expect(supplierMethodFromContact("sales@diabloco.com.au")).toBe("email");
    expect(supplierMethodFromContact("mailto:a@b.com")).toBe("email");
    expect(supplierMethodFromContact("a@b.com; c@d.com")).toBe("email");
    expect(supplierMethodFromContact("tim.@purewine.co")).toBe("email"); // a typo in the workbook still reads as email
  });
  it("a web address means website", () => {
    expect(supplierMethodFromContact("https://my.lionco.com/login?next=/orders/1")).toBe("website");
    expect(supplierMethodFromContact("http://x.com")).toBe("website");
    expect(supplierMethodFromContact("www.mycca.com.au")).toBe("website");
  });
  it("anything else is unknown", () => {
    expect(supplierMethodFromContact("")).toBeNull();
    expect(supplierMethodFromContact(null)).toBeNull();
    expect(supplierMethodFromContact("call Jason")).toBeNull();
  });
  it("cleans values", () => {
    expect(cleanEmailList(" A@x.com ;b@y.com,")).toBe("A@x.com, b@y.com");
    expect(cleanEmailList("no email here")).toBeNull();
    expect(cleanUrl("www.x.com/a")).toBe("https://www.x.com/a");
    expect(cleanUrl("https://x.com")).toBe("https://x.com");
    expect(cleanUrl("a@b.com")).toBeNull();
    expect(cleanUrl("two words")).toBeNull();
  });
  it("splits a contact value into where it belongs", () => {
    expect(parseContactValue("sales@diabloco.com.au")).toEqual({ method: "email", email_to: "sales@diabloco.com.au", login_url: null });
    expect(parseContactValue("www.lionco.com")).toEqual({ method: "website", email_to: null, login_url: "https://www.lionco.com" });
    expect(parseContactValue("nothing")).toEqual({ method: null, email_to: null, login_url: null });
  });
  it("reads the workbook's Method column", () => {
    expect(methodFromLabel("E-mail")).toBe("email");
    expect(methodFromLabel("Online")).toBe("website");
    expect(methodFromLabel("App")).toBe("app");
    expect(methodFromLabel(" ")).toBeNull();
  });
});
