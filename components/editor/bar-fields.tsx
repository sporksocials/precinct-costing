"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Camera, Plus, X } from "lucide-react";
import { composeGlass, cleanOptionName, findOption, optionsOf, parseGlass } from "@/lib/glass-rim";
import { useStore } from "@/lib/store";
import { barPhotoSrc, isBarVenue, isUploadedPhoto, textList } from "@/lib/bar";
import { uploadBarPhoto } from "@/lib/bar-photo";
import { DEMO, getSupabaseBrowser } from "@/lib/supabase/client";
import type { BarOptionKind, MenuItem } from "@/lib/types";
import { Banner, Group, Row, Sheet, Toggle, useToast } from "../ui";

/**
 * Bar display card for a cocktail or mocktail: the glass, method steps and garnish the venue's cocktail
 * station iPad shows (/bar/<venue>). Edits go through the recipe editor's draft, so they autosave with
 * everything else (store.updateItem).
 */
export function BarDisplayFields({ item, venueSlug, onPatch }: { item: MenuItem; venueSlug: string | undefined; onPatch: (p: Partial<MenuItem>) => void }) {
  const station = venueSlug && isBarVenue(venueSlug) ? `/bar/${venueSlug}` : null;
  return (
    <>
      <Group
        title="Bar Display"
        className="mt-6"
        trailing={
          station ? (
            <a href={station} target="_blank" rel="noopener noreferrer" className="pb-0.5 text-[13px] font-medium text-accent hover:underline">
              Open Station
            </a>
          ) : null
        }
      >
        <Toggle
          label="Show On Cocktail Station"
          sub={item.active ? "Bartenders can see this drink on the station." : "Not active: hidden from the station and from averages. Turn it on when the drink is ready or on the menu."}
          checked={item.active}
          onChange={(v) => onPatch({ active: v })}
        />
        <PhotoField item={item} onPatch={onPatch} />
        <GlassRimRows item={item} onPatch={onPatch} />
      </Group>
      <OrderedList title="Method" noun="Step" placeholder="e.g. Shake hard for 12 seconds" value={item.method} onChange={(v) => onPatch({ method: v })} className="mt-4" />
      <OrderedList
        title="Garnish"
        noun="Garnish"
        placeholder="e.g. Dehydrated lime wheel"
        value={item.garnish}
        onChange={(v) => onPatch({ garnish: v })}
        className="mt-4"
        footer="The cocktail station shows this drink once it has a glass, method or garnish and Show On Cocktail Station is on."
      />
    </>
  );
}

const OPTION_TEXT: Record<BarOptionKind, { row: string; sheet: string; add: string; addTitle: string; noun: string; none: string; placeholder: string }> = {
  glass: { row: "Glass", sheet: "Glass", add: "Add A New Glass Type", addTitle: "New Glass Type", noun: "glass type", none: "No Glass", placeholder: "e.g. Tiki Mug" },
  rim: { row: "Rim", sheet: "Rim", add: "Add A New Rim", addTitle: "New Rim", noun: "rim", none: "None", placeholder: "e.g. Tajin" },
};

/**
 * Glass and Rim: two visible rows that open a list to choose from, with "Add A New ..." at the bottom of each list.
 * The drink still stores ONE text value ("High Ball Glass, Salt Rim", see lib/glass-rim.ts) because the cocktail
 * station reads that text. A stored value that is not in the list (old or hand typed) shows as a one-off entry and is
 * never lost: it stays until the other picker or this one is changed.
 */
