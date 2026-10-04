/**
 * The live Gelato Rumba flavour mixes as of 5 Oct 2026: prep name -> ingredient names, copied from the database
 * (cost_preps in the gelato venue joined to cost_recipe_lines and cost_ingredients). "@Name" is a nested prep.
 * Every gelato ingredient had empty allergens and allergens_reviewed = false on that day, so the labels have to come from names.
 * Names only: no prices or quantities.
 */
export const WHITE_BASE = "White Base (gelato)";

const BASE_LINES = ["Norco Full Cream 2lt", "Norco Pure Cream 2lt", "Caster Sugar (15kg)", "Atomic-100 Super Latte Base", "Skim Milk Powder", "Dextrose"];

const CREAM = "Norco Pure Cream 2lt";
const DEXTROSE = "Dextrose";
const CREMOLINA = "Cremolina (Emulsifier for Sorbet)";
const COC_TOPPING = "Topping Cookies & Cream (Edlyn) [170767]";
const DARK_BUTTONS = "Chocolate Buttons DARK Tuscany Compound (Cadbury) [12428]";
const MILK_BUTTONS = "Chocolate Buttons MILK Sienna Compound (Cadbury) [21882]";
const CAMEL = "Topping Caramel Sundae (Trisco) [157870]";
const RED = "COLOURING PILLAR BOX RED (QUEEN) [1478] 500Ml";
const CIOCCOLATO = "Base Cioccolato 130";
const MASCARPONE = "Cheese Mascarpone (Fresco) [2470]";
const LATTE_XTRA = "Latte Xtra (Integra Latte)";
const PERFECTA = "Perfecta (Fruit Base)";
const SALT = "Salt (2)";
const CASTER = "Caster Sugar (15kg)";
const PB = "Peanut Butter Crunchy (Bega) [1955]";
const NUTS = "Crushed Nuts (2)";
const LINDT = "Chocolate Couverture Piccoli DARK Bittersweet 58% (Lindt) [140204]";
const NOCCIOLA = "Nocciola (Hazelnut Dark Roasted)";
const VANILLA_XTRA = "Vanilla Xtra (5kg)";

const WB = `@${WHITE_BASE}`;

export const WHITE_BASE_LINES = BASE_LINES;

/** flavour prep name -> lines */
export const FLAVOUR_FIXTURE: Record<string, string[]> = {
  "After Dinner Mint Gelato Mix": [WB, DEXTROSE, CREAM, "Menta C Green", "PRE Paste White Chocolate Traditional", DARK_BUTTONS],
  "Apple Pie Gelato Mix": [WB, DEXTROSE, CREAM, "PRE Paste Apple Pie Traditional", DARK_BUTTONS],
  "Banana Gelato Mix": [WB, DEXTROSE, CREAM, "Banana N", CREMOLINA, COC_TOPPING, RED],
  "Biscoff Gelato Mix": [WB, DEXTROSE, CREAM, "Biscoff Paste", "Crushed Biscoff Biscuits", "Melted Biscoff Sauce"],
  "Bubblegum Gelato Mix": [WB, DEXTROSE, "Bubblegum", RED],
  "Caramel Macadamia Gelato Mix": [WB, DEXTROSE, "Roasted Macadamia (4kg)", COC_TOPPING, CREAM, CAMEL],
  "Caramelised Fig Mascarpone Gelato Mix": [WB, DEXTROSE, "Mascargel (Cheese Cake)", CREAM],
  "Cheesecake Gelato Mix": [WB, DEXTROSE, "Cheese Philadelphia Original Spreadable (Philadelphia) [210199]", MASCARPONE, "JUICE LEMON PURE SQUEEZE (CATERERS CHOICE) [189362] 1lt"],
  "Chocolate Gelato Mix": [WB, DEXTROSE, CASTER, "Norco Full Cream 2lt", CREAM, "Base Cioko Black 250", LINDT, CREMOLINA],
  "Cookies & Cream Gelato Mix": [WB, DEXTROSE, CREAM, "Panna Cotta", "Biscuit Crumbs OREO WITH Creme (Oreo) [203827]", COC_TOPPING, "Biscuit Crumbs OREO WITH Creme (Oreo) [203827]"],
  "Espresso Gelato Mix": [WB, DEXTROSE, CREAM, "Cafe Premium", "Coffee (2)", "Caffe Pasta (Cappuccino)"],
  "Ferrero Gelato Mix": [WB, DEXTROSE, "Spread Chocolate Hazelnut (Nutella) [148083]", NOCCIOLA, CREAM, "Hazelnut Kernels (Caterers Choice)", MILK_BUTTONS, "Spread Chocolate Hazelnut Piping BAG (Nutella) [166996]", "Broken Cones"],
  "Gingerbread Gelato Mix": [WB, DEXTROSE, "Ginger Xtra"],
  "Golden Gaytime Gelato Mix": [WB, DEXTROSE, CREAM, "Butterscotch Syrup", "Butterscotch Kularome"],
  "Hazelnut Gelato Mix": [WB, DEXTROSE, NOCCIOLA, "Sea Salt"],
  "Honeycomb Gelato Mix": [WB, DEXTROSE, "Caramel Xtra (also in 10kg)", MILK_BUTTONS, "Honeycomb"],
  "Jaffa Gelato Mix": [WB, DEXTROSE, CIOCCOLATO, "Sweet Orange Aroma 1L", MILK_BUTTONS, "Jaffas"],
  "Liquorice Gelato Mix": [WB, DEXTROSE, "Liquorice", CREMOLINA],
  "Malteser Gelato Mix": [WB, DEXTROSE, CREAM, "Malt Powder", "Crushed Maltesers"],
  "Mars Bar Gelato Mix": [WB, DEXTROSE, CREAM, COC_TOPPING, "Choc-O-Malt (Mars Bar)", MILK_BUTTONS, CAMEL],
  "Milkshake Vanilla gelato mix": [WB, DEXTROSE, CREAM, "Water (2)", VANILLA_XTRA, PERFECTA],
  "Mixed Berry Gelato gelato mix": [WB, DEXTROSE, "Mora (Blackberries)", "Berries Mixed IQF (Caterers Choice) [87419]", CASTER, PERFECTA, LATTE_XTRA],
  "Pistachio Gelato Mix": [WB, DEXTROSE, "Pistacchio Trinicria 2500G 100% ITA", "Pistachio Puro Reale", SALT],
  "Pomegranate Gelato Mix": [WB, DEXTROSE, CREAM, "Melograno (Pomegranate)"],
  "Red Skin gelato mix": [WB, "Red Skin/Ripper"],
  "Rum & Raisin Gelato Mix": [WB, DEXTROSE, CREAM, "Rum Raisin", MASCARPONE, LATTE_XTRA],
  "Salted Caramel Gelato Mix": [WB, DEXTROSE, "Salted Caramel Giubileo", CREAM, SALT],
  "Snickers Gelato Mix": [WB, DEXTROSE, PB, CREAM, "Alchemy Caramel Bottle", CAMEL, DARK_BUTTONS, NUTS],
  "Strawberry Gelato gelato mix": [WB, DEXTROSE, "Fragola (Strawberry)", "Strawberries IQF (Caterers Choice)", CASTER, PERFECTA, LATTE_XTRA],
  "superlemon sorbet Gelato Mix": ["Water", CASTER, "Superlemon 100", "Integra Fibre", CREMOLINA],
  "Tim Tam Gelato Mix": [WB, DEXTROSE, CIOCCOLATO, "Syrup Golden (Bundaberg) [121269]", "Copha Vegetable Shortening (Copha) [215]", "PRE Arabeschi Otto Caramel Biscotto with pieces", CREMOLINA, DARK_BUTTONS, "Biscuits TIM TAM Family PACK (Arnotts) [200102]"],
  "Tiramisu Gelato Mix": [WB, DEXTROSE, CREAM, "Tiramisu Imperiale", MASCARPONE, "Chocolate Powder"],
  "Toblerone Gelato Mix": [WB, DEXTROSE, CIOCCOLATO, "Torroncino (Nougat)", CREMOLINA, "Golden Syrup"],
  "Turkish Delight Gelato Mix": [WB, DEXTROSE, "Turkish Delight", CREAM, DARK_BUTTONS],
  "Vanilla Bean Gelato Mix": [WB, DEXTROSE, CREAM, COC_TOPPING, VANILLA_XTRA, "Vanilla Francese"],
  "Vegan Chocolate Gelato Mix": ["Almond Milk", CASTER, "Base Vegana", DEXTROSE, "Chocolate Base Vegana", CIOCCOLATO, CREMOLINA, LINDT],
  "Vegan Peanut Butter Chocolate Gelato Mix": ["Almond Milk", CASTER, "Base Vegana", DEXTROSE, "Chocolate Base Vegana", CIOCCOLATO, CREMOLINA, LINDT, PB, NUTS, "Chocolate Couverture DARK Block (Callebaut) [19462]"],
  "White Chocolate Gelato Mix": [WB, DEXTROSE, CREAM, "PRE Paste White Chocolate Traditional"],
};

