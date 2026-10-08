import { describe, expect, it } from "vitest";
import { applyHouseRules, cocktailSkewer, noSmackedGarnish, shakeUntilFrosted, dehydrateLimeWheels, doubleStrain, ensureRimWipe, wipeStepFor } from "@/lib/house-rules";

describe("lime wheels are always dehydrated", () => {
  it("rewords a plain lime wheel and keeps the capital", () => {
    expect(dehydrateLimeWheels("Lime wheel")).toBe("Dehydrated lime wheel");
    expect(dehydrateLimeWheels("Garnish with a lime wheel")).toBe("Garnish with a dehydrated lime wheel");
    expect(dehydrateLimeWheels("2 lime wheels")).toBe("2 dehydrated lime wheels");
    expect(dehydrateLimeWheels("Fresh lime wheel")).toBe("Dehydrated lime wheel");
  });
  it("leaves a dehydrated lime wheel and unrelated text alone", () => {
    expect(dehydrateLimeWheels("Dehydrated lime wheel")).toBe("Dehydrated lime wheel");
    expect(dehydrateLimeWheels("2 to 3 dehydrated lime wheels")).toBe("2 to 3 dehydrated lime wheels");
    expect(dehydrateLimeWheels("Add the lime juice")).toBe("Add the lime juice");
    expect(dehydrateLimeWheels("Lemon wheel")).toBe("Lemon wheel");
  });
});

describe("every rim says to wipe the inside", () => {
  it("adds the step straight after the rim step, naming what is on the rim", () => {
    expect(ensureRimWipe(["Wet and rim the glass with salt", "Chill the glass", "Shake hard for 12 seconds"])).toEqual([
      "Wet and rim the glass with salt",
      "Wipe the inside of the glass rim so there is no salt on the inside",
      "Chill the glass",
      "Shake hard for 12 seconds",
    ]);
    expect(wipeStepFor("Wet and rim the glass with chilli salt")).toBe("Wipe the inside of the glass rim so there is no chilli salt on the inside");
    expect(wipeStepFor("Wet and rim the glass with coconut")).toBe("Wipe the inside of the glass rim so there is no coconut on the inside");
    expect(wipeStepFor("Wet and rim the glass with cinnamon sugar")).toBe("Wipe the inside of the glass rim so there is no cinnamon sugar on the inside");
    expect(wipeStepFor("Wet and rim the glass with the sugar")).toBe("Wipe the inside of the glass rim so there is no sugar on the inside");
  });
  it("applies to any drink, not only margaritas", () => {
    expect(ensureRimWipe(["Wet and rim the glass with coconut", "Shake"])[1]).toContain("no coconut");
  });
  it("does not repeat itself, and ignores drinks with no rim", () => {
    const done = ["Wet and rim the glass with salt", "Wipe the inside of the glass rim so there is no salt on the inside", "Shake"];
    expect(ensureRimWipe(done)).toEqual(done);
    expect(ensureRimWipe(["Fill the carafe with ice", "Shake"])).toEqual(["Fill the carafe with ice", "Shake"]);
    expect(ensureRimWipe(["Wipe the rim clean", "Shake"])).toEqual(["Wipe the rim clean", "Shake"]);
  });
});

describe("applyHouseRules", () => {
  it("returns the same object when nothing needs changing", () => {
    const item = { name: "Mojito", method: ["Shake"], garnish: ["Dehydrated lime wheel"] };
    expect(applyHouseRules(item)).toBe(item);
  });
  it("applies both rules to method and garnish", () => {
    const out = applyHouseRules({ name: "Margarita", method: ["Wet and rim the glass with salt", "Shake"], garnish: ["Lime wheel"] });
    expect(out.garnish).toEqual(["Dehydrated lime wheel"]);
    expect(out.method).toHaveLength(3);
  });
  it("leaves a missing method or garnish missing", () => {
    expect(applyHouseRules({ name: "Margarita", method: null, garnish: null })).toEqual({ name: "Margarita", method: null, garnish: null });
  });
});

