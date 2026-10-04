import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkTarget, UnsavedGuard, type ClickLike, type GuardEnv } from "@/lib/unsaved-guard";

type Fn = (e: any) => void;

/** A tiny browser: window and document listeners, a session history, and a click that navigates unless prevented. */
function fakeBrowser(startUrl = "https://app.test/menu") {
  const win = new Map<string, Set<Fn>>();
  const doc = new Map<string, Set<Fn>>();
  const target = (m: Map<string, Set<Fn>>) => ({
    addEventListener: (t: string, f: Fn) => void (m.get(t) ?? m.set(t, new Set()).get(t)!).add(f),
    removeEventListener: (t: string, f: Fn) => void m.get(t)?.delete(f),
  });
  const entries: { state: unknown; url: string }[] = [
    { state: null, url: "https://app.test/" },
    { state: null, url: startUrl },
  ];
  let idx = 1;
  const queue: number[] = [];
  const navigations: { href: string; replace: boolean }[] = [];
  const b = {
    entries,
    navigations,
    get idx() {
      return idx;
    },
    get url() {
      return entries[idx].url;
    },
    win,
    doc,
    count: (m: Map<string, Set<Fn>>, t: string) => m.get(t)?.size ?? 0,
    env: {
      win: target(win),
      doc: target(doc),
      history: {
        pushState: (state: unknown, _u: string, url?: string | null) => {
          entries.splice(idx + 1);
          entries.push({ state, url: url ?? entries[idx].url });
          idx += 1;
        },
        go: (n: number) => void queue.push(n),
      },
      get location() {
        return { href: entries[idx].url, origin: "https://app.test" };
      },
      navigate: (href: string, replace: boolean) => {
        navigations.push({ href, replace });
        const url = "https://app.test" + href;
        if (replace) entries[idx] = { state: null, url };
        else {
          entries.splice(idx + 1);
          entries.push({ state: null, url });
          idx += 1;
        }
      },
    } as GuardEnv,
    /** run queued history traversals, firing popstate like a browser does */
    settle() {
      while (queue.length) {
        const n = queue.shift()!;
        const to = idx + n;
        if (to < 0 || to >= entries.length) continue;
        idx = to;
        [...(win.get("popstate") ?? [])].forEach((f) => f({}));
      }
    },
    back() {
      queue.push(-1);
      b.settle();
    },
    /** a click on an in-app link; returns true if the browser/app would have followed it */
    click(href: string, init: Partial<ClickLike> = {}) {
      let prevented = false;
      const ev = {
        defaultPrevented: false,
        button: 0,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        target: anchor(href),
        preventDefault() {
          prevented = true;
          ev.defaultPrevented = true;
        },
        stopPropagation() {},
        ...init,
      };
      [...(doc.get("click") ?? [])].forEach((f) => f(ev));
      if (!prevented) b.env.navigate(href, false);
      return !prevented;
    },
    unload() {
      let prevented = false;
      const ev = { preventDefault: () => void (prevented = true), returnValue: undefined as unknown };
      [...(win.get("beforeunload") ?? [])].forEach((f) => f(ev));
      return prevented;
    },
  };
  return b;
}
const anchor = (href: string, attrs: Record<string, string> = {}) => ({
  closest: () => ({ getAttribute: (n: string) => (n === "href" ? href : attrs[n] ?? null), hasAttribute: (n: string) => n in attrs }),
});
const loc = { href: "https://app.test/items/1", origin: "https://app.test" };
const click = (target: unknown, over: Partial<ClickLike> = {}): ClickLike => ({ defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, target, ...over });

