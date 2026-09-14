export function deriveAdjudicationStages({ taskStatus = "", storedStatus = "", decisionActive = false, canAppeal = false, hasTx = false }) {
  const stored = String(storedStatus).toLowerCase().replace(/\s/g, "");
  const finalized = stored === "finalized" || String(taskStatus).toUpperCase() === "RESOLVED";
  const inAppeal = stored.includes("appeal");
  const decided = Boolean(decisionActive) || ["accepted", "undetermined", "validatorstimeout", "leadertimeout"].includes(stored) || finalized;
  return {
    packet: hasTx ? "complete" : "active",
    consensus: finalized || decided || inAppeal ? "complete" : hasTx ? "active" : "pending",
    decision: finalized || inAppeal ? "complete" : decided ? "active" : "pending",
    appeal: finalized ? "complete" : inAppeal || canAppeal || decided ? "active" : "pending",
    finality: finalized ? "complete" : "pending",
  };
}