/**
 * Troy's laminated sheet (photographed 5 Oct 2026), transcribed as printed (full file: files/source/gelato-dietary-sheet-2026-10-05.json).
 * Names are the sheet's own words; SHEET_ALIASES maps the sheet's spelling to the flavour in the app.
 */
export const SHEET = {
  dairy_free: ["Plain cones", "All sorbets", "All vegan gelatos"],
  vegan: ["Plain cones", "All sorbets", "Vegan Chocolate", "Vegan Coconut", "Vegan Peanut Butter Chocolate", "Vegan Chocolate"],
  egg: ["Tim Tam", "Tiramisu", "Toblerone", "Rum & Raisin", "Cookies & Cream", "Salted Caramel", "Pavlova", "Pavlova", "Gingerbread"],
  soy: ["Plain Cones", "Biscoff", "Tiramisu", "Cookies & Cream", "Gingerbread", "Vegan Chocolate", "Vegan Chocolate Peanut Butter"],
  nuts: ["Snickers", "Hazelnut", "Pistachio", "Ferrero", "Caramel Macadamia", "Toblerone", "Vegan Chocolate", "Vegan Coconut", "Vegan Peanut Butter Chocolate", "Vegan Chocolate", "Gingerbread"],
  gluten: ["Plain Cones", "Cookies & Cream", "Tim & Tam", "Toblerone", "Tiramisu", "Butterscotch", "Maltster", "Jaffa", "Liquorice", "Malteser", "Ferrero", "Golden Gaytime", "Biscoff", "Cheesecake", "Gingerbread", "Chocolate Fudge Brownie", "Pavlova", "Apple Pie"],
} as const;

/** The sheet's spelling -> the app's flavour name (flavourName of the prep). Typos on the sheet resolve here. */
export const SHEET_ALIASES: Record<string, string> = {
  "Vegan Chocolate Peanut Butter": "Vegan Peanut Butter Chocolate",
  "Tim & Tam": "Tim Tam",
  Maltster: "Malteser",
};

/** On the sheet but no flavour in the app (so nothing to compare). */
export const SHEET_ONLY = ["Plain cones", "Plain Cones", "All sorbets", "All vegan gelatos", "Pavlova", "Vegan Coconut", "Butterscotch", "Chocolate Fudge Brownie"];
