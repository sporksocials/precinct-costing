"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { Suspense, useEffect, useRef } from "react";
import { BookOpen, Carrot, Ellipsis, HeartPulse, History, House, LogOut, Search, Settings, Store, Tag, Wheat } from "lucide-react";
import { StoreProvider, useStore } from "@/lib/store";
import { CommandPalette, openSearch } from "./search";
import { NewRecipeProvider } from "./new-recipe";
import { PrecinctMark } from "./brand";
import { DataHealthBanner } from "./data-health-banner";
import { Banner, cx, ListSkeleton, Skeleton, ToastProvider, useToast } from "./ui";

const MAIN = [
  { href: "/", label: "Home", icon: House },
  { href: "/menu", label: "Menu", icon: BookOpen },
  { href: "/allergens", label: "Allergens", icon: Wheat },
  { href: "/ingredients", label: "Ingredients", icon: Carrot },
  { href: "/specials", label: "Specials", icon: Tag },
];
const MORE = [
  { href: "/portal-prices", label: "Supplier Prices", icon: Store },
  { href: "/data-health", label: "Data Health", icon: HeartPulse },
  { href: "/change-log", label: "Change Log", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  // record pages belong to the list they open from: dishes, beers and gelato to Menu; preps to Ingredients
  if (href === "/menu") return ["/menu", "/beers", "/items", "/gelato"].some((b) => pathname === b || pathname.startsWith(b + "/"));
  if (href === "/ingredients") return pathname.startsWith("/ingredients") || pathname.startsWith("/preps");
  return pathname === href || pathname.startsWith(href + "/");
}

function Sidebar() {
  const pathname = usePathname();
  const { userEmail, signOut } = useStore();
  const link = (n: (typeof MAIN)[number]) => {
    const on = isActive(pathname, n.href);
    const Icon = n.icon;
    return (
      <Link
        key={n.href}
        href={n.href}
        aria-current={on ? "page" : undefined}
        className={cx("flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[15px] transition-colors", on ? "bg-fill-2 font-semibold text-label" : "text-label hover:bg-fill")}
      >
        <Icon className={cx("h-[18px] w-[18px]", on ? "text-accent" : "text-label-2")} strokeWidth={2} />
        {n.label}
      </Link>
    );
  };
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col px-3 pb-4 pt-6 hairline lg:flex" style={{ boxShadow: "inset -0.5px 0 0 var(--separator)" }}>
      <Link href="/" className="mb-5 block px-2.5" aria-label="Caloundra Food Precinct Costing: Home">
        <PrecinctMark size="sm" sub="Costing" />
      </Link>

      <button type="button" onClick={openSearch} className="mb-4 flex h-9 items-center gap-2 rounded-lg bg-fill px-2.5 text-[15px] text-label-2 hover:bg-fill-2">
        <Search className="h-4 w-4" strokeWidth={2.25} />
        <span className="flex-1 text-left">Search</span>
        <kbd className="rounded bg-surface px-1.5 py-0.5 font-sans text-[11px] text-label-2">⌘K</kbd>
      </button>
      <nav className="space-y-0.5">{MAIN.map(link)}</nav>
      <p className="mt-6 px-2.5 pb-1 text-[12px] font-medium text-label-3">More</p>
      <nav className="space-y-0.5">{MORE.map(link)}</nav>
      <div className="mt-auto px-2.5">
        <p className="truncate text-[13px] text-label-2" title={userEmail ?? ""}>
          {userEmail}
        </p>
        <button type="button" onClick={() => void signOut()} className="mt-1 flex items-center gap-1.5 text-[13px] text-accent hover:underline">
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      </div>
    </aside>
  );
}

const TABS = [
  { href: "/", label: "Home", icon: House },
  { href: "/menu", label: "Menu", icon: BookOpen },
  { href: "/ingredients", label: "Ingredients", icon: Carrot },
  { href: "/search", label: "Search", icon: Search },
  { href: "/more", label: "More", icon: Ellipsis },
];

