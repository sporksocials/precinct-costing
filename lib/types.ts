export type PackUnit = "kg" | "L" | "each";
export type LineUnit = "g" | "kg" | "ml" | "L" | "each";
export type ParentType = "prep" | "item";
export type ComponentType = "ingredient" | "prep";

export const MENU_CATEGORIES = [
  "Food",
  "Cocktail",
  "Mocktail",
  "Gelato",
  "Tap Beer",
  "Packaged Beer & Cider",
  "Wine",
  "Spirits",
  "RTD",
] as const;
export type MenuCategory = (typeof MENU_CATEGORIES)[number];

export const PACK_UNITS: PackUnit[] = ["kg", "L", "each"];
export const LINE_UNITS: LineUnit[] = ["g", "kg", "ml", "L", "each"];

export interface Venue {
  id: number;
  name: string;
  slug: string;
  sort: number;
}

export interface Setting {
  key: string;
  value: number;
}

export interface Target {
  venue_id: number;
  category: string;
  target_gp: number;
}

export interface Supplier {
  id: number;
  name: string;
  portal_url: string | null;
  portal_username: string | null;
}

export interface Ingredient {
  id: string;
  name: string;
  category: string | null;
  supplier_id: number | null;
  supplier_code: string | null;
  pack_size: number;
  pack_unit: PackUnit;
  pack_price: number;
  price_inc_gst: boolean;
  gst_free: boolean;
  rebate: number;
  yield_pct: number;
  venues: string | null;
  active: boolean;
  last_price_update: string | null;
  previous_price: number | null;
  source: string | null;
  notes: string | null;
  updated_at: string | null;
}

export interface Prep {
  id: string;
  name: string;
  venue_id: number | null;
  prep_type: string | null;
  yield_qty: number;
  yield_unit: PackUnit;
  active: boolean;
  source: string | null;
  notes: string | null;
}

export interface MenuItem {
  id: string;
  name: string;
  venue_id: number;
  category: string;
  section: string | null;
  portions: number;
  sell_price_inc: number | null;
  target_override: number | null;
  hh_price_inc: number | null;
  active: boolean;
  source: string | null;
  notes: string | null;
}

export interface RecipeLine {
  id: string;
  parent_type: ParentType;
  parent_id: string;
  component_type: ComponentType;
  component_id: string;
  qty: number;
  unit: LineUnit;
  note: string | null;
  sort: number;
}

export interface PriceLog {
  id: number;
  ingredient_id: string;
  changed_at: string;
  old_price: number | null;
  new_price: number | null;
  source: string | null;
  entered_by: string | null;
  notes: string | null;
}

export interface Special {
  id: number;
  name: string;
  venue_id: number | null;
  category: string | null;
  based_on_item: string | null;
  manual_cost: number | null;
  sell_price_inc: number | null;
  target_gp: number | null;
  notes: string | null;
}

export interface PortalPrice {
  id: number;
  supplier: string;
  product_code: string | null;
  description: string | null;
  price: number | null;
  price_inc_gst: boolean | null;
  uom: string | null;
  in_stock: boolean | null;
  category: string | null;
  captured_at: string | null;
  batch: string | null;
}

export interface GelatoServe {
  id: string;
  venue_id: number;
  name: string;
  sort: number;
  grams: number;
  sell_price_inc: number | null;
  on_menu: boolean;
  active: boolean;
  notes: string | null;
  /** own GP target for this serve (take-home tubs, wholesale); null uses the venue's Gelato target */
  target_gp?: number | null;
}

export interface GelatoServeLine {
  id: string;
  serve_id: string;
  ingredient_id: string;
  qty: number;
  unit: LineUnit;
  sort: number;
}

export interface BeerServe {
  id: string;
  name: string;
  sort: number;
  ml: number;
  active: boolean;
}

export interface Beer {
  id: string;
  venue_id: number;
  name: string;
  /** the keg (ingredient, priced per L with its own yield for wastage) */
  ingredient_id: string | null;
  target_gp: number | null;
  active: boolean;
  sort: number;
  notes: string | null;
}

export interface BeerPrice {
  id: string;
  beer_id: string;
  serve_id: string;
  sell_price_inc: number | null;
  hh_price_inc: number | null;
  legacy_item_id?: string | null;
}

export interface AllowedUser {
  email: string;
}

export interface CostingSettings {
  gst_rate: number;
  round_to: number;
  alert_pct: number;
  /** share of gelato made but never sold, added to every serve's gelato cost */
  gelato_wastage: number;
}

export const DEFAULT_SETTINGS: CostingSettings = {
  gst_rate: 0.1,
  round_to: 0.5,
  alert_pct: 0.05,
  gelato_wastage: 0.05,
};

export const DEFAULT_TARGET_GP = 0.7;

export type SellPriceKind = "item" | "beer_serve" | "gelato_serve";

/** One logged change to a sell price (written by DB triggers; cost_sell_price_log). */
export interface SellPriceLog {
  id: number;
  kind: SellPriceKind;
  item_id: string | null;
  beer_id: string | null;
  serve_id: string | null;
  venue_id: number | null;
  old_price: number | null;
  new_price: number | null;
  old_hh_price: number | null;
  new_hh_price: number | null;
  cost_per_portion: number | null;
  gp_pct: number | null;
  changed_by: string | null;
  changed_at: string;
}

export type OfferKind = "combo" | "special" | "happy_hour";
export type OfferStatus = "draft" | "live" | "retired";

/** A saved combo / special / happy hour offer (cost_offers). One venue only. */
export interface Offer {
  id: string;
  name: string;
  venue_id: number;
  kind: OfferKind;
  status: OfferStatus;
  /** the offer's total price, inc GST */
  price_inc: number | null;
  target_override: number | null;
  /** YYYY-MM-DD */
  starts_on: string | null;
  ends_on: string | null;
  /** 0 = Sunday ... 6 = Saturday; null = every day */
  days_of_week: number[] | null;
  /** HH:MM or HH:MM:SS */
  time_from: string | null;
  time_to: string | null;
  notes: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface OfferLine {
  id: string;
  offer_id: string;
  component_kind: "item" | "beer_serve";
  item_id: string | null;
  beer_id: string | null;
  serve_id: string | null;
  qty: number;
  /** optional per-unit regular price (inc GST) */
  price_inc_override: number | null;
  sort: number;
}
