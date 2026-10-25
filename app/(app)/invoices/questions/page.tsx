import { redirect } from "next/navigation";

/**
 * The old Match Lines address (kept for the weekly email, Slack digests and any saved link). The work now lives in the Invoices
 * To Do: `?doc=<id>` opens that one invoice's items, anything else goes to the To Do list, keeping `?venue=`.
 */
export default function InvoiceQuestionsRedirect({ searchParams }: { searchParams: { [key: string]: string | string[] | undefined } }) {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const doc = one(searchParams.doc);
  if (doc && /^[0-9a-zA-Z-]{8,64}$/.test(doc)) redirect(`/invoices/match/doc/${doc}`);
  const venue = one(searchParams.venue);
  const q = new URLSearchParams({ tab: "todo" });
  if (venue && /^[a-z0-9-]{1,32}$/i.test(venue)) q.set("venue", venue);
  redirect(`/invoices?${q.toString()}`);
}
