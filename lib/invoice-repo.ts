/**
 * The Supabase versions of the pipeline's database and bucket operations, and of the upload route's. SERVER ONLY (service role).
 * The pipeline and the handlers talk to the interfaces (PipelineRepo, PipelineStorage, IngestStore), so tests use in-memory fakes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvoiceFileRow } from "./invoice-types";
import { MAX_ATTEMPTS, type DocShell, type PipelineRepo, type PipelineStorage, type ShellInput } from "./invoice-pipeline";
import { insertRow, insertRows } from "./supabase/service";

function check<T>(res: { data: T | null; error: { message: string } | null }, what: string): T | null {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

const DOC_COLS = "id, pages, doc_type, supplier_name_read, invoice_number, invoice_date, page_pdf_path, read_model, status";

type FileWithStamp = InvoiceFileRow & { updated_at: string };

export function supabaseRepo(sb: SupabaseClient): PipelineRepo {
  return {
    async claimFile({ stalledBefore, nowIso }) {
      const res = await sb
        .from("invoice_files")
        .select("*")
        .or(`status.eq.received,and(status.in.(sorting,reading),updated_at.lt.${stalledBefore})`)
        .gte("attempts", 0)
        .lte("attempts", MAX_ATTEMPTS) // a file AT the limit is handed back only so the pipeline can mark it failed
        .order("received_at", { ascending: true })
        .limit(5);
      const candidates = (check(res, "Could not look for files") ?? []) as FileWithStamp[];
      for (const c of candidates) {
        // compare and set: only the caller whose status AND stamp still match wins
        const won = await sb.from("invoice_files").update({ status: "sorting", updated_at: nowIso }).eq("id", c.id).eq("status", c.status).eq("updated_at", c.updated_at).select("*").maybeSingle();
        const row = check(won, "Could not claim a file") as FileWithStamp | null;
        if (row) return row;
      }
      return null;
    },

    async updateFile(id, patch) {
      check(await sb.from("invoice_files").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id), "Could not update a file");
    },

    async venueSlug(venueId) {
      const row = check(await sb.from("cost_venues").select("slug").eq("id", venueId).maybeSingle(), "Could not find the venue") as { slug?: string } | null;
      if (!row?.slug) throw new Error("That file belongs to a venue the app does not know.");
      return row.slug;
    },

    async listDocuments(fileId) {
      const rows = check(await sb.from("invoice_documents").select(DOC_COLS).eq("file_id", fileId).order("created_at", { ascending: true }), "Could not list documents");
      return ((rows ?? []) as unknown as DocShell[]).sort((a, b) => (a.pages[0] ?? 0) - (b.pages[0] ?? 0));
    },

    async createDocuments(fileId, venueId, docs: ShellInput[]) {
      const rows = docs.map((d) => ({ file_id: fileId, venue_id: venueId, doc_type: d.doc_type, supplier_name_read: d.supplier_name_read, invoice_number: d.invoice_number, pages: d.pages, status: "needs_review" }));
      check(await insertRows(sb, "invoice_documents", rows), "Could not create the documents");
      return this.listDocuments(fileId);
    },

    async updateDocument(id, patch) {
      check(await sb.from("invoice_documents").update(patch).eq("id", id), "Could not update a document");
    },
  };
}

export function supabaseStorage(sb: SupabaseClient): PipelineStorage {
  return {
    async download(bucket, path) {
      const { data, error } = await sb.storage.from(bucket).download(path);
      if (error || !data) throw new Error("Could not fetch the scanned PDF from storage.");
      return new Uint8Array(await data.arrayBuffer());
    },
    async upload(bucket, path, bytes, contentType) {
      const { error } = await sb.storage.from(bucket).upload(path, bytes, { contentType, upsert: true });
      if (error) throw new Error("Could not save the split PDF to storage.");
    },
    async signedUrl(bucket, path, seconds) {
      const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, seconds);
      return error || !data ? null : data.signedUrl;
    },
  };
}

// ---------------------------------------------------------------- the upload route's store
export interface IngestFile {
  id: string;
  status: InvoiceFileRow["status"];
  attempts: number;
  storage_path: string;
}

export interface IngestStore {
  venueIdForSlug(slug: string): Promise<number | null>;
  findFile(venueId: number, sha256: string): Promise<IngestFile | null>;
  createFile(row: { venue_id: number; source_name: string | null; drive_file_id: string | null; storage_path: string; sha256: string; page_count: number | null; attempts: number }): Promise<IngestFile>;
  getFile(id: string): Promise<IngestFile | null>;
  setAttempts(id: string, attempts: number): Promise<void>;
  signedUploadUrl(path: string): Promise<{ uploadUrl: string; token: string } | null>;
  objectExists(path: string): Promise<boolean>;
}

export function supabaseIngestStore(sb: SupabaseClient): IngestStore {
  const COLS = "id, status, attempts, storage_path";
  return {
    async venueIdForSlug(slug) {
      const row = check(await sb.from("cost_venues").select("id").eq("slug", slug).maybeSingle(), "Could not look up the venue") as { id: number } | null;
      return row?.id ?? null;
    },
    async findFile(venueId, sha256) {
      return check(await sb.from("invoice_files").select(COLS).eq("venue_id", venueId).eq("sha256", sha256).maybeSingle(), "Could not look up the file") as IngestFile | null;
    },
    async createFile(row) {
      check(await insertRow(sb, "invoice_files", { ...row, status: "received" }), "Could not record the file");
      const made = await this.findFile(row.venue_id, row.sha256);
      if (!made) throw new Error("Could not record the file.");
      return made;
    },
    async getFile(id) {
      return check(await sb.from("invoice_files").select(COLS).eq("id", id).maybeSingle(), "Could not look up the file") as IngestFile | null;
    },
    async setAttempts(id, attempts) {
      check(await sb.from("invoice_files").update({ attempts, updated_at: new Date().toISOString() }).eq("id", id), "Could not update the file");
    },
    async signedUploadUrl(path) {
      const { data, error } = await sb.storage.from("invoice-pdfs").createSignedUploadUrl(path, { upsert: true });
      return error || !data ? null : { uploadUrl: data.signedUrl, token: data.token };
    },
    async objectExists(path) {
      const slash = path.lastIndexOf("/");
      const { data, error } = await sb.storage.from("invoice-pdfs").list(path.slice(0, slash), { search: path.slice(slash + 1), limit: 5 });
      return !error && Array.isArray(data) && data.some((o) => o.name === path.slice(slash + 1));
    },
  };
}
