"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo } from "react";
import { EyeOff, Undo2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { alertKindLabel, ignoredWhen, sortIgnored, type AlertEntry, type AlertKind } from "@/lib/ignored-alerts";
import type { IgnoredAlert } from "@/lib/types";
import { cx, Group, Row, Segmented, useToast } from "./ui";
import { usePersonName } from "./use-person-name";

/* Ignore and Restore on the Today feed. The ignored list is shared by everyone (cost_ignored_alerts). */

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Ignore an alert with a toast whose Undo restores it. A failure puts the alert back and says why. */
export function useIgnoreAlert(): (entry: AlertEntry) => void {
  const store = useStore();
  const toast = useToast();
  const { ignoreAlert, restoreAlert } = store;
  return useCallback(
    (entry: AlertEntry) => {
      ignoreAlert(entry).then(
        () =>
          toast.show(
            {
              message: `Ignored ${entry.title}`,
              action: { label: "Undo", onClick: () => void restoreAlert(entry.key).catch((e) => toast.show({ message: messageOf(e) })) },
            },
            7000,
          ),
        (e) => toast.show({ message: messageOf(e).startsWith("Ignoring") ? messageOf(e) : `Couldn’t ignore that. ${messageOf(e)}` }),
      );
    },
    [ignoreAlert, restoreAlert, toast],
  );
}

/** Put an ignored alert back, with a toast whose Undo ignores it again. */
function useRestoreAlert(): (a: IgnoredAlert) => void {
  const { ignoreAlert, restoreAlert } = useStore();
  const toast = useToast();
  return useCallback(
    (a: IgnoredAlert) => {
      const entry: AlertEntry = { key: a.alert_key, kind: a.kind as AlertKind, ref: a.ref ?? "/", title: a.title ?? alertKindLabel(a.kind) };
      restoreAlert(a.alert_key).then(
        () =>
          toast.show(
            {
              message: `Restored ${entry.title}`,
              action: { label: "Undo", onClick: () => void ignoreAlert(entry).catch((e) => toast.show({ message: messageOf(e) })) },
            },
            7000,
          ),
        (e) => toast.show({ message: `Couldn’t restore that. ${messageOf(e)}` }),
      );
    },
    [ignoreAlert, restoreAlert, toast],
  );
}

const actionButton = "inline-flex min-h-[44px] items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[15px] font-medium transition active:scale-[0.97] sm:min-h-[32px] sm:px-3 sm:text-[13px]";

/**
 * A feed row (a link to the thing, with its chevron) plus one visible action button. The button is its own tap target,
 * never inside the link: on phones it sits under the text, in line with it; from the sm breakpoint it sits at the right.
 */
export function ActionRow({ action, ...row }: Omit<React.ComponentProps<typeof Row>, "className"> & { action: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center">
      <Row {...row} className="col-span-2 sm:col-span-1" />
      <div className="col-span-2 -mt-1 pb-2.5 pl-16 pr-4 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:mt-0 sm:p-0 sm:pr-4">{action}</div>
    </div>
  );
}

/** The visible Ignore button (also used inside the Below Target cards and table). */
export function IgnoreButton({ entry, className, quiet }: { entry: AlertEntry; className?: string; quiet?: boolean }) {
  const ignore = useIgnoreAlert();
  return (
    <button
      type="button"
      aria-label={`Ignore ${entry.title}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        ignore(entry);
      }}
      className={cx(actionButton, quiet ? "text-label-2 hover:text-label" : "bg-fill text-label-2 hover:text-label", className)}
    >
      <EyeOff className="h-4 w-4" strokeWidth={2.25} aria-hidden />
      Ignore
    </button>
  );
}

/** A feed row with a visible Ignore button. */
export function AlertRow({ entry, ...row }: { entry: AlertEntry } & Omit<React.ComponentProps<typeof Row>, "className">) {
  return <ActionRow {...row} action={<IgnoreButton entry={entry} />} />;
}

/* ---------------------------------------------------------------- Open | Ignored */

export type AlertView = "open" | "ignored";

/** Which view of the alerts is showing: ?alerts=ignored in the URL (absent means Open), so Back from an alert returns to the same view. */
export function useAlertView(): [AlertView, (v: AlertView) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const view: AlertView = params.get("alerts") === "ignored" ? "ignored" : "open";
  const set = useCallback(
    (next: AlertView) => {
      const p = new URLSearchParams(params.toString());
      if (next === "open") p.delete("alerts");
      else p.set("alerts", "ignored");
      const q = p.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [params, router, pathname],
  );
  return [view, set];
}

/** Always-visible "Open | Ignored (n)" control at the top of the alerts. */
export function AlertTabs({ view, onChange, ignoredCount, className }: { view: AlertView; onChange: (v: AlertView) => void; ignoredCount: number; className?: string }) {
  return (
    <Segmented<AlertView>
      ariaLabel="Alerts"
      className={cx("sm:max-w-[320px]", className)}
      value={view}
      onChange={onChange}
      options={[
        { value: "open", label: "Open" },
        { value: "ignored", label: <span className="tnum">Ignored ({ignoredCount})</span> },
      ]}
    />
  );
}

/** Keeps the shared list fresh: reads it when Today opens and again when the tab comes back to the front. */
export function useRefreshIgnored() {
  const { refreshIgnoredAlerts, ready } = useStore();
  useEffect(() => {
    if (!ready) return;
    void refreshIgnoredAlerts();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshIgnoredAlerts();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [ready, refreshIgnoredAlerts]);
}

/** Everything that has been ignored, newest first: what it was, which kind, who and when, with Restore on each. */
export function IgnoredView() {
  const { ignoredAlerts } = useStore();
  const nameOf = usePersonName();
  const restore = useRestoreAlert();
  const rows = useMemo(() => sortIgnored(ignoredAlerts), [ignoredAlerts]);
  if (!rows.length) {
    return (
      <div className="mt-3 flex items-center gap-3 rounded-2xl bg-surface px-4 py-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fill-2 text-label-2">
          <EyeOff className="h-5 w-5" strokeWidth={2.25} aria-hidden />
        </span>
        <span>
          <span className="block text-[17px] font-semibold sm:text-[15px]">Nothing Ignored</span>
          <span className="block text-[15px] text-label-2 sm:text-[13px]">Tap Ignore on an alert and it moves here, so you can look at it again later.</span>
        </span>
      </div>
    );
  }
  return (
    <Group
      title={`Ignored · ${rows.length}`}
      className="mt-4"
      inset="3.75rem"
      footer="Ignored alerts stay hidden for everyone until restored. One comes back by itself if the situation changes, such as a new price rise."
    >
      {rows.map((a) => (
        <ActionRow
          key={a.id}
          href={a.ref ?? undefined}
          leading={
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-fill-2 text-label-2">
              <EyeOff className="h-[18px] w-[18px]" strokeWidth={2.25} aria-hidden />
            </span>
          }
          title={a.title ?? alertKindLabel(a.kind)}
          wrapSub
          sub={[alertKindLabel(a.kind), `Ignored by ${nameOf(a.ignored_by) ?? "Someone"}`, ignoredWhen(a.ignored_at)].filter(Boolean).join(" · ")}
          chevron={!!a.ref}
          action={
            <button
              type="button"
              aria-label={`Restore ${a.title ?? alertKindLabel(a.kind)}`}
              onClick={() => restore(a)}
              className={cx(actionButton, "bg-accent-soft text-accent")}
            >
              <Undo2 className="h-4 w-4" strokeWidth={2.25} aria-hidden />
              Restore
            </button>
          }
        />
      ))}
    </Group>
  );
}