export function hidesTabBar(pathname: string) {
  return /^\/(items|preps)\/[^/]+$/.test(pathname);
}

function TabBar() {
  const pathname = usePathname();
  if (hidesTabBar(pathname)) return null;
  const moreActive = MORE.some((m) => isActive(pathname, m.href)) || pathname === "/more" || pathname.startsWith("/specials") || pathname.startsWith("/allergens");
  return (
    <nav className="bar-blur fixed inset-x-0 bottom-0 z-40 pb-safe hairline-t lg:hidden" aria-label="Main">
      <div className="mx-auto flex h-[50px] max-w-lg items-stretch">
        {TABS.map((t) => {
          const on = t.href === "/more" ? moreActive : isActive(pathname, t.href);
          const Icon = t.icon;
          return (
            <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined} className={cx("flex flex-1 flex-col items-center justify-center gap-0.5 pt-1", on ? "text-accent" : "text-label-2")}>
              <Icon className="h-[24px] w-[24px]" strokeWidth={on ? 2.25 : 1.75} />
              <span className="text-[11px] font-medium leading-none">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  const { loading, error, accessDenied, reload, refreshing } = useStore();
  if (loading) {
    if (error) {
      return (
        <div className="mx-auto max-w-sm py-24 text-center">
          <p className="text-[20px] font-semibold">Couldn’t load</p>
          <p className="mt-1.5 text-[15px] text-label-2">{error}</p>
          <button className="btn-primary mt-5" onClick={() => void reload()} disabled={refreshing}>
            Try Again
          </button>
        </div>
      );
    }
    return (
      <div className="pt-4 lg:pt-10">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="mt-4 h-9 w-full max-w-sm" />
        <ListSkeleton rows={7} />
      </div>
    );
  }
  if (accessDenied) {
    return (
      <div className="mx-auto max-w-sm py-24 text-center">
        <p className="text-[20px] font-semibold">No access</p>
        <p className="mt-1.5 text-[15px] text-label-2">Your email isn’t on the access list — ask SPORK to add you.</p>
      </div>
    );
  }
  return (
    <>
      {error ? (
        <Banner
          tone="neutral"
          action={
            <button className="font-semibold text-accent" onClick={() => void reload()} disabled={refreshing}>
              Retry
            </button>
          }
        >
          Couldn’t refresh — showing saved data.
        </Banner>
      ) : null}
      {children}
    </>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const noTabs = hidesTabBar(pathname);
  return (
    <div className="lg:pl-[248px]">
      <main
        className={cx(
          "mx-auto w-full max-w-[1100px] px-4 pt-[max(env(safe-area-inset-top),0.5rem)] sm:px-6 lg:px-10 lg:pb-16",
          noTabs ? "pb-[calc(140px+env(safe-area-inset-bottom))]" : "pb-[calc(96px+env(safe-area-inset-bottom))]",
        )}
      >
        <DataHealthBanner />
        <Gate>
          <div key={pathname} className="anim-page">
            {children}
          </div>
        </Gate>
      </main>
    </div>
  );
}

/** One quiet toast when a date rollover changed a deal price while the app was open. */
function DealRolloverToast() {
  const { dealRollover } = useStore();
  const toast = useToast();
  const seen = useRef<number | null>(null);
  useEffect(() => {
    if (!dealRollover || seen.current === dealRollover.id) return;
    seen.current = dealRollover.id;
    toast.show({ message: dealRollover.message }, 7000);
  }, [dealRollover, toast]);
  return null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <StoreProvider>
      <ToastProvider>
        <NewRecipeProvider>
          <DealRolloverToast />
          <Sidebar />
          <Suspense fallback={null}>
            <Frame>{children}</Frame>
          </Suspense>
          <TabBar />
          <CommandPalette />
        </NewRecipeProvider>
      </ToastProvider>
    </StoreProvider>
  );
}