function GlassRimRows({ item, onPatch }: { item: MenuItem; onPatch: (p: Partial<MenuItem>) => void }) {
  const store = useStore();
  const toast = useToast();
  const [sheet, setSheet] = useState<null | { kind: BarOptionKind; adding: boolean }>(null);
  const parts = parseGlass(item.glass);
  const lists = { glass: optionsOf(store.barOptions, "glass"), rim: optionsOf(store.barOptions, "rim") };
  const current: Record<BarOptionKind, string> = { glass: parts.glass, rim: parts.rim };
  // show the list's own spelling when the stored text only differs by case
  const shown: Record<BarOptionKind, string> = {
    glass: findOption(store.barOptions, "glass", parts.glass)?.name ?? parts.glass,
    rim: findOption(store.barOptions, "rim", parts.rim)?.name ?? parts.rim,
  };

  const choose = (kind: BarOptionKind, name: string) => {
    onPatch({ glass: kind === "glass" ? composeGlass(name, parts.rim) : composeGlass(parts.glass, name) });
    setSheet(null);
  };
  const close = () => setSheet(null);

  return (
    <>
      <Row onClick={() => setSheet({ kind: "glass", adding: false })} title="Glass" trailing={<span className={shown.glass ? "text-label-2" : "text-label-3"}>{shown.glass || "Choose"}</span>} chevron />
      {parts.glass ? (
        <Row onClick={() => setSheet({ kind: "rim", adding: false })} title="Rim" trailing={<span className={shown.rim ? "text-label-2" : "text-label-3"}>{shown.rim || "None"}</span>} chevron />
      ) : (
        <Row title="Rim" sub="Choose a glass first" trailing={<span className="text-label-3">None</span>} className="opacity-60" />
      )}
      {(["glass", "rim"] as const).map((kind) => {
        const t = OPTION_TEXT[kind];
        const options = lists[kind];
        const oneOff = current[kind] && !findOption(store.barOptions, kind, current[kind]) ? current[kind] : null;
        const sel = current[kind].toLowerCase();
        return (
          <React.Fragment key={kind}>
            <Sheet open={sheet?.kind === kind && !sheet.adding} onClose={close} title={t.sheet} cancelLabel={null} action={{ label: "Done", onClick: close }}>
              <div className="group-list mt-3">
                <Row title={t.none} onClick={() => choose(kind, "")} trailing={!current[kind] ? <span className="text-accent">✓</span> : null} />
                {oneOff ? <Row title={oneOff} sub="One-off entry, not in the list" onClick={() => choose(kind, oneOff)} trailing={<span className="text-accent">✓</span>} /> : null}
                {options.map((o) => (
                  <Row key={o.id} title={o.name} onClick={() => choose(kind, o.name)} trailing={o.name.toLowerCase() === sel ? <span className="text-accent">✓</span> : null} />
                ))}
                <Row
                  title={t.add}
                  titleClassName="!text-accent"
                  leading={<Plus className="h-5 w-5 text-accent" strokeWidth={2.25} />}
                  onClick={() => setSheet({ kind, adding: true })}
                />
              </div>
            </Sheet>
            {sheet?.kind === kind && sheet.adding ? (
              <AddOptionSheet
                kind={kind}
                onBack={() => setSheet({ kind, adding: false })}
                onAdded={(name, existed) => {
                  if (existed) toast.show({ message: `${name} is already in the list. Selected it.` });
                  choose(kind, name);
                }}
              />
            ) : null}
          </React.Fragment>
        );
      })}
    </>
  );
}

/** The small pop-up behind "Add A New Glass Type" / "Add A New Rim": one text field and an Add button. */
function AddOptionSheet({ kind, onBack, onAdded }: { kind: BarOptionKind; onBack: () => void; onAdded: (name: string, existed: boolean) => void }) {
  const store = useStore();
  const t = OPTION_TEXT[kind];
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = cleanOptionName(text, kind);
  const existing = clean ? findOption(store.barOptions, kind, clean) : undefined;
  const canAdd = clean.length > 0 && !busy;

  async function add() {
    if (!canAdd) return;
    setBusy(true);
    setError(null);
    try {
      const option = await store.addBarOption(kind, clean);
      onAdded(option.name, !!existing);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : `Couldn't add the ${t.noun}. Try again.`);
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onBack} title={t.addTitle} size="sm" action={{ label: busy ? "Adding…" : "Add", onClick: () => void add(), disabled: !canAdd }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
        className="space-y-3 pb-2 pt-3"
      >
        {error ? <Banner>{error}</Banner> : null}
        <input autoFocus className="field !py-3.5" placeholder={t.placeholder} value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="done" aria-label={kind === "glass" ? "Glass Type Name" : "Rim Name"} />
        <p className="min-h-[1.25rem] px-1 text-[13px] text-label-2">
          {existing
            ? `${existing.name} is already in the list. Add selects it.`
            : clean
              ? kind === "rim"
                ? `Shows on the station as “${clean} Rim”.`
                : `Added for every venue as “${clean}”.`
              : kind === "rim"
                ? "Just the rim, e.g. Tajin. The station adds the word Rim."
                : "Every venue can pick it once it is added."}
        </p>
        <button type="submit" className="btn-primary w-full" disabled={!canAdd}>
          {busy ? "Adding…" : "Add"}
        </button>
      </form>
    </Sheet>
  );
}

