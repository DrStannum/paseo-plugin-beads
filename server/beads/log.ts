/**
 * Server diagnostics. console.error lands in `paseo plugin logs beads` and the
 * daemon log. Callers pass codes, counts, command names and paths — never
 * issue titles, text or comments (invariant 6).
 */
export function log(message: string): void {
  console.error(`[beads] ${message}`);
}