describe("linkTarget", () => {
  it("returns the app path for a plain same-site link", () => {
    expect(linkTarget(click(anchor("/menu?venue=drift")), loc)).toBe("/menu?venue=drift");
    expect(linkTarget(click(anchor("https://app.test/ingredients#top")), loc)).toBe("/ingredients#top");
  });
  it("ignores modified clicks, other buttons and handled events", () => {
    for (const k of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) expect(linkTarget(click(anchor("/menu"), { [k]: true }), loc)).toBeNull();
    expect(linkTarget(click(anchor("/menu"), { button: 1 }), loc)).toBeNull();
    expect(linkTarget(click(anchor("/menu"), { defaultPrevented: true }), loc)).toBeNull();
  });
  it("ignores new-tab, download, other-site, mailto and same-page links", () => {
    expect(linkTarget(click(anchor("/menu", { target: "_blank" })), loc)).toBeNull();
    expect(linkTarget(click(anchor("/menu", { target: "_self" })), loc)).toBe("/menu");
    expect(linkTarget(click(anchor("/file.csv", { download: "" })), loc)).toBeNull();
    expect(linkTarget(click(anchor("https://example.com/x")), loc)).toBeNull();
    expect(linkTarget(click(anchor("mailto:a@b.co")), loc)).toBeNull();
    expect(linkTarget(click(anchor("/items/1")), loc)).toBeNull();
    expect(linkTarget(click(anchor("#notes")), loc)).toBeNull();
  });
  it("ignores clicks that are not on a link", () => {
    expect(linkTarget(click({ closest: () => null }), loc)).toBeNull();
    expect(linkTarget(click(null), loc)).toBeNull();
  });
});

function setup(save: () => Promise<boolean> = async () => true, getError?: () => string | null) {
  const b = fakeBrowser("https://app.test/items/1");
  const g = new UnsavedGuard(b.env);
  const unregister = g.register(save, getError);
  return { b, g, unregister };
}

describe("UnsavedGuard: registration and cleanup", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("registers nothing while the page is clean", () => {
    const { b } = setup();
    expect(b.count(b.win, "beforeunload")).toBe(0);
    expect(b.count(b.doc, "click")).toBe(0);
    expect(b.entries).toHaveLength(2);
  });

  it("registers beforeunload, click and popstate while dirty, and removes them when clean", () => {
    const { b, g } = setup();
    g.setDirty(true);
    expect(b.count(b.win, "beforeunload")).toBe(1);
    expect(b.count(b.win, "popstate")).toBe(1);
    expect(b.count(b.doc, "click")).toBe(1);
    expect(b.unload()).toBe(true); // the browser's own prompt is asked for
    g.setDirty(false);
    b.settle();
    expect(b.count(b.win, "beforeunload")).toBe(0);
    expect(b.count(b.win, "popstate")).toBe(0);
    expect(b.count(b.doc, "click")).toBe(0);
    expect(b.unload()).toBe(false);
  });

  it("pushes one history entry while dirty and takes it off when clean", () => {
    const { b, g } = setup();
    g.setDirty(true);
    g.setDirty(true);
    expect(b.entries).toHaveLength(3);
    expect(b.idx).toBe(2);
    g.setDirty(false);
    b.settle();
    expect(b.idx).toBe(1);
    expect(b.url).toBe("https://app.test/items/1");
  });

  it("dirty, clean, dirty in quick succession never stacks two entries", () => {
    const { b, g } = setup();
    g.setDirty(true);
    g.setDirty(false); // pop is in flight
    g.setDirty(true); // waits for the pop, then arms again
    expect(b.count(b.win, "beforeunload")).toBe(0);
    b.settle();
    expect(b.count(b.win, "beforeunload")).toBe(1);
    expect(b.idx).toBe(2);
    expect(b.entries).toHaveLength(3);
  });

  it("unregistering (the page goes away) removes everything and pops the entry", () => {
    const { b, g, unregister } = setup();
    g.setDirty(true);
    unregister();
    b.settle();
    expect(b.count(b.win, "beforeunload")).toBe(0);
    expect(b.count(b.doc, "click")).toBe(0);
    expect(b.count(b.win, "popstate")).toBe(0);
    expect(b.idx).toBe(1);
  });

  it("does not pop history when the page was left some other way (no stray Back)", () => {
    const { b, g, unregister } = setup();
    g.setDirty(true);
    b.env.navigate("/menu", false); // something navigated without asking
    unregister();
    b.settle();
    expect(b.url).toBe("https://app.test/menu");
  });
});

