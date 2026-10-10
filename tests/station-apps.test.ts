import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { stationWorkerSource } from "@/lib/sw-source";
import { cameFromChooser, drinksAppName, kitchenAppName, markFromChooser, stationManifest } from "@/lib/station-names";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** A tiny in-memory sessionStorage. */
function fakeStore(): Pick<Storage, "getItem" | "setItem"> {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

describe("short station names (Troy, 10 Oct 2026)", () => {
  it("name the app after the venue when it is known, otherwise just Kitchen or Drinks", () => {
    expect(kitchenAppName("drift")).toBe("Drift Kitchen");
    expect(kitchenAppName("chiobu")).toBe("Chiobu Kitchen");
    expect(kitchenAppName("greedy")).toBe("Greedy Kitchen");
    expect(kitchenAppName()).toBe("Kitchen");
    expect(kitchenAppName("nowhere")).toBe("Kitchen");
    expect(drinksAppName("drift")).toBe("Drift Drinks");
    expect(drinksAppName("greedy")).toBe("Greedy Drinks");
    expect(drinksAppName(null)).toBe("Drinks");
  });
  it("manifests: generic ones open the chooser, venue ones open the venue, both keep the station scope", () => {
    const k = stationManifest("kitchen");
    expect([k.name, k.short_name, k.start_url, k.scope]).toEqual(["Kitchen", "Kitchen", "/kitchen", "/kitchen"]);
    const kd = stationManifest("kitchen", "drift");
    expect([kd.name, kd.short_name, kd.start_url, kd.scope]).toEqual(["Drift Kitchen", "Drift Kitchen", "/kitchen/drift", "/kitchen"]);
    const b = stationManifest("bar");
    expect([b.name, b.start_url, b.scope]).toEqual(["Drinks", "/bar", "/bar"]);
    const bc = stationManifest("bar", "chiobu");
    expect([bc.name, bc.start_url, bc.scope]).toEqual(["Chiobu Drinks", "/bar/chiobu", "/bar"]);
    // an unknown venue never builds a start_url from the input
    expect(stationManifest("kitchen", "../../login").start_url).toBe("/kitchen");
  });
  it("the on-screen words are Kitchen and Drinks, never Station", () => {
    expect(read("app/kitchen/page.tsx")).toContain(">KITCHEN</h1>");
    expect(read("app/bar/page.tsx")).toContain(">DRINKS</h1>");
    expect(read("app/kitchen/layout.tsx")).toContain('title: "Kitchen"');
    expect(read("app/bar/layout.tsx")).toContain('title: "Drinks"');
    expect(read("app/kitchen/[venue]/page.tsx")).toContain("kitchenAppName(params.venue)");
    expect(read("app/bar/[venue]/page.tsx")).toContain("drinksAppName(params.venue)");
    for (const f of [
      "app/kitchen/page.tsx",
      "app/kitchen/layout.tsx",
      "app/kitchen/[venue]/page.tsx",
      "app/kitchen/setup/page.tsx",
      "app/kitchen/manifest.webmanifest/route.ts",
      "components/kitchen/station.tsx",
      "app/bar/page.tsx",
      "app/bar/layout.tsx",
      "app/bar/[venue]/page.tsx",
      "app/bar/setup/page.tsx",
      "app/bar/manifest.webmanifest/route.ts",
      "components/bar/station.tsx",
    ]) {
      const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, f).not.toMatch(/Kitchen Station|Drinks Station|Cocktail Station|kitchen station|drinks station/i);
    }
  });
  it("the Home Screen name follows the venue on every screen under it, with its own manifest", () => {
    const k = read("app/kitchen/[venue]/layout.tsx");
    expect(k).toContain("kitchenAppName(params.venue)");
    expect(k).toContain("/kitchen/${params.venue}/manifest.webmanifest");
    const b = read("app/bar/[venue]/layout.tsx");
    expect(b).toContain("drinksAppName(params.venue)");
    expect(b).toContain("/bar/${params.venue}/manifest.webmanifest");
    expect(read("app/kitchen/[venue]/manifest.webmanifest/route.ts")).toContain("isKitchenVenue");
    expect(read("app/bar/[venue]/manifest.webmanifest/route.ts")).toContain("isBarVenue");
  });
});

