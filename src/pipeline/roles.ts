import { containsPhrase, foldForMatch, stripGenderMarkers } from "./text";

/** Same as the Airtable `Profile → Target roles` setting. */
export const DEFAULT_TARGET_ROLES = [
  "Product Manager",
  "Senior Product Manager",
  "Solution Architect",
  "Solution Specialist",
];

/** "Product Manager, Solution Architect" (a Profile cell) → list. */
export const parseRoleList = (value: string): string[] =>
  value.split(/[,\n;]/).map((s) => s.trim()).filter(Boolean);

/** Hebrew titles and the plural spellings real postings use ("Solutions Architect"). */
const EXTRA: Record<string, string[]> = {
  "product manager": ["מנהל מוצר", "מנהלת מוצר"],
  "solution architect": ["solutions architect", "ארכיטקט פתרונות", "ארכיטקטית פתרונות"],
  "solution specialist": ["solutions specialist", "מומחה פתרונות", "מומחית פתרונות"],
};

export function expandRoles(roles: string[]): string[] {
  const out = new Set<string>();
  for (const role of roles) {
    const f = foldForMatch(role);
    out.add(f);
    for (const [base, more] of Object.entries(EXTRA)) {
      if (containsPhrase(f, base)) more.forEach((m) => out.add(foldForMatch(m)));
    }
  }
  return [...out];
}

/**
 * A job is relevant when its title contains one of the target roles as whole words
 * ("Senior Product Manager", "מנהל/ת מוצר בכיר/ה") and none of the blocklist words.
 * "Product Marketing Manager" does not match "Product Manager".
 * The blocklist is empty by default (the Profile table has no blocklist yet).
 */
export function isTargetRole(
  title: string,
  roles: string[] = DEFAULT_TARGET_ROLES,
  blocklist: string[] = [],
): boolean {
  const t = foldForMatch(stripGenderMarkers(title));
  if (blocklist.some((b) => b.trim() && containsPhrase(t, foldForMatch(b)))) return false;
  return expandRoles(roles).some((r) => containsPhrase(t, r));
}