/**
 * The drink's reference photo: shown beside the ingredients on the cocktail station. Upload one (shrunk in the browser
 * before it goes up) and it replaces the placeholder; the station picks it up on its next refresh.
 */
function PhotoField({ item, onPatch }: { item: MenuItem; onPatch: (p: Partial<MenuItem>) => void }) {
  return (
    <PhotoRow
      itemId={item.id}
      title="Reference Photo"
      src={barPhotoSrc(item.name, item.bar_photo)}
      uploaded={isUploadedPhoto(item.bar_photo)}
      stationName="station"
      noPhotoText="No photo yet. Upload one of the finished drink."
      uploadedText="Shown on the cocktail station."
      placeholderText="Placeholder photo. Upload a real one to replace it."
      onChange={(path) => onPatch({ bar_photo: path })}
    />
  );
}

/** A photo row with Upload / Replace / Remove, shared by the bar and kitchen editors. `onChange` gets the new storage path, or null on Remove. */
export function PhotoRow({
  itemId,
  title,
  src,
  uploaded,
  stationName,
  noPhotoText,
  uploadedText,
  placeholderText,
  onChange,
}: {
  itemId: string;
  title: string;
  src: string | null;
  uploaded: boolean;
  stationName: string;
  noPhotoText: string;
  uploadedText: string;
  placeholderText: string;
  onChange: (path: string | null) => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);

  async function pick(file: File) {
    if (DEMO) {
      toast.show({ message: "Photo upload isn't available in demo mode." });
      return;
    }
    setBusy(true);
    try {
      const path = await uploadBarPhoto(getSupabaseBrowser(), itemId, file);
      onChange(path);
      toast.show({ message: `Photo uploaded. The ${stationName} shows it within 5 minutes.` });
    } catch (e) {
      toast.show({ message: e instanceof Error && e.message ? e.message : "Couldn't upload the photo. Try again." });
    } finally {
      setBusy(false);
    }
  }

  const missing = broken || !src;
  const sub = missing ? noPhotoText : uploaded ? uploadedText : placeholderText;
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="relative h-[92px] w-[72px] shrink-0 overflow-hidden rounded-lg bg-fill">
        {missing ? (
          <Camera aria-hidden className="absolute inset-0 m-auto h-6 w-6 text-label-3" strokeWidth={1.75} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="h-full w-full object-cover" onError={() => setBroken(true)} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[17px] sm:text-[15px]">{title}</p>
        <p className="text-[13px] text-label-2">{sub}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-accent-soft px-4 text-[15px] font-semibold text-accent transition-opacity active:opacity-70 disabled:opacity-50 sm:min-h-[36px]"
          >
            <Camera aria-hidden className="h-[18px] w-[18px]" strokeWidth={2} />
            {busy ? "Uploading…" : missing ? "Upload Photo" : "Replace Photo"}
          </button>
          {uploaded && !busy ? (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="min-h-[44px] rounded-lg px-3 text-[15px] font-medium text-label-2 transition-colors hover:bg-fill active:bg-fill-2 sm:min-h-[36px]"
            >
              Remove Upload
            </button>
          ) : null}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label="Choose a photo"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void pick(f);
        }}
      />
    </div>
  );
}

type Entry = { key: number; text: string };
const clean = (rows: Entry[]) => rows.map((r) => r.text.trim()).filter(Boolean);

