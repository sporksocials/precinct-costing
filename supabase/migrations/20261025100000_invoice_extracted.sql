-- Keep each invoice's raw reading and which version of the checks produced its current analysis, so improving the checks can re-analyse
-- every stored invoice WITHOUT another (paid) read of the PDF.
alter table public.invoice_documents add column if not exists extracted jsonb;
alter table public.invoice_documents add column if not exists analysis_version integer not null default 0;
comment on column public.invoice_documents.extracted is 'The reader''s validated reading of this invoice (ExtractedInvoice JSON), kept so the checks can be re-run without re-reading the PDF.';
comment on column public.invoice_documents.analysis_version is 'ENGINE_VERSION in lib/invoice-engine.ts when the stored analysis was made; an older version is re-analysed from `extracted` when the app is idle.';
