import { redirect } from "next/navigation";

/** Specials are priced with What If on any recipe and saved as a recipe of their own. */
export default function SpecialsPage() {
  redirect("/recipes");
}