describe("UnsavedGuard: link clicks", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("lets links through while clean", () => {
    const { b } = setup();
    expect(b.click("/menu")).toBe(true);
  });

  it("blocks a link while dirty and asks", () => {
    const { b, g } = setup();
    g.setDirty(true);
    expect(b.click("/menu")).toBe(false);
    expect(g.getPrompt()).toEqual({ nav: { kind: "href", href: "/menu" }, busy: false, error: null });
    expect(b.navigations).toHaveLength(0);
  });

  it("does not block modified clicks or links that leave the app", () => {
    const { b, g } = setup();
    g.setDirty(true);
    expect(b.click("/menu", { metaKey: true })).toBe(true);
    expect(b.click("https://example.com/")).toBe(true);
    expect(g.getPrompt()).toBeNull();
  });

  it("Keep Editing closes the prompt and the page stays guarded", () => {
    const { b, g } = setup();
    g.setDirty(true);
    b.click("/menu");
    g.keepEditing();
    expect(g.getPrompt()).toBeNull();
    expect(b.url).toBe("https://app.test/items/1");
    expect(b.click("/menu")).toBe(false);
  });

  it("Leave Without Saving goes where the link pointed, reusing the guard's history entry", () => {
    const save = vi.fn(async () => true);
    const { b, g } = setup(save);
    g.setDirty(true);
    b.click("/menu");
    g.leaveWithoutSaving();
    expect(save).not.toHaveBeenCalled();
    expect(b.navigations).toEqual([{ href: "/menu", replace: true }]);
    expect(b.entries.map((e) => e.url)).toEqual(["https://app.test/", "https://app.test/items/1", "https://app.test/menu"]);
    expect(g.getPrompt()).toBeNull();
    expect(b.count(b.doc, "click")).toBe(0);
    expect(b.unload()).toBe(false);
  });

  it("Save And Leave saves first, then continues", async () => {
    const order: string[] = [];
    const { b, g } = setup(async () => {
      order.push("save");
      return true;
    });
    g.setDirty(true);
    b.click("/menu");
    const done = g.saveAndLeave();
    expect(g.getPrompt()?.busy).toBe(true);
    await done;
    order.push(`navigate:${b.navigations.map((n) => n.href).join()}`);
    expect(order).toEqual(["save", "navigate:/menu"]);
    expect(g.getPrompt()).toBeNull();
  });

  it("the page going clean mid-save does not pop the entry under the navigation", async () => {
    let finish!: () => void;
    const { b, g } = setup(() => new Promise<boolean>((r) => (finish = () => r(true))));
    g.setDirty(true);
    b.click("/menu");
    const done = g.saveAndLeave();
    g.setDirty(false); // the editor reports clean as soon as the save lands
    finish();
    await done;
    b.settle();
    expect(b.entries.map((e) => e.url)).toEqual(["https://app.test/", "https://app.test/items/1", "https://app.test/menu"]);
    expect(b.url).toBe("https://app.test/menu");
  });

  it("a failed save keeps the person on the page with all three choices", async () => {
    let ok = false;
    const { b, g } = setup(async () => ok, () => "offline");
    g.setDirty(true);
    b.click("/menu");
    await g.saveAndLeave();
    const p = g.getPrompt()!;
    expect(p.busy).toBe(false);
    expect(p.error).toContain("offline");
    expect(b.navigations).toHaveLength(0);
    expect(b.url).toBe("https://app.test/items/1");
    expect(b.count(b.win, "beforeunload")).toBe(1); // still guarded
    // retry works once the connection is back
    ok = true;
    await g.saveAndLeave();
    expect(b.navigations).toEqual([{ href: "/menu", replace: true }]);
  });

  it("a save that throws is reported the same way, and Leave Without Saving still works", async () => {
    const { b, g } = setup(async () => {
      throw new Error("permission denied");
    });
    g.setDirty(true);
    b.click("/menu");
    await g.saveAndLeave();
    expect(g.getPrompt()?.error).toContain("permission denied");
    expect(b.navigations).toHaveLength(0);
    g.keepEditing();
    expect(g.getPrompt()).toBeNull();
    b.click("/menu");
    g.leaveWithoutSaving();
    expect(b.navigations).toHaveLength(1);
  });

  it("ignores a second Save And Leave while one is running", async () => {
    let calls = 0;
    const { b, g } = setup(async () => {
      calls += 1;
      return true;
    });
    g.setDirty(true);
    b.click("/menu");
    const a = g.saveAndLeave();
    void g.saveAndLeave();
    await a;
    expect(calls).toBe(1);
  });
});

