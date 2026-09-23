"use client";

import { useParams } from "next/navigation";
import { RecipeEditorPage } from "@/components/editor/recipe-editor";

export default function ItemPage() {
  const { id } = useParams<{ id: string }>();
  return <RecipeEditorPage kind="item" id={id} />;
}
