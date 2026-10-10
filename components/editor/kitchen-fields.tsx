"use client";

import React from "react";
import { isUploadedPhoto } from "@/lib/bar";
import { isKitchenVenue } from "@/lib/kitchen";
import type { MenuItem, Prep } from "@/lib/types";
import { FieldRow, Group, InlineInput, Toggle } from "../ui";
import { OrderedList, PhotoRow } from "./bar-fields";

/**
 * Kitchen display card for a food dish or a prep: the assembly / plating steps first, then the "Kitchen Display" group (Ready For Kitchen, plated photo and storage line) the
 * venue's kitchen station iPad shows (/kitchen/<venue>). Nothing reaches the station until the head chef turns on
 * "Ready For Kitchen", which is last because it is the last thing done. Edits go through the recipe editor's draft, so they save with everything else.
 */
export function KitchenDisplayFields({ kind, rec, venueSlug, onPatch }: { kind: "item" | "prep"; rec: MenuItem | Prep; venueSlug: string | undefined; onPatch: (p: Partial<MenuItem> & Partial<Prep>) => void }) {
  const station = venueSlug && isKitchenVenue(venueSlug) ? `/kitchen/${venueSlug}` : null;
  const item = kind === "item" ? (rec as MenuItem) : null;
  const prep = kind === "prep" ? (rec as Prep) : null;
  const ready = !!rec.kitchen_ready;
  const method = rec.kitchen_method;
  const hasMethod = Array.isArray(method) && method.some((s) => s.trim());
  const noun = kind === "item" ? "dish" : "prep";

  return (
    <>
      <div id="kitchen-method" className="scroll-mt-20" />
      <OrderedList
        title={item ? "Assembly" : "Method"}
        noun="Step"
        placeholder={item ? "e.g. Toast the bun and spread the aioli" : "e.g. Sweat the onion until soft, about 8 minutes"}
        value={method}
        onChange={(v) => onPatch({ kitchen_method: v })}
        className="mt-4"
      />
      {item ? <OrderedList title="Plating" noun="Point" placeholder="e.g. Chips in the cone, sauce on the side" value={item.kitchen_plating} onChange={(v) => onPatch({ kitchen_plating: v })} className="mt-4" /> : null}
      <div id="kitchen-ready" className="scroll-mt-20" />
      <Group
        title="Kitchen Display"
        className="mt-4"
        trailing={
          station ? (
            <a href={station} target="_blank" rel="noopener noreferrer" className="pb-0.5 text-[13px] font-medium text-accent hover:underline">
              Open Station
            </a>
          ) : null
        }
        footer={
          ready && !hasMethod
            ? `This ${noun} is on the kitchen station but has no method yet.`
            : `The kitchen station only shows a ${noun} once this is on. Turn it on after the head chef has checked the ${kind === "item" ? "steps" : "method"}.`
        }
      >
        <Toggle label="Ready For Kitchen" checked={ready} onChange={(v) => onPatch({ kitchen_ready: v })} />
        {item ? (
          <PhotoRow
            itemId={item.id}
            title="Plated Photo"
            src={item.kitchen_photo && isUploadedPhoto(item.kitchen_photo) ? `/kitchen/photo/${item.kitchen_photo}` : null}
            uploaded={isUploadedPhoto(item.kitchen_photo)}
            stationName="kitchen station"
            noPhotoText="No photo yet. Upload one of the plated dish."
            uploadedText="Shown on the kitchen station."
            placeholderText="Shown on the kitchen station."
            onChange={(path) => onPatch({ kitchen_photo: path })}
          />
        ) : null}
        {prep ? (
          <FieldRow label="Storage" sub="How to store it and how long it keeps">
            <InlineInput
              value={prep.kitchen_storage ?? ""}
              placeholder="e.g. Airtight, fridge, 5 days"
              inputMode="text"
              width="w-[13.5rem] sm:w-72"
              onCommit={(t) => onPatch({ kitchen_storage: t.trim() || null })}
            />
          </FieldRow>
        ) : null}
      </Group>
    </>
  );
}
