"use client";

import { MatrixReviewPage } from "@/components/matrix/review-page";

/** Allergy Matrix review mode: /matrix/review?venue=drift&section=* steps through the dishes that need allergen approval. */
export default function MatrixReviewRoute() {
  return <MatrixReviewPage />;
}
