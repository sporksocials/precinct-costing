"use client";

import { SearchPanel } from "@/components/search";
import { PageHeader } from "@/components/ui";

export default function SearchPage() {
  return (
    <div className="flex min-h-[70dvh] flex-col">
      <PageHeader title="Search" />
      <SearchPanel autoFocus />
    </div>
  );
}
