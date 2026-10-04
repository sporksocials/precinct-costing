"use client";

import { useCallback } from "react";
import { useStore } from "@/lib/store";
import { personName } from "@/lib/people";

/** The first name for an email in history ("Matt"), else the part before the @. Null when there is no email. */
export function usePersonName(): (email: string | null | undefined) => string | null {
  const { allowedUsers } = useStore();
  return useCallback((email) => personName(email, allowedUsers), [allowedUsers]);
}
