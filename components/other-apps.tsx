"use client";

import { ChefHat, ExternalLink, Martini, type LucideIcon } from "lucide-react";
import { OTHER_APPS, type OtherApp } from "@/lib/other-apps";

/** One icon per app id; an app without one falls back to the generic link icon. */
export const OTHER_APP_ICONS: Record<string, LucideIcon> = { kitchen: ChefHat, drinks: Martini };

export function otherAppIcon(app: OtherApp): LucideIcon {
  return OTHER_APP_ICONS[app.id] ?? ExternalLink;
}

/** The sidebar block: a quiet heading and one 36px row per app, opening in a new tab. */
export function SidebarOtherApps({ title }: { title: string }) {
  return (
    <div className="mt-5">
      <p className="px-2.5 pb-1 text-[12px] font-medium text-label-3">{title}</p>
      <nav className="space-y-0.5" aria-label={title}>
        {OTHER_APPS.map((app) => {
          const Icon = otherAppIcon(app);
          return (
            <a key={app.id} href={app.href} target="_blank" rel="noopener noreferrer" className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[15px] text-label transition-colors hover:bg-fill">
              <Icon className="h-[18px] w-[18px] text-label-2" strokeWidth={2} />
              <span className="flex-1">{app.label}</span>
              <ExternalLink className="h-3.5 w-3.5 text-label-3" strokeWidth={2} aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          );
        })}
      </nav>
    </div>
  );
}
