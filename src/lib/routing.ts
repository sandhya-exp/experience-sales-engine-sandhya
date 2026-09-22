import type { TeamMember } from "@/lib/repo/users";

/**
 * Who picks up a new inquiry. Two rules, in order:
 *   1. Sector specialist — a team member who covers the prospect's industry.
 *   2. Otherwise the person with the fewest open deals (so coverage spreads
 *      evenly, and a colleague on leave naturally stops receiving new leads
 *      once their leads are reassigned and they're not listed here).
 * Kept as configuration rather than a table: this is the Admin discipline's
 * data to own eventually; for the Sales Engine it only needs to be honest and
 * visible ("Assigned to Sadhana — Real Estate specialist" on the timeline).
 */
export const SECTOR_COVERAGE: Record<string, string[]> = {
  "sandhya@experience.com": ["Insurance", "Mortgage", "Financial Services", "Healthcare", "Dental"],
  "sadhana@experience.com": ["Real Estate", "Hotels & Hospitality", "Restaurants", "Salons & Spas", "Gyms & Fitness"],
  "marcus@experience.com": ["Retail & E-commerce", "Jewellery", "Education", "Professional Services", "Legal", "Automotive", "Home Services"],
};

export function specialistsFor(industry: string | null): string[] {
  if (!industry) return [];
  return Object.entries(SECTOR_COVERAGE)
    .filter(([, sectors]) => sectors.includes(industry))
    .map(([email]) => email);
}

export function pickOwner(team: TeamMember[], industry: string | null): { owner: TeamMember; reason: string } | null {
  // Leads are carried by Sales Employees. A manager approves quotes and an
  // admin runs the boundary; neither works a book, so neither is in the pool —
  // unless nobody else exists, in which case someone is better than no one.
  const carriers = team.filter((m) => m.role === "sales");
  const eligible = carriers.length > 0 ? carriers : team;
  if (eligible.length === 0) return null;
  const specialists = eligible.filter((m) => specialistsFor(industry).includes(m.email.toLowerCase()));
  const pool = specialists.length > 0 ? specialists : eligible;
  const owner = [...pool].sort((a, b) => a.open_leads - b.open_leads || a.name.localeCompare(b.name))[0];
  const reason = specialists.length > 0 ? `${industry} specialist` : "fewest open deals";
  return { owner, reason };
}
