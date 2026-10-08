import { describe, expect, it } from "vitest";
import { sameButSpacing, tidyName, titleCase } from "@/lib/name-tidy";
import { titleCase as posTitleCase } from "@/lib/pos-list";

describe("tidyName", () => {
  it("trims and collapses repeated spaces", () => {
    expect(tidyName("  black   pepper  prawns ")).toBe("Black Pepper Prawns");
    expect(tidyName("\tpork\n belly")).toBe("Pork Belly");
    expect(tidyName("   ")).toBe("");
    expect(tidyName("")).toBe("");
  });

  it("Title Cases, with small words lower case unless first", () => {
    expect(tidyName("pork and prawn wonton")).toBe("Pork and Prawn Wonton");
    expect(tidyName("the best of both")).toBe("The Best of Both");
    expect(tidyName("salt & pepper squid")).toBe("Salt & Pepper Squid");
    expect(tidyName("and then some")).toBe("And Then Some");
    expect(tidyName("chicken with chips")).toBe("Chicken with Chips");
  });

  it("leaves a word that already has a capital in it alone", () => {
    expect(tidyName("WMC riesling")).toBe("WMC Riesling");
    expect(tidyName("McIntyre shiraz")).toBe("McIntyre Shiraz");
    expect(tidyName("heart & Soul rose")).toBe("Heart & Soul Rose");
    expect(tidyName("Heart & Soul Rose")).toBe("Heart & Soul Rose");
    expect(tidyName("ChioBu bao")).toBe("ChioBu Bao");
    expect(tidyName("iPhone case")).toBe("iPhone Case");
  });

  it("keeps ampersands and digits", () => {
    expect(tidyName("heart & soul")).toBe("Heart & Soul");
    expect(tidyName("150ml glass")).toBe("150ml Glass");
    expect(tidyName("2x spring rolls")).toBe("2x Spring Rolls");
    expect(tidyName("slow-cooked beef (3)")).toBe("Slow-Cooked Beef (3)");
    expect(tidyName("house red - 150ml glass")).toBe("House Red - 150ml Glass");
  });

  it("keeps a unit lower case straight after a number", () => {
    expect(tidyName("house red 150 ml glass")).toBe("House Red 150 ml Glass");
    expect(tidyName("flour 25 kg")).toBe("Flour 25 kg");
    expect(tidyName("ml of milk")).toBe("Ml of Milk");
  });

  it("capitalises after a hyphen or slash", () => {
    expect(tidyName("twice-cooked pork")).toBe("Twice-Cooked Pork");
    expect(tidyName("fish/chicken bao")).toBe("Fish/Chicken Bao");
    expect(tidyName("salt/pepper")).toBe("Salt/Pepper");
    expect(tidyName("mix-and-match platter")).toBe("Mix-and-Match Platter");
    expect(tidyName("and/or")).toBe("And/Or");
    expect(tidyName("beef -")).toBe("Beef -");
  });

  it("handles apostrophes and brackets", () => {
    expect(tidyName("chef's special")).toBe("Chef's Special");
    expect(tidyName("o'brien's lager")).toBe("O'Brien's Lager");
    expect(tidyName("(sauv blanc) glass")).toBe("(Sauv Blanc) Glass");
    expect(tidyName("rosé spritz")).toBe("Rosé Spritz");
  });

  it("brings a name typed in capitals down, keeping abbreviations", () => {
    expect(tidyName("BLACK PEPPER PRAWNS")).toBe("Black Pepper Prawns");
    expect(tidyName("BBQ BEEF")).toBe("BBQ Beef");
    expect(tidyName("XXXX GOLD")).toBe("XXXX Gold");
    expect(tidyName("SALT AND PEPPER SQUID")).toBe("Salt and Pepper Squid");
    expect(tidyName("WMC")).toBe("WMC");
    expect(tidyName("KFC")).toBe("KFC");
    expect(tidyName("IPA")).toBe("IPA");
  });

  it("never touches spelling", () => {
    expect(tidyName("tradional espresso")).toBe("Tradional Espresso");
    expect(tidyName("tuna beetle leaf")).toBe("Tuna Beetle Leaf");
    expect(tidyName("karaage chicken")).toBe("Karaage Chicken");
  });

  it("gives the same answer when run twice", () => {
    const samples = [
      "  black   pepper  prawns ",
      "WMC riesling",
      "Heart & Soul Rose",
      "BBQ BEEF",
      "salt/pepper",
      "mix-and-match platter",
      "o'brien's lager",
      "house red 150 ml glass",
      "(sauv blanc)",
      "and/or",
      "ChioBu bao",
    ];
    for (const s of samples) expect(tidyName(tidyName(s))).toBe(tidyName(s));
  });
});

describe("shared Title Case", () => {
  it("is the one the POS list uses", () => {
    expect(posTitleCase).toBe(titleCase);
    expect(posTitleCase("pork and prawn wonton")).toBe("Pork and Prawn Wonton");
  });
});

describe("sameButSpacing", () => {
  it("tells a spacing-only tidy from a real one", () => {
    expect(sameButSpacing("  Black   Pepper ", "Black Pepper")).toBe(true);
    expect(sameButSpacing("black pepper", "Black Pepper")).toBe(false);
  });
});