/** An ordered list of short lines (method steps, garnishes): edit in place, move up or down, remove, add. */
export function OrderedList({
  title,
  noun,
  placeholder,
  value,
  onChange,
  className,
  footer,
}: {
  title: string;
  noun: string;
  placeholder: string;
  value: string[] | null | undefined;
  onChange: (v: string[] | null) => void;
  className?: string;
  footer?: string;
}) {
  const toast = useToast();
  const saved = textList(value);
  const savedSig = JSON.stringify(saved);
  // keys only give React a stable identity per row (focus survives a move); edits go by position
  const keyRef = useRef(0);
  const toEntries = (v: string[]) => v.map((text) => ({ key: ++keyRef.current, text }));
  // local rows keep blank and half-typed lines; the record only ever gets the non-blank ones
  const [rows, setRows] = useState<Entry[]>(() => toEntries(saved));
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const sigRef = useRef(savedSig);
  sigRef.current = savedSig;

  // adopt a change made elsewhere (undo, background refresh) without clobbering a blank line being typed
  useEffect(() => {
    setRows((r) => (JSON.stringify(clean(r)) === savedSig ? r : (JSON.parse(savedSig) as string[]).map((text) => ({ key: ++keyRef.current, text }))));
  }, [savedSig]);

  const update = (next: Entry[]) => {
    setRows(next);
    const c = clean(next);
    if (JSON.stringify(c) !== sigRef.current) onChange(c.length ? c : null);
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  };
  const remove = (i: number) => {
    const before = rows;
    const gone = rows[i];
    update(rows.filter((_, k) => k !== i));
    if (gone.text.trim())
      toast.show({
        message: `Removed ${noun.toLowerCase()} ${i + 1}`,
        action: { label: "Undo", onClick: () => update(before) },
      });
  };
  const add = () => {
    const e = { key: ++keyRef.current, text: "" };
    setRows([...rows, e]);
    setFocusKey(e.key);
  };

  return (
    <Group title={title} className={className} footer={footer}>
      {rows.map((r, i) => (
        <div key={r.key} className="flex min-h-[48px] items-start gap-2 py-1.5 pl-4 pr-1.5">
          <span aria-hidden className="mt-[9px] flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent tnum">
            {i + 1}
          </span>
          <GrowingText
            value={r.text}
            placeholder={placeholder}
            label={`${title} ${noun === "Step" ? "Step " : ""}${i + 1}`}
            autoFocus={focusKey === r.key}
            onChange={(text) => update(rows.map((x, k) => (k === i ? { ...x, text } : x)))}
            onEnter={add}
          />
          <span className="flex shrink-0 items-center">
            <IconButton label={`Move ${noun} ${i + 1} Up`} disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.25} />
            </IconButton>
            <IconButton label={`Move ${noun} ${i + 1} Down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown className="h-[18px] w-[18px]" strokeWidth={2.25} />
            </IconButton>
            <IconButton label={`Remove ${noun} ${i + 1}`} onClick={() => remove(i)}>
              <X className="h-[18px] w-[18px]" strokeWidth={2.25} />
            </IconButton>
          </span>
        </div>
      ))}
      <button type="button" onClick={add} className="flex min-h-[48px] w-full items-center gap-2 px-4 text-left text-[17px] text-accent transition-colors hover:bg-fill active:bg-fill sm:text-[15px]">
        <Plus className="h-5 w-5" strokeWidth={2.25} />
        Add {noun}
      </button>
    </Group>
  );
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-11 w-9 items-center justify-center rounded-lg text-label-2 transition-colors hover:bg-fill hover:text-label active:bg-fill-2 disabled:pointer-events-none disabled:opacity-25 sm:h-9 sm:w-8"
    >
      {children}
    </button>
  );
}

/** One-line text that wraps and grows as it gets longer (steps can be a full sentence). Enter adds the next line. */
function GrowingText({ value, placeholder, label, autoFocus, onChange, onEnter }: { value: string; placeholder: string; label: string; autoFocus?: boolean; onChange: (v: string) => void; onEnter: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => onChange(e.target.value.replace(/\n/g, " "))}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onEnter();
        }
      }}
      className="block min-w-0 flex-1 resize-none overflow-hidden bg-transparent py-2 text-[17px] leading-snug text-label outline-none placeholder:text-label-3 sm:text-[15px]"
    />
  );
}
