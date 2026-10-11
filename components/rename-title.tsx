"use client";

import React, { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import type { NameKind } from "@/lib/name-check";
import { NameSuggestRow, useNameTidy } from "./name-suggest";
import { cx, useToast } from "./ui";

/**
 * The page title of a record that saves each field on its own (an ingredient, a tap beer), with a visible Rename button beside it
 * (Troy, 11 Oct 2026: "make it simple to change an ingredient name or menu item name"). Tap it and the title becomes a text box
 * with Save and Cancel (44px); Enter saves, Escape cancels. The name is tidied exactly like every other name field (capitals, then
 * the quiet "Did you mean" row), a name another record already has is refused in plain words BEFORE saving (`taken`), a failed save
 * says so and keeps what was typed, and a rename can be undone from the toast. It replaces the name row that used to hide under Advanced.
 */
export function RenameTitle({ name, kind, onSave, taken }: { name: string; kind: NameKind; onSave: (name: string) => Promise<void> | void; taken?: (name: string) => string | null }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const nt = useNameTidy({ kind, value: name, setValue: (v) => void save(v, false), own: name });

  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);

  const start = () => {
    setText(name);
    setError(null);
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setError(null);
  };

  async function save(typed: string, tidy = true) {
    const next = tidy ? nt.commit(typed) : typed.trim();
    if (!next) return setError("A name is needed.");
    if (next === name) return cancel();
    const clash = taken?.(next) ?? null;
    if (clash) return setError(clash);
    setBusy(true);
    setError(null);
    try {
      await onSave(next);
      setEditing(false);
      toast.show({ message: `Renamed to ${next}`, action: { label: "Undo", onClick: () => void Promise.resolve(onSave(name)).catch(() => undefined) } });
    } catch (e) {
      setError(e instanceof Error && e.message ? `Couldn’t rename: ${e.message}` : "Couldn’t rename. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <>
        <div className="mt-2 flex items-start gap-1">
          <h1 className="min-w-0 flex-1 text-[28px] font-bold leading-tight tracking-tight lg:text-[32px]">{name}</h1>
          <button type="button" onClick={start} aria-label={`Rename ${name}`} className="-mr-2 inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-1.5 rounded-xl px-2 text-[15px] font-semibold text-accent active:opacity-70">
            <Pencil aria-hidden className="h-[18px] w-[18px]" strokeWidth={2.25} />
            <span>Rename</span>
          </button>
        </div>
        <NameSuggestRow nt={nt} className="mt-1" />
      </>
    );
  }
  return (
    <form
      className="mt-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save(text);
      }}
    >
      <input
        ref={input}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        aria-label="Name"
        aria-invalid={error ? true : undefined}
        enterKeyHint="done"
        autoComplete="off"
        className={cx("field w-full text-[22px] font-bold lg:text-[24px]", error && "ring-2 ring-[color:var(--danger)]")}
      />
      {error ? (
        <p role="alert" className="mt-1.5 text-[15px] font-medium text-danger sm:text-[13px]">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex gap-2">
        <button type="submit" disabled={busy} className="btn-primary !min-h-[44px] !px-5 !text-[15px]">
          {busy ? "Saving..." : "Save"}
        </button>
        <button type="button" onClick={cancel} disabled={busy} className="btn-plain !min-h-[44px] !px-5 !text-[15px]">
          Cancel
        </button>
      </div>
    </form>
  );
}
