// Idempotency marker (research.md #3, Principle IV). The aggregate action prepends this to
// every UnifiedReport.body; the prComment channel uses it to find and PATCH an existing
// comment instead of posting a duplicate.
export const REPORT_MARKER = "<!-- swarm-reviewer:report:v1 -->";