describe("UnsavedGuard: Back and Forward", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("Back while dirty lands on the page, puts the entry back and asks", () => {
    const { b, g } = setup();
    g.setDirty(true);
    b.back();
    expect(g.getPrompt()?.nav).toEqual({ kind: "back" });
    expect(b.url).toBe("https://app.test/items/1");
    expect(b.idx).toBe(2); // entry restored on top: the next Back is guarded too
  });

  it("Back while clean is not touched", () => {
    const { b } = setup();
    b.back();
    expect(b.url).toBe("https://app.test/");
  });

  it("Keep Editing after Back leaves the person on the page, still guarded", () => {
    const { b, g } = setup();
    g.setDirty(true);
    b.back();
    g.keepEditing();
    b.back();
    expect(g.getPrompt()?.nav).toEqual({ kind: "back" });
    expect(b.url).toBe("https://app.test/items/1");
  });

  it("Leave Without Saving after Back goes to the page before", () => {
    const { b, g } = setup();
    g.setDirty(true);
    b.back();
    g.leaveWithoutSaving();
    b.settle();
    expect(b.url).toBe("https://app.test/");
  });

  it("Save And Leave after Back saves, then goes to the page before", async () => {
    const save = vi.fn(async () => true);
    const { b, g } = setup(save);
    g.setDirty(true);
    b.back();
    await g.saveAndLeave();
    b.settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(b.url).toBe("https://app.test/");
  });

  it("a failed save after Back keeps the person on the page", async () => {
    const { b, g } = setup(async () => false);
    g.setDirty(true);
    b.back();
    await g.saveAndLeave();
    b.settle();
    expect(b.url).toBe("https://app.test/items/1");
    expect(g.getPrompt()?.error).toBeTruthy();
  });

  it("if the chosen way out does not take us off the page, guarding resumes", () => {
    const { b, g } = setup();
    g.setDirty(true);
    b.back();
    g.leaveWithoutSaving();
    // the traversal is never run (nothing to go back to), so we are still on the page
    vi.advanceTimersByTime(1600);
    expect(g.isArmed).toBe(true);
    expect(b.count(b.win, "beforeunload")).toBe(1);
  });

  it("a jump over several entries cannot be stopped, and the guard lets go instead of fighting it", () => {
    const { b, g } = setup();
    g.setDirty(true);
    b.env.history.go(-2);
    b.settle();
    expect(g.isArmed).toBe(false);
    expect(b.url).toBe("https://app.test/");
  });
});

describe("UnsavedGuard: code that navigates, and release", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("request lets a clean page navigate", () => {
    const { g } = setup();
    expect(g.request("/menu")).toBe(true);
  });

  it("request asks first when dirty, then Leave Without Saving continues", () => {
    const { b, g } = setup();
    g.setDirty(true);
    expect(g.request("/menu")).toBe(false);
    expect(g.getPrompt()?.nav).toEqual({ kind: "href", href: "/menu" });
    g.leaveWithoutSaving();
    expect(b.navigations).toEqual([{ href: "/menu", replace: true }]);
  });

  it("release takes the history entry off and resolves once it is gone", async () => {
    const { b, g } = setup();
    g.setDirty(true);
    const done = g.release();
    b.settle();
    await done;
    expect(b.idx).toBe(1);
    expect(b.count(b.doc, "click")).toBe(0);
    expect(g.request("/menu")).toBe(true); // no prompt after release
  });
});

describe("no raw inserts", () => {
  it("every insert in the app goes through insertRow / insertRows in lib/store.tsx", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && p !== join(process.cwd(), "lib/store.tsx") && !p.includes("demo-client")) {
          if (/\.insert\(/.test(readFileSync(p, "utf8"))) offenders.push(p);
        }
      }
    };
    for (const d of ["app", "components", "lib"]) walk(join(process.cwd(), d));
    expect(offenders).toEqual([]);
  });
});
