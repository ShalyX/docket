export const INCONCLUSIVE_RECOVERY_DELAY_SECONDS = 604_800;
export const TASK_RECOVERY_DEADLINE_SECONDS = 2_592_000;

function unixSeconds(value) {
  if (typeof value === "bigint") {
    return value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
  }
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/**
 * Project the contract's requester recovery window without replacing the
 * contract check. The contract remains authoritative if the local clock or
 * returned timestamps differ.
 */
export function deriveRecoveryWindow({ status = "", createdAt = 0, inconclusiveAt = 0, now = Math.floor(Date.now() / 1000) } = {}) {
  if (String(status).toUpperCase() !== "NEEDS_EVIDENCE") {
    return {
      state: "not-applicable",
      eligible: false,
      eligibleAt: null,
      retryEligibleAt: null,
      deadlineAt: null,
      remainingSeconds: 0,
    };
  }

  const created = unixSeconds(createdAt);
  const inconclusive = unixSeconds(inconclusiveAt);
  const retryEligibleAt = inconclusive === null ? null : inconclusive + INCONCLUSIVE_RECOVERY_DELAY_SECONDS;
  const deadlineAt = created === null ? null : created + TASK_RECOVERY_DEADLINE_SECONDS;
  const candidates = [retryEligibleAt, deadlineAt].filter((value) => value !== null);
  if (!candidates.length) {
    return {
      state: "unknown",
      eligible: false,
      eligibleAt: null,
      retryEligibleAt,
      deadlineAt,
      remainingSeconds: 0,
    };
  }

  const eligibleAt = Math.min(...candidates);
  const current = unixSeconds(now) ?? Math.floor(Date.now() / 1000);
  const remainingSeconds = Math.max(0, eligibleAt - current);
  return {
    state: remainingSeconds === 0 ? "eligible" : "waiting",
    eligible: remainingSeconds === 0,
    eligibleAt,
    retryEligibleAt,
    deadlineAt,
    remainingSeconds,
  };
}

export function formatRecoveryCountdown(seconds) {
  let remaining = Math.max(0, Math.ceil(Number(seconds) || 0));
  const days = Math.floor(remaining / 86_400);
  remaining %= 86_400;
  const hours = Math.floor(remaining / 3_600);
  remaining %= 3_600;
  const minutes = Math.floor(remaining / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  if (!days && minutes) parts.push(`${minutes}m`);
  return parts.length ? parts.join(" ") : "under a minute";
}
