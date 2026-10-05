import { describe, expect, it } from "vitest";
import {
  MAX_LINK_LENGTH,
  buildOrderText,
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
    expect(t.body).toBe(["Hi Mark,", "", "Order for Drift, account A1001:", "", "Pink Dot - 36 ctns", "Jim Beam - 6 bottles", "", "Thanks,", "Troy"].join("\n"));
  });
  it("with prices: item code, ex and inc GST on each line, then both totals", () => {
    const t = buildOrderText({ venueName: "Drift", supplier: star, lines, showPrices: true, senderName: "Troy" });
    expect(t.body).toBe(
      [
        "Hi Mark,",
        "",
        "Order for Drift, account A1001:",
        "",
        "Pink Dot - 36 ctns (item 170240) @ $26.82 ex GST / $29.50 inc GST = $965.45 ex GST / $1,062.00 inc GST",
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
    expect(t.body).not.toMatch(/\$|GST|item/);
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
  it("flags a link over about 1900 characters", () => {
    const many: OrderTextLine[] = Array.from({ length: 60 }, (_, i) => ({ product_name: `Some Longer Spirit Name Number ${i}`, ordered_qty: 6, unit_name: "bottle", price_inc_gst: null }));
    const big = buildOrderText({ venueName: "Drift", supplier: star, lines: many, showPrices: false });
    expect(mailtoUrl({ to: "a@b.com", subject: big.subject, body: big.body }).tooLong).toBe(true);
    expect(outlookWebUrl({ to: "a@b.com", subject: big.subject, body: big.body }).tooLong).toBe(true);
    expect(mailtoUrl({ to: "a@b.com", subject: "S", body: "x".repeat(MAX_LINK_LENGTH) }).tooLong).toBe(true);
    expect(mailtoUrl({ to: "a@b.com", subject: "S", body: "short" }).tooLong).toBe(false);
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
