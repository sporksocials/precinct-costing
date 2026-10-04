"use client";

import React from "react";
import { parseServeCount, type ServesMode } from "@/lib/serves";
import { InlineInput, Segmented } from "./ui";

/** The visible "One Serve" | "Multiple Serves" choice, shared by the new recipe sheet and the recipe editor. */
export function ServesSegmented({ value, onChange, className, size }: { value: ServesMode; onChange: (m: ServesMode) => void; className?: string; size?: "sm" | "md" }) {
  return (
    <Segmented<ServesMode>
      ariaLabel="Serves"
      size={size}
      className={className}
      value={value}
      onChange={onChange}
      options={[
        { value: "one", label: "One Serve" },
        { value: "multiple", label: "Multiple Serves" },
      ]}
    />
  );
}

/** The "Serves From This Recipe" number: shown only for Multiple Serves. Typed values below 2 are lifted to 2; anything that is not a number is ignored. */
export function ServesCountInput({ portions, onChange, autoFocus }: { portions: number; onChange: (n: number) => void; autoFocus?: boolean }) {
  return (
    <InlineInput
      value={String(Number(portions) || 2)}
      width="w-20"
      ariaLabel="Serves From This Recipe"
      autoFocus={autoFocus}
      onCommit={(t) => {
        const n = parseServeCount(t);
        if (n != null && n !== Number(portions)) onChange(n);
      }}
    />
  );
}

