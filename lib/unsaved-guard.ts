/**
 * Leave guard for pages that hold unsaved edits. Framework free (the browser is injected as `GuardEnv`), so the
 * decisions are tested with a fake window and history; components/unsaved-guard.tsx wires it to React and Next.
 *
 * While the page is dirty the guard:
 *  - asks the browser to confirm a tab close or reload (beforeunload; the browser's own prompt is all that is possible)
 *  - catches same-site link clicks in the capture phase (before Next's Link sees them) and asks first
 *  - catches Back (and the iPad swipe back) by keeping one extra history entry on top of the page; going back lands on
 *    the page itself, the guard puts the entry back and asks first
 *  - lets code that navigates (router.push) ask through `request`
 * Everything is removed again when the page is clean or goes away. A failed save keeps the person on the page with all
 * three choices still available.
 */

export type PendingNav = { kind: "href"; href: string } | { kind: "back" };

export interface GuardPrompt {
  nav: PendingNav;
  /** a save is running for "Save And Leave" */
  busy: boolean;
  /** why the last "Save And Leave" did not work */
  error: string | null;
}

type Listener = (e: any) => void;
interface Target {
  addEventListener(type: string, fn: Listener, opts?: boolean | object): void;
  removeEventListener(type: string, fn: Listener, opts?: boolean | object): void;
}

export interface GuardEnv {
  win: Target;
  doc: Target;
  history: { pushState(data: unknown, unused: string, url?: string | null): void; go(delta: number): void };
  location: { href: string; origin: string };
  /** app navigation: Next's router.push, or router.replace when the guard's own history entry should be reused */
  navigate(href: string, replace: boolean): void;
}

export interface ClickLike {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target: unknown;
}

/**
 * The app path a click would navigate to, or null when the click is not an in-app navigation away from this page
 * (modified click, new tab, download, other site, mailto, same page or only a #hash).
 */
export function linkTarget(e: ClickLike, loc: { href: string; origin: string }): string | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const el = e.target as { closest?: (sel: string) => AnchorLike | null } | null;
  const a = el && typeof el.closest === "function" ? el.closest("a[href]") : null;
  if (!a) return null;
  const t = a.getAttribute("target");
  if (t && t !== "_self") return null;
  if (a.hasAttribute("download")) return null;
  const raw = a.getAttribute("href");
  if (!raw) return null;
  let url: URL;
  let here: URL;
  try {
    url = new URL(raw, loc.href);
    here = new URL(loc.href);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.origin !== loc.origin) return null;
  if (url.pathname === here.pathname && url.search === here.search) return null;
  return url.pathname + url.search + url.hash;
}
interface AnchorLike {
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
}

export type GuardSave = () => Promise<boolean>;

const SENTINEL = { unsavedGuard: true };
/** if a chosen way out did not take us off the page, resume guarding (a first visit to a route can take a few seconds) */
const HREF_WATCHDOG_MS = 6000;
const BACK_WATCHDOG_MS = 1500;
const POP_WAIT_MS = 400;

export class UnsavedGuard {
  private dirty = false;
  private save: GuardSave | null = null;
  private getError: (() => string | null) | null = null;
  private token: object | null = null;

  private armed = false;
  /** our extra history entry is on top of the page */
  private sentinel = false;
  private armedHref = "";
  /** we asked the browser to pop our entry; the next popstate is ours */
  private popPending = false;
  private popWaiters: (() => void)[] = [];
  /** a way out was chosen: stop guarding while it happens */
  private leaving = false;
  private watchdog: ReturnType<typeof setTimeout> | null = null;

  private prompt: GuardPrompt | null = null;
  private subs = new Set<() => void>();

  constructor(private env: GuardEnv) {}

