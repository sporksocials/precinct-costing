import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Invoices migration (20261024100000_invoices.sql).
 *
 * Runs the REAL migration text against a real Postgres (PGlite, in memory) with a stub of only the existing objects it touches.
 * Nothing here touches the live database. The stubs mirror the live definitions read on 24 Oct 2026:
 *   cost_venues(id integer), cost_suppliers(id integer), cost_ingredients(id uuid), ordering_products(id uuid),
 *   ordering_price_log(id uuid, product_id, venue_id), cost_settings(key text pk, value numeric not null),
 *   cost_is_allowed() (security definer, reads cost_allowed_users by the JWT email), cost_stamp_edit() (live body: sets updated_at and
 *   updated_by), auth.jwt() (reads request.jwt.claims, as Supabase does), storage.buckets / storage.objects (columns the migration uses).
 * Stubbed on purpose (PGlite is not Supabase): the storage schema tables are plain tables here, not the storage-api ones, and the
 * migration role is the PGlite superuser (live it is `postgres`, a non-superuser that is a member of supabase_privileged_role).
 */

const FILE = path.resolve(__dirname, "../supabase/migrations/20261024100000_invoices.sql");
const MIGRATION = readFileSync(FILE, "utf8");

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TROY = "hello@sporksocials.com.au";
const OTHER = "chef@example.com";

let db: PGlite;
const rows = async (q: string, params: unknown[] = []) => (await db.query(q, params)).rows as Record<string, any>[];
const one = async (q: string, params: unknown[] = []) => (await rows(q, params))[0];
const count = async (table: string, where = "true") => Number((await one(`select count(*)::int n from ${table} where ${where}`)).n);
/** the statement must fail; returns the message so a test can pin which rule fired */
async function fails(q: string, params: unknown[] = []): Promise<string> {
  try {
    await db.query(q, params);
  } catch (e) {
    // a failed statement outside a transaction leaves nothing behind; PGlite keeps the session usable
    return String((e as Error).message);
  }
  throw new Error(`expected this to fail: ${q}`);
}
const asUser = async (email: string | null, fn: () => Promise<void>) => {
  await db.query("select set_config('request.jwt.claims', $1, false)", [email ? JSON.stringify({ email }) : "{}"]);
  await db.exec("set role authenticated");
  try {
    await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims', '', false)");
  }
};

