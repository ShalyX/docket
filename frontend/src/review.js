export const REVIEW_CHOICES = new Set(["satisfied", "disputed", "clarification"]);

export function summarizeReview(criteria, choices = {}) {
  const rows = Array.isArray(criteria) ? criteria : [];
  let satisfiedBps = 0;
  let assessedCount = 0;
  const flagged = [];

  for (const criterion of rows) {
    const id = String(criterion?.id || "");
    const choice = REVIEW_CHOICES.has(choices[id]) ? choices[id] : "";
    if (choice) assessedCount += 1;
    if (choice === "satisfied") satisfiedBps += Math.max(0, Number(criterion?.weightBps) || 0);
    if (choice === "disputed" || choice === "clarification") flagged.push({ ...criterion, choice });
  }

  satisfiedBps = Math.min(10_000, Math.round(satisfiedBps));
  return {
    satisfiedBps,
    requesterBps: 10_000 - satisfiedBps,
    assessedCount,
    totalCount: rows.length,
    complete: rows.length > 0 && assessedCount === rows.length,
    allSatisfied: rows.length > 0 && assessedCount === rows.length && flagged.length === 0,
    flagged,
  };
}

function cleanInline(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

export function buildStructuredDisputeReason({ criteria, choices = {}, notes = {}, headSha = "", maxLength = 800 }) {
  const summary = summarizeReview(criteria, choices);
  if (!summary.complete || summary.flagged.length === 0) return "";

  const commit = cleanInline(headSha, 64);
  const lead = commit
    ? `Requester review of commit ${commit}: `
    : "Requester criterion review: ";
  const statements = summary.flagged.map((criterion) => {
    const id = cleanInline(criterion.id, 100) || "unnamed-criterion";
    const state = criterion.choice === "clarification" ? "needs clarification" : "is disputed";
    const note = cleanInline(notes[id], 220);
    return `Criterion ${id} ${state}.${note ? ` ${note}` : ""}`;
  });
  const suffix = ` Projected requester assessment: ${summary.satisfiedBps}/10000 bps satisfied.`;
  const available = Math.max(0, maxLength - lead.length - suffix.length);
  let body = statements.join(" ");
  if (body.length > available) body = `${body.slice(0, Math.max(0, available - 1)).trimEnd()}…`;
  return `${lead}${body}${suffix}`.slice(0, maxLength);
}
