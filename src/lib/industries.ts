/**
 * Industries Experience.com sells into. One list, used by the customer inquiry
 * form, the internal New Lead dialog, the pipeline's industry filter and the
 * routing rules — so the category a prospect picks is the category the rep
 * filters by and the category that decides who picks the lead up.
 */
export const INDUSTRIES = [
  "Real Estate",
  "Mortgage",
  "Insurance",
  "Financial Services",
  "Healthcare",
  "Dental",
  "Legal",
  "Restaurants",
  "Hotels & Hospitality",
  "Retail & E-commerce",
  "Jewellery",
  "Gyms & Fitness",
  "Salons & Spas",
  "Education",
  "Automotive",
  "Home Services",
  "Professional Services",
  "Other",
] as const;

export type Industry = (typeof INDUSTRIES)[number];

export function normalizeIndustry(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}