  // ---------------------------------------------------------------- state for the UI

  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  };
  getPrompt = () => this.prompt;
  get isDirty() {
    return this.dirty;
  }
  /** true while listeners and the history entry are in place (for tests) */
  get isArmed() {
    return this.armed;
  }

  private setPrompt(p: GuardPrompt | null) {
    this.prompt = p;
    this.subs.forEach((f) => f());
  }

  // ---------------------------------------------------------------- the page registers

  /** The page that holds the edits. Returns the cleanup. `save` resolves true only when everything is saved. */
  register(save: GuardSave, getError?: () => string | null): () => void {
    const token = {};
    this.token = token;
    this.save = save;
    this.getError = getError ?? null;
    return () => {
      if (this.token === token) this.reset();
    };
  }

  setDirty(dirty: boolean) {
    this.dirty = dirty;
    this.sync();
  }

  private sync() {
    if (this.leaving) return;
    if (this.dirty && !this.armed) {
      if (!this.popPending) this.arm();
    } else if (!this.dirty && this.armed) {
      this.disarm();
    }
  }

  private arm() {
    const { win, doc, history, location } = this.env;
    this.armed = true;
    this.armedHref = location.href;
    win.addEventListener("beforeunload", this.onBeforeUnload);
    win.addEventListener("popstate", this.onPop);
    doc.addEventListener("click", this.onClick, true);
    if (!this.sentinel) {
      history.pushState(SENTINEL, "", location.href);
      this.sentinel = true;
    }
  }

  private dropListeners() {
    const { win, doc } = this.env;
    win.removeEventListener("beforeunload", this.onBeforeUnload);
    doc.removeEventListener("click", this.onClick, true);
    if (!this.popPending) win.removeEventListener("popstate", this.onPop);
  }

  /** The page is clean again: stop guarding and take our history entry back off. */
  private disarm() {
    this.armed = false;
    this.popSentinel();
    this.dropListeners();
    if (this.prompt && !this.prompt.busy) this.setPrompt(null);
  }

  /** Remove our history entry, but only if we are still on the page it was pushed on. */
  private popSentinel() {
    if (!this.sentinel) return;
    this.sentinel = false;
    if (this.env.location.href !== this.armedHref) return;
    this.popPending = true;
    this.env.history.go(-1);
  }

  private reset() {
    this.clearWatchdog();
    const wasLeaving = this.leaving;
    this.armed = false;
    this.dirty = false;
    this.save = null;
    this.getError = null;
    this.token = null;
    if (!wasLeaving) this.popSentinel();
    this.sentinel = false;
    this.dropListeners();
    this.leaving = false;
    if (this.prompt) this.setPrompt(null);
  }

  // ---------------------------------------------------------------- browser events

  private onBeforeUnload = (e: { preventDefault(): void; returnValue?: unknown }) => {
    if (this.leaving || !this.dirty) return;
    e.preventDefault();
    e.returnValue = "";
  };

  private onClick = (e: ClickLike & { preventDefault(): void; stopPropagation(): void }) => {
    if (!this.armed || this.leaving) return;
    const href = linkTarget(e, this.env.location);
    if (!href) return;
    e.preventDefault();
    e.stopPropagation();
    this.openPrompt({ kind: "href", href });
  };

  private onPop = () => {
    if (this.popPending) {
      this.popPending = false;
      if (!this.armed) this.env.win.removeEventListener("popstate", this.onPop);
      const waiters = this.popWaiters;
      this.popWaiters = [];
      waiters.forEach((f) => f());
      this.sync();
      return;
    }
    if (!this.armed || this.leaving) return;
    if (this.env.location.href !== this.armedHref) {
      // a jump over several entries landed somewhere else; that cannot be stopped from here
      this.armed = false;
      this.sentinel = false;
      this.dropListeners();
      return;
    }
    // Back went over our entry and landed on the page itself: put the entry back and ask.
    this.env.history.pushState(SENTINEL, "", this.env.location.href);
    this.sentinel = true;
    this.openPrompt({ kind: "back" });
  };

  private openPrompt(nav: PendingNav) {
    if (this.prompt?.busy) return;
    this.setPrompt({ nav, busy: false, error: null });
  }

  // ---------------------------------------------------------------- code that navigates

  /** Ask before navigating. True: go ahead now. False: the person is being asked, and navigation continues if they choose to leave. */
  request(href: string): boolean {
    if (!this.dirty || this.leaving) return true;
    this.openPrompt({ kind: "href", href });
    return false;
  }

  /**
   * The page is about to go away on purpose (the record was deleted): stop guarding and take our history entry off,
   * so the navigation that follows is clean. Resolves once the entry is gone.
   */
  async release(): Promise<void> {
    this.leaving = true;
    this.armed = false;
    this.startWatchdog(HREF_WATCHDOG_MS);
    let wait: Promise<void> | null = null;
    if (this.sentinel && this.env.location.href === this.armedHref) {
      wait = new Promise<void>((resolve) => {
        this.popPending = true;
        this.popWaiters.push(resolve);
        this.env.history.go(-1);
        setTimeout(resolve, POP_WAIT_MS);
      });
    }
    this.sentinel = false;
    this.dropListeners();
    if (wait) await wait;
  }

  // ---------------------------------------------------------------- the three choices

  keepEditing() {
    if (!this.prompt || this.prompt.busy) return;
    this.setPrompt(null);
  }

  leaveWithoutSaving() {
    const p = this.prompt;
    if (!p || p.busy) return;
    this.proceed(p.nav);
  }

  async saveAndLeave() {
    const p = this.prompt;
    if (!p || p.busy) return;
    this.leaving = true; // hold the guard still while the save runs
    this.setPrompt({ nav: p.nav, busy: true, error: null });
    let ok = false;
    let message: string | null = null;
    try {
      ok = this.save ? await this.save() : false;
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    if (!ok) {
      this.leaving = false;
      const detail = message ?? this.getError?.() ?? null;
      this.setPrompt({ nav: p.nav, busy: false, error: `Couldn’t save your changes${detail ? `: ${detail}` : ""}. You are still on this page.` });
      this.sync();
      return;
    }
    this.proceed(p.nav);
  }

  private proceed(nav: PendingNav) {
    this.leaving = true;
    this.armed = false;
    this.dropListeners();
    const hadSentinel = this.sentinel;
    this.sentinel = false;
    this.setPrompt(null);
    this.startWatchdog(nav.kind === "href" ? HREF_WATCHDOG_MS : BACK_WATCHDOG_MS);
    if (nav.kind === "href") this.env.navigate(nav.href, hadSentinel);
    else this.env.history.go(hadSentinel ? -2 : -1);
  }

  private startWatchdog(ms: number) {
    this.clearWatchdog();
    this.watchdog = setTimeout(() => {
      this.watchdog = null;
      // still here: the way out did not happen, so go back to guarding the edits
      if (this.token && this.leaving) {
        this.leaving = false;
        this.sync();
      }
    }, ms);
  }

  private clearWatchdog() {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
  }
}