describe("the way back to the chooser", () => {
  it("is off until the person came through the chooser, per app", () => {
    const s = fakeStore();
    expect(cameFromChooser("kitchen", s)).toBe(false);
    markFromChooser("kitchen", s);
    expect(cameFromChooser("kitchen", s)).toBe(true);
    expect(cameFromChooser("bar", s)).toBe(false); // the drinks app has its own flag
  });
  it("a refused or missing store reads as no, never an error", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => markFromChooser("kitchen", broken)).not.toThrow();
    expect(cameFromChooser("kitchen", broken)).toBe(false);
    expect(cameFromChooser("kitchen", null)).toBe(false);
    expect(() => markFromChooser("kitchen", null)).not.toThrow();
  });
  it("both venue screens show the link only when it is on, and the choosers set it", () => {
    for (const [f, label, href] of [
      ["components/kitchen/station.tsx", "All Kitchens", "/kitchen"],
      ["components/bar/station.tsx", "All Venues", "/bar"],
    ] as const) {
      const src = read(f);
      expect(src, f).toContain("useFromChooser(");
      const at = src.indexOf(`href="${href}"`);
      expect(at, f).toBeGreaterThan(0);
      expect(src.slice(Math.max(0, at - 120), at), f).toContain("fromChooser ?");
      expect(src, f).toContain(label);
    }
    expect(read("app/kitchen/page.tsx")).toContain('<ChooserLink\n                  station="kitchen"');
    expect(read("app/bar/page.tsx")).toContain('<ChooserLink\n                  station="bar"');
  });
  it("the chooser link adds no query string, so the offline copy is never split", () => {
    expect(read("app/kitchen/page.tsx")).toContain("href={`/kitchen/${slug}`}");
    expect(read("app/bar/page.tsx")).toContain("href={`/bar/${slug}`}");
    expect(read("components/station-chooser.tsx")).not.toMatch(/\?from|searchParams/);
  });
  it("the setup page keeps its own link back", () => {
    expect(read("app/kitchen/setup/page.tsx")).toContain("All Kitchens");
    expect(read("app/bar/setup/page.tsx")).toContain("All Venues");
  });
});

describe("the offline copy still works for a venue opened straight, and after the chooser", () => {
  /** Runs the real worker source against fake caches and a fake network. */
  function worker(scope: string, prefix: string) {
    const handlers: Record<string, (e: unknown) => void> = {};
    const stores = new Map<string, Map<string, { text: string }>>();
    const caches = {
      keys: async () => Array.from(stores.keys()),
      delete: async (k: string) => stores.delete(k),
      open: async (name: string) => {
        if (!stores.has(name)) stores.set(name, new Map());
        const m = stores.get(name)!;
        return {
          put: async (req: { url: string } | string, res: { text: string }) => void m.set(typeof req === "string" ? req : req.url, res),
          match: async (req: { url: string } | string) => m.get(typeof req === "string" ? req : req.url),
          keys: async () => Array.from(m.keys()),
          delete: async (k: string) => m.delete(k),
          add: async (u: string) => void m.set(new URL(u, "https://x.test").href, { text: "added" }),
        };
      },
    };
    let online = true;
    const fetchFn = async (req: { url: string }) => {
      if (!online) throw new Error("offline");
      const res = { ok: true, type: "basic", text: `page ${req.url}`, clone() { return res; } };
      return res;
    };
    const self = { location: { origin: "https://x.test" }, addEventListener: (t: string, h: (e: unknown) => void) => void (handlers[t] = h), skipWaiting() {}, clients: { claim: async () => {} } };
    runInNewContext(stationWorkerSource({ scope, cachePrefix: prefix, photoPrefixes: [] }), { self, caches, fetch: fetchFn, URL, setTimeout, Promise });
    const navigate = async (path: string) => {
      const box: { out: Promise<{ text: string }> | null } = { out: null };
      handlers.fetch({ request: { method: "GET", url: `https://x.test${path}`, mode: "navigate" }, respondWith: (p: Promise<{ text: string }>) => void (box.out = p) });
      return box.out ? await box.out : null;
    };
    return { navigate, setOnline: (v: boolean) => void (online = v), stores };
  }

  it("a venue opened straight is saved at its plain address and reopens offline from it", async () => {
    const w = worker("/kitchen", "kitchen");
    expect((await w.navigate("/kitchen/drift"))?.text).toBe("page https://x.test/kitchen/drift");
    w.setOnline(false);
    expect((await w.navigate("/kitchen/drift"))?.text).toBe("page https://x.test/kitchen/drift");
  });
  it("going through the chooser saves the same two plain addresses and nothing with a query string", async () => {
    const w = worker("/kitchen", "kitchen");
    await w.navigate("/kitchen");
    await w.navigate("/kitchen/drift");
    const saved = Array.from(w.stores.get("kitchen-pages-v1")!.keys());
    expect(saved.sort()).toEqual(["https://x.test/kitchen", "https://x.test/kitchen/drift"]);
    expect(saved.some((k) => k.includes("?"))).toBe(false);
  });
});
