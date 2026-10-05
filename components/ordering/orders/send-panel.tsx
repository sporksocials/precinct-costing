"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, LogIn, Mail, type LucideIcon } from "lucide-react";
import { cx } from "@/components/ui";
import { sendReasons, type SendAction, type SendActionId, type SupplierSend } from "@/lib/ordering-orders-ui";
import type { OrderingSupplier } from "@/lib/ordering-types";
import { copyText } from "./clipboard";
import { Notice, btnPlain, btnPrimary } from "./parts";

const ICON: Record<SendActionId, LucideIcon> = { email: Mail, outlook: ExternalLink, copy: Copy, login: LogIn };

/**
 * The send panel of one order: one button for every way of sending, and a separate, deliberate Mark As Sent. The lines
 * above are the preview and the email draft shows the text; the text box appears only when Copy Order is refused by the
 * browser, so it can be copied by hand. Opening an email draft does not prove it was sent, so nothing is saved until the
 * person taps Mark As Sent.
 */
export function SendPanel({
  supplier,
  send,
  actions,
  onUsed,
  onMarkSent,
  markDisabled,
}: {
  supplier: Pick<OrderingSupplier, "method">;
  send: SupplierSend;
  actions: SendAction[];
  /** the last way the person used, remembered so Mark As Sent records it automatically */
  onUsed: (id: SendActionId) => void;
  onMarkSent: () => void;
  markDisabled: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // a new text means the last copy is no longer what is on screen
  useEffect(() => {
    setCopied(false);
  }, [send.body]);

  const doCopy = () => {
    onUsed("copy");
    // the text already exists (built while rendering); the click is still being handled when copyText starts
    void copyText(send.body).then((ok) => {
      window.clearTimeout(timer.current);
      if (ok) {
        setCopyFailed(false);
        setCopied(true);
        timer.current = window.setTimeout(() => setCopied(false), 4000);
      } else {
        setCopied(false);
        setCopyFailed(true);
        window.requestAnimationFrame(() => {
          area.current?.focus();
          area.current?.select();
        });
      }
    });
  };

  const reasons = sendReasons(actions);
  const rows = Math.min(18, Math.max(5, send.body.split("\n").length + 1));
  return (
    <div className="border-t border-[color:var(--separator)] px-4 py-4">
      <h4 className="text-[15px] font-semibold text-label">Send This Order</h4>

      <div className="mt-3 flex flex-wrap gap-2">
        {actions.map((a) => {
          const Icon = a.id === "copy" && copied ? Check : ICON[a.id];
          const cls = a.primary ? btnPrimary : btnPlain;
          const label = a.id === "copy" && copied ? "Copied" : a.label;
          if (!a.enabled) {
            return (
              <button key={a.id} type="button" disabled aria-disabled="true" className={cls}>
                <Icon aria-hidden className="h-[18px] w-[18px]" strokeWidth={2.25} />
                {a.label}
              </button>
            );
          }
          if (a.href) {
            return (
              <a key={a.id} href={a.href} {...(a.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})} onClick={() => onUsed(a.id)} className={cls}>
                <Icon aria-hidden className="h-[18px] w-[18px]" strokeWidth={2.25} />
                {a.label}
              </a>
            );
          }
          return (
            <button key={a.id} type="button" onClick={doCopy} className={cls}>
              <Icon aria-hidden className="h-[18px] w-[18px]" strokeWidth={2.25} />
              {label}
            </button>
          );
        })}
      </div>
      <p role="status" aria-live="polite" className={cx("mt-2 text-[14px] font-medium text-good", !copied && "sr-only")}>
        {copied ? "Copied. Paste it into the email or the supplier's website." : ""}
      </p>
      {copyFailed ? (
        <div className="mt-2">
          <Notice tone="warn" role="alert">
            Your browser would not copy it. The text is selected below, so press Ctrl+C (Cmd+C on a Mac) to copy it by hand.
          </Notice>
          <label className="mt-2 block">
            <span className="sr-only">The exact text of this order</span>
            <textarea ref={area} readOnly rows={rows} value={send.body} className="block w-full resize-y rounded-xl bg-fill px-3.5 py-3 text-[15px] leading-relaxed text-label outline-none focus:shadow-[inset_0_0_0_1.5px_var(--accent-fill)]" />
          </label>
        </div>
      ) : null}
      {reasons.map((r) => (
        <p key={r} className="mt-2 text-[13px] text-label-2">
          {r}
        </p>
      ))}
      {supplier.method === "app" ? <p className="mt-2 text-[13px] text-label-2">This supplier takes orders in its own app. Copy the list, place the order there, then mark it as sent here.</p> : null}
      {supplier.method === "website" ? <p className="mt-2 text-[13px] text-label-2">This supplier takes orders on its website. Copy the list, sign in and place the order, then mark it as sent here.</p> : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-fill px-3.5 py-3">
        <p className="min-w-0 flex-1 basis-60 text-[14px] leading-snug text-label-2">{supplier.method === "email" ? "Opening an email draft does not send it. " : ""}Tap Mark As Sent once the order has gone.</p>
        <button type="button" onClick={onMarkSent} disabled={markDisabled} className={btnPlain}>
          <Check aria-hidden className="h-[18px] w-[18px]" strokeWidth={2.5} />
          Mark As Sent
        </button>
      </div>
    </div>
  );
}