describe("fine strain is always double strain", () => {
  it("rewords and keeps the capital", () => {
    expect(doubleStrain("Fine strain into the glass")).toBe("Double strain into the glass");
    expect(doubleStrain("Shake, then fine strain into the glass")).toBe("Shake, then double strain into the glass");
    expect(doubleStrain("Fine-strain into the glass")).toBe("Double strain into the glass");
  });
  it("leaves double strain and other steps alone", () => {
    expect(doubleStrain("Double strain into the glass")).toBe("Double strain into the glass");
    expect(doubleStrain("Strain into the glass over the ice")).toBe("Strain into the glass over the ice");
  });
  it("is part of the rules a saved drink gets", () => {
    expect(applyHouseRules({ name: "French Martini", method: ["Shake", "Fine strain into the glass"], garnish: null }).method).toEqual(["Shake", "Double strain into the glass"]);
  });
});

describe("a toothpick is a cocktail skewer", () => {
  it("rewords in either case and plural", () => {
    expect(cocktailSkewer("Lychee on a toothpick")).toBe("Lychee on a cocktail skewer");
    expect(cocktailSkewer("Toothpick")).toBe("Cocktail skewer");
    expect(cocktailSkewer("Two toothpicks")).toBe("Two cocktail skewers");
    expect(cocktailSkewer("Olive on a cocktail skewer")).toBe("Olive on a cocktail skewer");
  });
  it("applies to a saved drink's garnish and method", () => {
    const out = applyHouseRules({ name: "Dry Martini", method: ["Spear an olive on a toothpick"], garnish: ["Olive on a toothpick"] });
    expect(out.garnish).toEqual(["Olive on a cocktail skewer"]);
    expect(out.method).toEqual(["Spear an olive on a cocktail skewer"]);
  });
});

describe("a garnish never says to smack mint", () => {
  it("drops the smack instruction and keeps the garnish", () => {
    expect(noSmackedGarnish("Mint (smack it between your hands first)")).toBe("Mint");
    expect(noSmackedGarnish("Mint sprig (smack it between your hands first)")).toBe("Mint sprig");
    expect(noSmackedGarnish("Smacked mint sprig")).toBe("Mint sprig");
    expect(noSmackedGarnish("Mint leaf, smacked first")).toBe("Mint leaf");
    expect(noSmackedGarnish("1 mint leaf")).toBe("1 mint leaf");
  });
  it("applies to a saved drink's garnish", () => {
    expect(applyHouseRules({ name: "Sunset Spritz", method: null, garnish: ["Mint (smack it between your hands first)", "Dehydrated lime wheel"] }).garnish).toEqual(["Mint", "Dehydrated lime wheel"]);
  });
});

describe("a 12 second shake says or until the shaker is frosted", () => {
  it("adds it at the end of the step", () => {
    expect(shakeUntilFrosted("Shake hard for 12 seconds")).toBe("Shake hard for 12 seconds, or until the shaker is frosted");
    expect(shakeUntilFrosted("Shake the lime juice, agave and Bacardi hard for 12 seconds")).toBe("Shake the lime juice, agave and Bacardi hard for 12 seconds, or until the shaker is frosted");
  });
  it("adds it before 'and' or 'then' in a longer step", () => {
    expect(shakeUntilFrosted("Add ice, shake hard for 12 seconds and dump into the glass")).toBe("Add ice, shake hard for 12 seconds, or until the shaker is frosted, and dump into the glass");
    expect(shakeUntilFrosted("Add ice, shake hard for 12 seconds, then dump into the glass")).toBe("Add ice, shake hard for 12 seconds, or until the shaker is frosted, then dump into the glass");
  });
  it("leaves steps that already say frosted, and steps that are not a 12 second shake", () => {
    expect(shakeUntilFrosted("Shake hard for 12 seconds, or until the shaker is frosted")).toBe("Shake hard for 12 seconds, or until the shaker is frosted");
    expect(shakeUntilFrosted("Shake vigorously")).toBe("Shake vigorously");
    expect(shakeUntilFrosted("Stir for 12 seconds")).toBe("Stir for 12 seconds");
  });
  it("is part of the rules a saved drink gets", () => {
    expect(applyHouseRules({ name: "Daiquiri", method: ["Shake hard for 12 seconds"], garnish: null }).method).toEqual(["Shake hard for 12 seconds, or until the shaker is frosted"]);
  });
});