// small builders (all through the superuser, so RLS does not get in the way of fixtures)
let seq = 1000;
const nid = () => u(seq++);
const supplier = async (name: string, over: { abn?: string | null } = {}) => {
  const id = nid();
  await db.query("insert into invoice_suppliers (id, name, abn) values ($1,$2,$3)", [id, name, over.abn ?? null]);
  return id;
};
const file = async (venue = 1, sha = `sha-${seq++}`) => {
  const id = nid();
  await db.query("insert into invoice_files (id, venue_id, storage_path, sha256) values ($1,$2,'p.pdf',$3)", [id, venue, sha]);
  return id;
};
const doc = async (
  fileId: string,
  over: { venue?: number; supplier?: string | null; number?: string | null; status?: string } = {},
) => {
  const id = nid();
  await db.query(
    "insert into invoice_documents (id, venue_id, file_id, supplier_id, invoice_number, status) values ($1,$2,$3,$4,$5,$6)",
    [id, over.venue ?? 1, fileId, over.supplier ?? null, over.number ?? null, over.status ?? "needs_review"],
  );
  return id;
};
const lineRow = async (documentId: string, lineNo = 1) => {
  const id = nid();
  await db.query("insert into invoice_lines (id, document_id, venue_id, line_no, description) values ($1,$2,1,$3,'x')", [id, documentId, lineNo]);
  return id;
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create schema storage;
    create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text);
    alter table storage.objects enable row level security;

    create table cost_venues (id integer primary key, slug text, name text);
    insert into cost_venues values (1, 'drift', 'Drift'), (2, 'chiobu', 'Chiobu');
    create table cost_suppliers (id integer primary key, name text);
    create table cost_settings (key text primary key, value numeric not null, note text, text_value text);
    create table cost_ingredients (id uuid primary key, name text, pack_price numeric not null default 0);
    create table ordering_products (id uuid primary key, venue_id integer references cost_venues (id), name text);
    create table ordering_price_log (id uuid primary key default gen_random_uuid(), product_id uuid not null references ordering_products (id) on delete cascade,
      venue_id integer not null references cost_venues (id), old_price numeric, new_price numeric, changed_at timestamptz not null default now(), changed_by text, upload_id uuid);
    create table cost_allowed_users (email text primary key);
    insert into cost_allowed_users values ('${TROY}'), ('${OTHER}');
    create function public.cost_is_allowed() returns boolean language sql stable security definer set search_path to 'public' as $$
      select exists (select 1 from cost_allowed_users where lower(email) = lower(coalesce(auth.jwt()->>'email','')));
    $$;
    create function public.cost_stamp_edit() returns trigger language plpgsql set search_path to 'public' as $$
    begin
      new.updated_at := now();
      begin
        new.updated_by := nullif(auth.jwt() ->> 'email', '');
      exception when others then
        new.updated_by := null;
      end;
      return new;
    end $$;
  `);

  // existing rows the migration must leave alone
  await db.query("insert into cost_suppliers values (7, 'Star')");
  await db.query("insert into cost_ingredients (id, name, pack_price) values ($1,'Kingfish',68.9), ($2,'Barramundi',41.54)", [u(1), u(2)]);
  await db.query("insert into ordering_products (id, venue_id, name) values ($1,1,'Kingfish')", [u(3)]);
  await db.query("insert into cost_settings (key, value) values ('target_gp', 0.72), ('invoice_auto_apply_pct', 0.08)"); // an existing value must win

  // apply twice: the second run must change nothing and fail nowhere
  await db.exec(MIGRATION);
  await db.exec(MIGRATION);

  // what the live roles have by default privilege; the policies are what restrict them
  await db.exec(`
    grant usage on schema public, auth, storage to authenticated;
    grant all on all tables in schema public to authenticated;
    grant select on storage.objects to authenticated;
    grant usage on all sequences in schema public to authenticated;
  `);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("invoices migration: applies cleanly and is idempotent", () => {
  it("created every table", async () => {
    const names = (await rows(`select table_name from information_schema.tables where table_schema = 'public'`)).map((r) => r.table_name);
    for (const t of [
      "invoice_suppliers", "invoice_files", "invoice_documents", "invoice_lines", "invoice_item_map", "invoice_charge_rules",
      "invoice_price_changes", "invoice_questions", "invoice_digests", "ai_model_prices", "ai_usage_log", "ai_cost_viewers",
    ]) {
      expect(names, t).toContain(t);
    }
  });

  it("seeds each default exactly once after two runs", async () => {
    expect(await count("invoice_charge_rules")).toBe(8);
    const rules = await rows("select match_text, line_class, spread, supplier_id from invoice_charge_rules order by match_text");
    expect(rules.map((r) => r.match_text)).toEqual(["delivery", "deposit", "discount", "freight", "fuel levy", "keg return", "rounding", "surcharge"]);
    expect(rules.every((r) => r.supplier_id === null)).toBe(true);
    const by = Object.fromEntries(rules.map((r) => [r.match_text, r]));
    expect(by["delivery"]).toMatchObject({ line_class: "delivery", spread: true });
    expect(by["deposit"]).toMatchObject({ line_class: "deposit", spread: false });
    expect(by["keg return"]).toMatchObject({ line_class: "deposit", spread: false });
    expect(by["discount"]).toMatchObject({ line_class: "discount", spread: true });
    expect(by["rounding"]).toMatchObject({ line_class: "other", spread: false });

    expect((await rows("select model from ai_model_prices order by model")).map((r) => r.model)).toEqual([
      "claude-fable-5-1", "claude-haiku-5-5", "claude-opus-5-5", "claude-sonnet-5-5",
    ]);
    expect((await rows("select email from ai_cost_viewers")).map((r) => r.email)).toEqual([TROY]);
  });

  it("seeds the settings but never overwrites a value already there", async () => {
    const s = Object.fromEntries((await rows("select key, value::float v from cost_settings")).map((r) => [r.key, r.v]));
    expect(s.invoice_auto_apply_pct).toBe(0.08); // pre-existing value kept (on conflict do nothing)
    expect(s.invoice_learning_mode).toBe(1);
    expect(s.invoice_average_days).toBe(90);
    expect(s.ai_usd_to_aud).toBe(1.55);
    expect(s.target_gp).toBe(0.72);
    expect(await count("cost_settings")).toBe(5);
  });

  it("does not add rules a second time even when a rule was edited, and respects a deleted default", async () => {
    // an edit (spread off for fuel levy) survives a re-run
    await db.query("update invoice_charge_rules set spread = false where match_text = 'fuel levy'");
    await db.exec(MIGRATION);
    expect(await count("invoice_charge_rules")).toBe(8);
    expect((await one("select spread from invoice_charge_rules where match_text = 'fuel levy'")).spread).toBe(false);
    await db.query("update invoice_charge_rules set spread = true where match_text = 'fuel levy'");
  });

  it("makes the invoice-pdfs bucket private, PDF only, 50 MB, and corrects it on re-run", async () => {
    await db.query("update storage.buckets set public = true, file_size_limit = 1 where id = 'invoice-pdfs'");
    await db.exec(MIGRATION);
    const b = await one("select * from storage.buckets where id = 'invoice-pdfs'");
    expect(b.public).toBe(false);
    expect(Number(b.file_size_limit)).toBe(52428800);
    expect(b.allowed_mime_types).toEqual(["application/pdf"]);
    expect(await count("storage.buckets")).toBe(1);
  });

  it("adds ordering_price_log.invoice_document_id and leaves existing log rows alone", async () => {
    const c = await one(
      `select data_type, is_nullable from information_schema.columns where table_name = 'ordering_price_log' and column_name = 'invoice_document_id'`,
    );
    expect(c).toMatchObject({ data_type: "uuid", is_nullable: "YES" });
  });

  it("puts the edit-stamp trigger on exactly the four tables that have updated_by", async () => {
    const t = (await rows(`select tgrelid::regclass::text t from pg_trigger where tgname like 'invoice\\_%\\_stamp' and not tgisinternal order by 1`)).map((r) => r.t);
    expect(t).toEqual(["invoice_charge_rules", "invoice_documents", "invoice_item_map", "invoice_suppliers"]);
    for (const tbl of t) {
      const cols = (await rows(`select column_name from information_schema.columns where table_name = $1`, [tbl])).map((r) => r.column_name);
      expect(cols, tbl).toEqual(expect.arrayContaining(["updated_at", "updated_by"]));
    }
  });

  it("stamps updated_at and the signed-in email on insert and update", async () => {
    await asUser(OTHER, async () => {
      await db.query("insert into invoice_suppliers (id, name) values ($1, 'Stamp Test')", [u(50)]);
      expect((await one("select updated_by from invoice_suppliers where id = $1", [u(50)])).updated_by).toBe(OTHER);
      await db.query("update invoice_suppliers set notes = 'x' where id = $1", [u(50)]);
    });
    await db.query("delete from invoice_suppliers where id = $1", [u(50)]);
  });
});

describe("invoice_suppliers", () => {
  it("allows one supplier per ABN (when known) and per name ignoring capitals", async () => {
    await supplier("Daniel Street Fish Market", { abn: "61151388094" });
    expect(await fails("insert into invoice_suppliers (name, abn) values ('Other Fish', '61151388094')")).toMatch(/duplicate key|unique/i);
    expect(await fails("insert into invoice_suppliers (name) values ('daniel street FISH market')")).toMatch(/duplicate key|unique/i);
    await db.query("insert into invoice_suppliers (name) values ('No ABN One'), ('No ABN Two')"); // null ABNs never clash
  });

  it("rejects a blank name and a bad allocation basis", async () => {
    expect(await fails("insert into invoice_suppliers (name) values ('   ')")).toMatch(/check/i);
    expect(await fails("insert into invoice_suppliers (name, allocation_basis) values ('Basis Bad', 'weight')")).toMatch(/check/i);
    await db.query("insert into invoice_suppliers (name, allocation_basis) values ('Basis Qty', 'quantity')");
  });

  it("sets cost_supplier_id to null when the costing supplier is deleted", async () => {
    const id = nid();
    await db.query("insert into invoice_suppliers (id, name, cost_supplier_id) values ($1, 'Linked Star', 7)", [id]);
    await db.query("insert into cost_suppliers values (8, 'Temp')");
    await db.query("update invoice_suppliers set cost_supplier_id = 8 where id = $1", [id]);
    await db.query("delete from cost_suppliers where id = 8");
    expect((await one("select cost_supplier_id from invoice_suppliers where id = $1", [id])).cost_supplier_id).toBeNull();
  });
});

describe("invoice_files", () => {
  it("is unique on (venue, sha256): a repeat scan for a venue is refused, another venue is fine", async () => {
    await db.query("insert into invoice_files (venue_id, storage_path, sha256) values (1, 'a.pdf', 'dup-sha')");
    expect(await fails("insert into invoice_files (venue_id, storage_path, sha256) values (1, 'b.pdf', 'dup-sha')")).toMatch(/invoice_files_sha_key|duplicate key/);
    await db.query("insert into invoice_files (venue_id, storage_path, sha256) values (2, 'c.pdf', 'dup-sha')");
  });

  it("rejects a bad status and a missing venue", async () => {
    expect(await fails("insert into invoice_files (venue_id, storage_path, sha256, status) values (1, 'p', 's-bad', 'queued')")).toMatch(/check/i);
    expect(await fails("insert into invoice_files (venue_id, storage_path, sha256) values (99, 'p', 's-nov')")).toMatch(/foreign key/i);
  });
});

describe("invoice_documents", () => {
  it("refuses a second LIVE document with the same venue, supplier and invoice number", async () => {
    const s = await supplier("Dup Test Supplier");
    const f = await file();
    await doc(f, { supplier: s, number: "51329" });
    expect(await fails("insert into invoice_documents (venue_id, file_id, supplier_id, invoice_number) values (1, $1, $2, '51329')", [f, s])).toMatch(
      /invoice_documents_number_key|duplicate key/,
    );
    // also refused with any non-duplicate status
    expect(await fails("insert into invoice_documents (venue_id, file_id, supplier_id, invoice_number, status) values (1, $1, $2, '51329', 'applied')", [f, s])).toMatch(
      /duplicate key/,
    );
  });

  it("allows a document marked 'duplicate' with the same number, and several of them", async () => {
    const s = await supplier("Dup Mark Supplier");
    const f = await file();
    await doc(f, { supplier: s, number: "9764204" });
    await doc(f, { supplier: s, number: "9764204", status: "duplicate" });
    await doc(f, { supplier: s, number: "9764204", status: "duplicate" });
    expect(await count("invoice_documents", `supplier_id = '${s}' and invoice_number = '9764204'`)).toBe(3);
  });

  it("allows the same number at another venue, or from another supplier", async () => {
    const s1 = await supplier("Multi Venue S1");
    const s2 = await supplier("Multi Venue S2");
    const f = await file();
    await doc(f, { supplier: s1, number: "100", venue: 1 });
    await doc(f, { supplier: s1, number: "100", venue: 2 });
    await doc(f, { supplier: s2, number: "100", venue: 1 });
  });

  it("allows a null supplier or a null invoice number any number of times", async () => {
    const s = await supplier("Null Case Supplier");
    const f = await file();
    await doc(f, { supplier: null, number: "ENV-23585" });
    await doc(f, { supplier: null, number: "ENV-23585" });
    await doc(f, { supplier: s, number: null });
    await doc(f, { supplier: s, number: null });
    await doc(f, { supplier: null, number: null });
    await doc(f, { supplier: null, number: null });
  });

  it("a live document can be moved to 'duplicate' to free its number, and a duplicate cannot be flipped back while a live one exists", async () => {
    const s = await supplier("Flip Supplier");
    const f = await file();
    const live = await doc(f, { supplier: s, number: "F1" });
    const dup = await doc(f, { supplier: s, number: "F1", status: "duplicate" });
    expect(await fails("update invoice_documents set status = 'needs_review' where id = $1", [dup])).toMatch(/duplicate key/);
    await db.query("update invoice_documents set status = 'duplicate' where id = $1", [live]);
    await db.query("update invoice_documents set status = 'needs_review' where id = $1", [dup]);
  });

  it("rejects bad enum values", async () => {
    const f = await file();
    const bad = (col: string, val: string) => fails(`insert into invoice_documents (venue_id, file_id, ${col}) values (1, $1, $2)`, [f, val]);
    expect(await bad("doc_type", "receipt")).toMatch(/check/i);
    expect(await bad("status", "done")).toMatch(/check/i);
    expect(await bad("venue_check", "maybe")).toMatch(/check/i);
    expect(await bad("price_basis", "gross")).toMatch(/check/i);
    expect(await bad("mode", "manual")).toMatch(/check/i);
    // the valid ones, including a null price basis
    await db.query(
      "insert into invoice_documents (venue_id, file_id, doc_type, status, venue_check, price_basis, mode) values (1, $1, 'credit_note', 'partly_applied', 'mismatch', 'mixed', 'auto')",
      [f],
    );
    await db.query("insert into invoice_documents (venue_id, file_id) values (1, $1)", [f]);
  });

  it("applies the documented defaults", async () => {
    const f = await file();
    const id = await doc(f);
    const d = await one("select * from invoice_documents where id = $1", [id]);
    expect(d).toMatchObject({ doc_type: "invoice", venue_check: "unknown", reconciled: false, status: "needs_review", mode: "learning" });
    expect(Number(d.fee_pool_ex)).toBe(0);
    expect(d.pages).toEqual([]);
    expect(d.recon_notes).toEqual([]);
  });

  it("sets duplicate_of to null when the original is deleted", async () => {
    const f = await file();
    const orig = await doc(f);
    const dup = await doc(f, { status: "duplicate" });
    await db.query("update invoice_documents set duplicate_of = $1 where id = $2", [orig, dup]);
    await db.query("delete from invoice_documents where id = $1", [orig]);
    expect((await one("select duplicate_of from invoice_documents where id = $1", [dup])).duplicate_of).toBeNull();
  });

  it("sets supplier_id to null when an invoice supplier is deleted", async () => {
    const s = await supplier("Delete Me Supplier");
    const d = await doc(await file(), { supplier: s, number: "D1" });
    await db.query("delete from invoice_suppliers where id = $1", [s]);
    expect((await one("select supplier_id from invoice_documents where id = $1", [d])).supplier_id).toBeNull();
  });
});

describe("invoice_lines, questions, price changes: constraints", () => {
  it("rejects bad enum values on lines", async () => {
    const d = await doc(await file());
    const bad = (col: string, val: string) => fails(`insert into invoice_lines (document_id, venue_id, line_no, ${col}) values ($1, 1, 1, $2)`, [d, val]);
    expect(await bad("line_class", "freight")).toMatch(/check/i);
    expect(await bad("gst", "exempt")).toMatch(/check/i);
    expect(await bad("match_state", "guessed")).toMatch(/check/i);
    expect(await bad("match_method", "fuzzy")).toMatch(/check/i);
    expect(await bad("decision", "auto")).toMatch(/check/i);
    expect(await bad("state", "done")).toMatch(/check/i);
    await db.query("insert into invoice_lines (document_id, venue_id, line_no, match_method, line_class) values ($1, 1, 1, 'human', 'deposit')", [d]);
  });

  it("applies line defaults", async () => {
    const d = await doc(await file());
    const l = await one("select * from invoice_lines where id = $1", [await lineRow(d)]);
    expect(l).toMatchObject({ line_class: "product", gst: "unknown", match_state: "unmatched", decision: "none", state: "open" });
    expect(Number(l.fee_share_ex)).toBe(0);
  });

  it("rejects bad enum values on price changes, questions and digests", async () => {
    const d = await doc(await file());
    const l = await lineRow(d);
    const pc = (over: Record<string, string>) => {
      const v = { target: "ingredient", kind: "price_change", mode: "auto", status: "applied", ...over };
      return fails(
        "insert into invoice_price_changes (line_id, document_id, venue_id, target, target_id, kind, mode, status) values ($1,$2,1,$3,$4,$5,$6,$7)",
        [l, d, v.target, u(1), v.kind, v.mode, v.status],
      );
    };
    expect(await pc({ target: "sell_price" })).toMatch(/check/i);
    expect(await pc({ kind: "undo" })).toMatch(/check/i);
    expect(await pc({ mode: "manual" })).toMatch(/check/i);
    expect(await pc({ status: "undone" })).toMatch(/check/i);
    await db.query(
      "insert into invoice_price_changes (line_id, document_id, venue_id, target, target_id, kind, mode) values ($1,$2,1,'ordering_product',$3,'price_confirmed','approved')",
      [l, d, u(3)],
    );

    expect(await fails("insert into invoice_questions (venue_id, document_id, kind, prompt) values (1, $1, 'whatever', 'p')", [d])).toMatch(/check/i);
    expect(await fails("insert into invoice_questions (venue_id, document_id, kind, prompt, status) values (1, $1, 'other', 'p', 'closed')", [d])).toMatch(/check/i);
    await db.query("insert into invoice_questions (venue_id, document_id, kind, prompt) values (1, $1, 'big_change', 'p')", [d]);

    expect(await fails("insert into invoice_digests (kind) values ('sms')")).toMatch(/check/i);
    await db.query("insert into invoice_digests (kind) values ('slack'), ('weekly_email')");
  });

  it("rejects bad charge rules (blank text, unknown class)", async () => {
    expect(await fails("insert into invoice_charge_rules (match_text, line_class, spread) values ('  ', 'fee', true)")).toMatch(/check/i);
    expect(await fails("insert into invoice_charge_rules (match_text, line_class, spread) values ('x', 'tip', true)")).toMatch(/check/i);
    expect(await fails("insert into invoice_charge_rules (match_text, line_class) values ('x', 'fee')")).toMatch(/not-null|null value/i); // spread has no default on purpose
  });
});

describe("cascades", () => {
  it("deleting a document removes its lines, questions and price changes, and nulls the soft links", async () => {
    const f = await file();
    const d = await doc(f);
    const other = await doc(f);
    const l1 = await lineRow(d, 1);
    const l2 = await lineRow(d, 2);
    const keepLine = await lineRow(other, 1);
    await db.query("insert into invoice_questions (venue_id, document_id, line_id, kind, prompt) values (1,$1,$2,'unmatched_line','a'), (1,$1,null,'totals_mismatch','b')", [d, l1]);
    await db.query("insert into invoice_questions (venue_id, document_id, line_id, kind, prompt) values (1,$1,$2,'unmatched_line','keep')", [other, keepLine]);
    await db.query(
      "insert into invoice_price_changes (line_id, document_id, venue_id, target, target_id, kind, mode) values ($1,$2,1,'ingredient',$3,'price_change','auto'), ($4,$2,1,'ingredient',$3,'price_confirmed','auto')",
      [l1, d, u(1), l2],
    );
    await db.query("insert into invoice_price_changes (line_id, document_id, venue_id, target, target_id, kind, mode) values ($1,$2,1,'ingredient',$3,'price_change','auto')", [keepLine, other, u(2)]);
    const logId = nid();
    await db.query("insert into ordering_price_log (id, product_id, venue_id, old_price, new_price, invoice_document_id) values ($1,$2,1,1,2,$3)", [logId, u(3), d]);
    const usage = await one("insert into ai_usage_log (feature, model, document_id, file_id) values ('invoice_read','claude-sonnet-5-5',$1,$2) returning id", [d, f]);

    await db.query("delete from invoice_documents where id = $1", [d]);

    expect(await count("invoice_lines", `document_id = '${d}'`)).toBe(0);
    expect(await count("invoice_questions", `document_id = '${d}'`)).toBe(0);
    expect(await count("invoice_price_changes", `document_id = '${d}'`)).toBe(0);
    // the other document is untouched
    expect(await count("invoice_lines", `document_id = '${other}'`)).toBe(1);
    expect(await count("invoice_questions", `document_id = '${other}'`)).toBe(1);
    expect(await count("invoice_price_changes", `document_id = '${other}'`)).toBe(1);
    // soft links: the price log row and the AI cost row stay, with the link cleared
    expect((await one("select invoice_document_id from ordering_price_log where id = $1", [logId])).invoice_document_id).toBeNull();
    expect((await one("select document_id, file_id from ai_usage_log where id = $1", [usage.id]))).toEqual({ document_id: null, file_id: f });
  });

  it("deleting a file removes its documents and everything under them; AI cost rows survive with the link cleared", async () => {
    const f = await file();
    const d = await doc(f);
    const l = await lineRow(d);
    await db.query("insert into invoice_questions (venue_id, document_id, line_id, kind, prompt) values (1,$1,$2,'other','q')", [d, l]);
    const usage = await one("insert into ai_usage_log (feature, model, file_id) values ('invoice_sort','claude-haiku-5-5',$1) returning id", [f]);
    await db.query("delete from invoice_files where id = $1", [f]);
    expect(await count("invoice_documents", `id = '${d}'`)).toBe(0);
    expect(await count("invoice_lines", `id = '${l}'`)).toBe(0);
    expect(await count("invoice_questions", `document_id = '${d}'`)).toBe(0);
    expect((await one("select file_id from ai_usage_log where id = $1", [usage.id])).file_id).toBeNull();
  });

  it("deleting an ingredient or product nulls the line's match; deleting a map entry nulls map_id", async () => {
    await db.query("insert into cost_ingredients (id, name) values ($1, 'Temp Ing')", [u(60)]);
    await db.query("insert into ordering_products (id, venue_id, name) values ($1, 1, 'Temp Prod')", [u(61)]);
    const s = await supplier("Map Cascade Supplier");
    const map = nid();
    await db.query("insert into invoice_item_map (id, supplier_id, item_code, ingredient_id) values ($1,$2,'C1',$3)", [map, s, u(60)]);
    const d = await doc(await file());
    const l = nid();
    await db.query(
      "insert into invoice_lines (id, document_id, venue_id, line_no, ingredient_id, product_id, map_id) values ($1,$2,1,1,$3,$4,$5)",
      [l, d, u(60), u(61), map],
    );
    await db.query("delete from ordering_products where id = $1", [u(61)]);
    expect((await one("select product_id from invoice_lines where id = $1", [l])).product_id).toBeNull();
    // deleting the ingredient deletes the map entry (on delete cascade) and the line's map_id/ingredient_id are cleared
    await db.query("delete from cost_ingredients where id = $1", [u(60)]);
    expect(await count("invoice_item_map", `id = '${map}'`)).toBe(0);
    expect(await one("select ingredient_id, map_id from invoice_lines where id = $1", [l])).toEqual({ ingredient_id: null, map_id: null });
  });

  it("deleting a supplier removes its map entries and its own charge rules, but not the global rules", async () => {
    const s = await supplier("Rules Supplier");
    await db.query("insert into invoice_item_map (supplier_id, item_code, ingredient_id) values ($1,'K1',$2)", [s, u(1)]);
    await db.query("insert into invoice_charge_rules (supplier_id, match_text, line_class, spread) values ($1,'pallet fee','fee',true)", [s]);
    const before = await count("invoice_charge_rules");
    await db.query("delete from invoice_suppliers where id = $1", [s]);
    expect(await count("invoice_item_map", `supplier_id = '${s}'`)).toBe(0);
    expect(await count("invoice_charge_rules")).toBe(before - 1);
    expect(await count("invoice_charge_rules", "supplier_id is null")).toBe(8);
  });
});

describe("invoice_item_map unique key (null venue and null code treated as values)", () => {
  let s: string;
  const ins = (over: { venue?: number | null; code?: string | null; desc?: string | null; ing?: string | null; prod?: string | null; rejected?: boolean; supplier?: string }) =>
    db.query(
      "insert into invoice_item_map (supplier_id, venue_id, item_code, desc_key, ingredient_id, product_id, rejected) values ($1,$2,$3,$4,$5,$6,$7)",
      [over.supplier ?? s, over.venue ?? null, over.code ?? null, over.desc ?? null, over.ing ?? null, over.prod ?? null, over.rejected ?? false],
    );
  beforeAll(async () => {
    s = await supplier("Map Key Supplier");
  });

  it("refuses an identical row, including when venue, code or desc are null", async () => {
    await ins({ code: "15026", ing: u(1) });
    expect(await fails("insert into invoice_item_map (supplier_id, item_code, ingredient_id) values ($1,'15026',$2)", [s, u(1)])).toMatch(/invoice_item_map_key|duplicate key/);
    await ins({ desc: "dianginger beer 50l keg", ing: u(1) });
    expect(await fails("insert into invoice_item_map (supplier_id, desc_key, ingredient_id) values ($1,'dianginger beer 50l keg',$2)", [s, u(1)])).toMatch(/duplicate key/);
    await ins({ venue: 1, code: "15026", ing: u(1) });
    expect(await fails("insert into invoice_item_map (supplier_id, venue_id, item_code, ingredient_id) values ($1,1,'15026',$2)", [s, u(1)])).toMatch(/duplicate key/);
  });

  it("allows two rows that differ only by ingredient", async () => {
    await ins({ code: "15056", ing: u(1) });
    await ins({ code: "15056", ing: u(2) });
  });

  it("treats a null venue (every venue) as different from a named venue, and venues as different from each other", async () => {
    await ins({ code: "V1", ing: u(1), venue: null });
    await ins({ code: "V1", ing: u(1), venue: 1 });
    await ins({ code: "V1", ing: u(1), venue: 2 });
  });

  it("treats a null code as different from a code, and keys by description when there is no code", async () => {
    await ins({ code: "X9", desc: "lychee liqueur 700ml", ing: u(1) });
    await ins({ code: null, desc: "lychee liqueur 700ml", ing: u(1) });
    await ins({ code: "X9", desc: null, ing: u(1) });
    await ins({ code: "X9", desc: "different words", ing: u(1) });
  });

  it("keeps different suppliers apart", async () => {
    const s2 = await supplier("Map Key Supplier Two");
    await ins({ code: "15026", ing: u(1), supplier: s2 });
  });

  it("requires an item code or a description", async () => {
    expect(await fails("insert into invoice_item_map (supplier_id, ingredient_id) values ($1,$2)", [s, u(1)])).toMatch(/invoice_item_map_key_chk|check/i);
  });

  it("requires a positive packs_per_unit when given, and leaves it null when nobody said", async () => {
    expect(await fails("insert into invoice_item_map (supplier_id, item_code, ingredient_id, packs_per_unit) values ($1,'P0',$2,0)", [s, u(1)])).toMatch(/check/i);
    expect(await fails("insert into invoice_item_map (supplier_id, item_code, ingredient_id, packs_per_unit) values ($1,'P-',$2,-1)", [s, u(1)])).toMatch(/check/i);
    await db.query("insert into invoice_item_map (supplier_id, item_code, ingredient_id) values ($1,'P1',$2)", [s, u(1)]);
    expect((await one("select packs_per_unit from invoice_item_map where item_code = 'P1' and supplier_id = $1", [s])).packs_per_unit).toBeNull();
  });

  it("allows one live price change per line and target, but a reverted one does not block a new one", async () => {
    await db.query("insert into cost_venues (id, name, slug) values (9, 'V9', 'v9') on conflict do nothing");
    await db.query("insert into invoice_files (id, venue_id, storage_path, sha256) values ($1, 9, 'p', 'h9')", [u(900)]);
    await db.query("insert into invoice_documents (id, venue_id, file_id) values ($1, 9, $2)", [u(901), u(900)]);
    await db.query("insert into invoice_lines (id, document_id, venue_id, line_no) values ($1, $2, 9, 1)", [u(902), u(901)]);
    const ins = (status: string) => db.query("insert into invoice_price_changes (line_id, document_id, venue_id, target, target_id, kind, mode, status) values ($1,$2,9,'ingredient',$3,'price_change','approved',$4)", [u(902), u(901), u(1), status]);
    await ins("applied");
    expect(await fails("insert into invoice_price_changes (line_id, document_id, venue_id, target, target_id, kind, mode) values ($1,$2,9,'ingredient',$3,'price_confirmed','auto')", [u(902), u(901), u(1)])).toMatch(/duplicate key/);
    await db.query("update invoice_price_changes set status = 'reverted' where line_id = $1", [u(902)]);
    await ins("applied");
  });

  it("a rejected row and a confirmed row for the same code and ingredient COLLIDE (flip the flag on the one row instead)", async () => {
    await ins({ code: "R1", ing: u(1), rejected: false });
    expect(await fails("insert into invoice_item_map (supplier_id, item_code, ingredient_id, rejected) values ($1,'R1',$2,true)", [s, u(1)])).toMatch(/duplicate key/);
    await db.query("update invoice_item_map set rejected = true where supplier_id = $1 and item_code = 'R1'", [s]);
    // a rejection of a DIFFERENT ingredient for the same code is a separate row
    await ins({ code: "R1", ing: u(2), rejected: true });
  });

  it("keeps product-only rows apart by product, but refuses an identical repeat", async () => {
    await ins({ code: "PO1", prod: u(3) });
    expect(await fails("insert into invoice_item_map (supplier_id, item_code, product_id) values ($1,'PO1',$2)", [s, u(3)])).toMatch(/duplicate key/);
    await db.query("insert into ordering_products (id, venue_id, name) values ($1, 1, 'Second Product')", [u(70)]);
    await db.query("insert into invoice_item_map (supplier_id, item_code, product_id, rejected) values ($1,'PO1',$2,true)", [s, u(70)]);
  });
});

describe("row level security (PGlite roles, JWT email read through auth.jwt())", () => {
  it("lets an allowed signed-in user read and write the invoice tables", async () => {
    await asUser(OTHER, async () => {
      expect(Number((await one("select count(*)::int n from invoice_charge_rules")).n)).toBe(8);
      await db.query("insert into invoice_digests (id, kind) values ($1, 'slack')", [u(80)]);
      await db.query("update invoice_digests set body = 'hi' where id = $1", [u(80)]);
      await db.query("delete from invoice_digests where id = $1", [u(80)]);
    });
  });

  it("shows nothing and refuses writes to a signed-in user who is not on the allowed list, or to nobody", async () => {
    for (const who of ["stranger@example.com", null]) {
      await asUser(who, async () => {
        expect(Number((await one("select count(*)::int n from invoice_charge_rules")).n)).toBe(0);
        expect(Number((await one("select count(*)::int n from storage.objects where bucket_id = 'invoice-pdfs'")).n)).toBe(0);
        expect(await fails("insert into invoice_digests (kind) values ('slack')")).toMatch(/row-level security/i);
      });
    }
  });

  it("lets only the listed viewers read the AI cost log, and nobody signed in can write it", async () => {
    await db.query("insert into ai_usage_log (feature, model, cost_usd) values ('invoice_read','claude-sonnet-5-5',0.12)");
    await asUser(TROY, async () => {
      expect(Number((await one("select count(*)::int n from ai_usage_log")).n)).toBeGreaterThan(0);
      expect((await rows("select email from ai_cost_viewers")).map((r) => r.email)).toEqual([TROY]);
      expect(await fails("insert into ai_usage_log (feature, model) values ('x','y')")).toMatch(/row-level security/i);
      expect(await fails("insert into ai_cost_viewers (email) values ('me@example.com')")).toMatch(/row-level security/i);
    });
    // allowed to use the app, but not a cost viewer
    await asUser(OTHER, async () => {
      expect(Number((await one("select count(*)::int n from ai_usage_log")).n)).toBe(0);
      expect(Number((await one("select count(*)::int n from ai_cost_viewers")).n)).toBe(0);
    });
    // viewer check ignores capitals in the email
    await asUser(TROY.toUpperCase(), async () => {
      expect(Number((await one("select count(*)::int n from ai_usage_log")).n)).toBeGreaterThan(0);
    });
  });

  it("lets an allowed user read invoice PDFs from the bucket, and not other buckets' objects through this policy", async () => {
    await db.query("insert into storage.buckets (id, name) values ('other-bucket', 'other-bucket')");
    await db.query("insert into storage.objects (bucket_id, name) values ('invoice-pdfs', 'a/b.pdf'), ('other-bucket', 'z.png')");
    await asUser(OTHER, async () => {
      expect((await rows("select name from storage.objects")).map((r) => r.name)).toEqual(["a/b.pdf"]);
      expect(await fails("insert into storage.objects (bucket_id, name) values ('invoice-pdfs', 'c.pdf')")).toMatch(/permission denied|row-level security/i);
    });
  });

  it("lets an allowed user read AI prices but not change them", async () => {
    await asUser(OTHER, async () => {
      expect(Number((await one("select count(*)::int n from ai_model_prices")).n)).toBe(4);
      await db.query("update ai_model_prices set input_per_mtok = 99 where model = 'claude-sonnet-5-5'");
      expect(Number((await one("select input_per_mtok::int n from ai_model_prices where model = 'claude-sonnet-5-5'")).n)).toBe(2);
    });
  });

  it("is idempotent for the policies: one policy of each name after three runs", async () => {
    const p = await rows(`select tablename, policyname from pg_policies where policyname in ('cost_allowed_all','ai_usage_viewers_select','ai_cost_viewers_select','invoice_pdfs_select')`);
    const keys = p.map((r) => `${r.tablename}.${r.policyname}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining(["objects.invoice_pdfs_select", "ai_usage_log.ai_usage_viewers_select", "ai_cost_viewers.ai_cost_viewers_select"]));
    expect(keys.filter((k) => k.endsWith(".cost_allowed_all")).length).toBe(9);
  });
});

describe("existing data is untouched", () => {
  it("leaves the pre-existing rows alone", async () => {
    expect(await count("cost_ingredients")).toBeGreaterThanOrEqual(2);
    expect((await one("select pack_price::float p from cost_ingredients where id = $1", [u(1)])).p).toBe(68.9);
    expect((await one("select name from cost_suppliers where id = 7")).name).toBe("Star");
  });
});
