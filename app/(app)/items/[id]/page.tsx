"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { parseBeerItemId } from "@/lib/beer";
import { ChevronLeft } from "lucide-react";
import { useStore } from "@/lib/store";
import { flavourName, parseVirtualItemId } from "@/lib/gelato";
import { gp, money } from "@/lib/format";
import { formatQty } from "@/lib/parse-qty";
import { VenueAccent } from "@/components/venue";
import { RecipeEditorPage } from "@/components/editor/recipe-editor";
import { cx, Empty, FieldRow, Group, Row } from "@/components/ui";

export default function ItemPage() {
  const { id } = useParams<{ id: string }>();
  const decoded = decodeURIComponent(id);
  if (parseVirtualItemId(decoded)) return <GelatoServeView id={decoded} />;
  const beer = parseBeerItemId(decoded);
  if (beer) return <BeerRedirect to={`/beers/${beer.beerId}`} />;
  return <RecipeEditorPage kind="item" id={id} />;
}

/** A gelato flavour × serve: read-only; it is edited through its flavour mix and the serve. */
function GelatoServeView({ id }: { id: string }) {
  const store = useStore();
  const ref = parseVirtualItemId(id)!;
  const c = store.itemCosts.get(id);
  const flavour = store.preps.find((p) => p.id === ref.prepId);
  const serve = store.gelatoServes.find((s) => s.id === ref.serveId);
  if (!c || !flavour || !serve)
    return (
      <Empty
        title="Serve Not Found"
        body="The flavour or serve may have been removed."
        action={
          <Link href="/menu?venue=gelato" className="btn-primary">
            Back to Menu
          </Link>
        }
      />
    );
  return (
    <div className="max-w-2xl lg:pt-6">
      <VenueAccent slug="gelato" />
      <Link href="/menu?venue=gelato" className="btn-text -ml-1 !gap-0 !text-accent">
        <ChevronLeft className="h-6 w-6" strokeWidth={2.25} />
        Menu
      </Link>
      <h1 className="mt-2 text-[28px] font-bold leading-tight tracking-tight lg:text-[32px]">
        {flavourName(flavour)} <span className="text-label-2">· {serve.name}</span>
      </h1>
      <p className="mt-1 text-[15px] text-label-2">Priced automatically from the flavour mix and the serve.</p>

      <div className="group-list mt-5">
        <FieldRow label="Price (inc GST)">
          <span className="text-[17px] tnum sm:text-[15px]">{c.sellInc != null ? money(c.sellInc) : "No price"}</span>
        </FieldRow>
        <FieldRow label="Cost">
          <span className="text-[17px] tnum sm:text-[15px]">{money(c.costPerPortion)}</span>
        </FieldRow>
        <FieldRow label="GP" sub={`Target ${gp(c.targetGp, 0)} · suggested ${money(c.suggestedInc)}`}>
          <span className={cx("text-[17px] font-semibold tnum sm:text-[15px]", c.underTarget ? "text-danger" : "text-label")}>{c.gpPct != null ? gp(c.gpPct) : "—"}</span>
        </FieldRow>
      </div>

      <Group title="In This Serve">
        {c.recipe.lines.map((lc) => (
          <Row
            key={lc.line.id}
            title={lc.line.component_type === "prep" ? `${flavourName(flavour)} gelato` : lc.componentName}
            sub={lc.line.component_type === "prep" ? `${formatQty(lc.line.qty, lc.line.unit)} incl. ${gp(store.settings.gelato_wastage, 0)} wastage (${Number(serve.grams)}g served)` : formatQty(lc.line.qty, lc.line.unit)}
            trailing={money(lc.cost)}
          />
        ))}
      </Group>

      <div className="group-list mt-6">
        <Row href={`/preps/${flavour.id}`} title="Edit Flavour Mix" sub="Changes flow to every serve of this flavour" chevron />
        <Row href="/gelato/serves" title={`Edit ${serve.name}`} sub="Grams, price and packaging — changes every flavour" chevron />
      </div>
    </div>
  );
}

/** A tap beer × serve lives on its beer's page. */
function BeerRedirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => router.replace(to), [router, to]);
  return null;
}
