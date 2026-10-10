import type { Metadata } from "next";
import Link from "next/link";
import { PrecinctMark } from "@/components/brand";

export const metadata: Metadata = { title: "iPad Setup · Kitchen" };

const STEPS: { title: string; body: string[] }[] = [
  {
    title: "Open The App",
    body: ["In Safari, open the Kitchen link and choose your kitchen."],
  },
  {
    title: "Add It To The Home Screen",
    body: [
      "Tap the Share button, tap View More if you see it, tap Add to Home Screen, then tap Add. Leave Open as Web App on if it appears.",
      "Open the app from the new Kitchen icon from now on. It opens with no address bar and no sign-in.",
    ],
  },
  {
    title: "Keep The Screen On",
    body: ["Open Settings, tap Display & Brightness, tap Auto-Lock, and choose Never."],
  },
  {
    title: "Lock The iPad To The App",
    body: [
      "Open Settings, tap Accessibility, tap Guided Access, and turn it on. Tap Passcode Settings and set a passcode. Set Display Auto-Lock to its longest option as well.",
      "Open the Kitchen icon, triple-click the top button (the Home button on iPads that have one) and tap Start. Staff can't leave the app until someone triple-clicks and enters the passcode.",
      "To end the session, triple-click, enter the passcode and tap End.",
    ],
  },
  {
    title: "Stand It Upright",
    body: ["The station is built for the iPad held upright (portrait). Put it on a stand at the pass, then swipe down from the top right corner and turn on the Orientation Lock button so it never flips."],
  },
  {
    title: "Power, Wi-Fi And Cleaning",
    body: [
      "Keep the iPad plugged in and connected to the venue Wi-Fi.",
      "Use a wipe-clean case so a splash or a greasy thumb is no trouble. Keep it out of the way of the fryer and the grill.",
    ],
  },
];

/** One-page iPad setup for a head chef or venue manager: public like the rest of /kitchen, so it can be opened on the iPad being set up. */
export default function KitchenSetupPage() {
  return (
    <main className="kitchen-root min-h-[100dvh] w-full bg-[#0E0E10] text-[#F5F3EE]">
      <div className="mx-auto w-full max-w-[760px] px-6 pb-16 pt-[calc(28px+env(safe-area-inset-top))]">
        <Link href="/kitchen" className="inline-flex min-h-[44px] items-center gap-[6px] pr-3 text-[16px] font-medium text-[#B3E3F2]">
          <span aria-hidden className="text-[16px] leading-none">
            &#8592;
          </span>
          All Kitchens
        </Link>
        <div className="mt-4">
          <PrecinctMark size="sm" />
        </div>
        <h1 className="mt-4 font-display text-[48px] uppercase leading-none tracking-[1px]">iPad Setup</h1>
        <p className="mt-3 text-[19px] leading-snug text-[#9B9890]">Set up each kitchen iPad once. It then runs all shift with no sign-in. A dish or prep shows on it once the head chef ticks Ready For Kitchen.</p>

        <ol className="mt-8 grid gap-[14px]">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-2xl border-[0.5px] border-white/[0.08] bg-[#1C1C1F] px-5 py-5">
              <div className="flex items-center gap-4">
                <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#B3E3F2] text-[20px] font-medium text-[#0E0E10]">
                  {i + 1}
                </span>
                <h2 className="text-[24px] font-medium leading-tight">{s.title}</h2>
              </div>
              <div className="mt-3 space-y-3 pl-[60px] text-[19px] leading-snug text-[#F5F3EE]">
                {s.body.map((b) => (
                  <p key={b}>{b}</p>
                ))}
              </div>
            </li>
          ))}
        </ol>

        <section className="mt-[14px] rounded-2xl border-[0.5px] border-[#F2C46D]/40 bg-[#2B2210] px-5 py-5">
          <h2 className="text-[24px] font-medium leading-tight text-[#F2C46D]">If You See The Amber Warning</h2>
          <div className="mt-3 space-y-3 text-[19px] leading-snug text-[#F2C46D]">
            <p>&ldquo;Recipes May Be Out Of Date&rdquo; means the iPad lost its connection. Check the Wi-Fi. The station keeps trying and clears the warning itself.</p>
            <p>After its first load, the app keeps working from the last recipes it saved. Changes made in the pricing app reach the iPad within about five minutes.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
