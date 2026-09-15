export function chainIdHex(chainId) {
  return `0x${Number(chainId).toString(16)}`;
}

function isUnknownChainError(error) {
  const code = Number(error?.code);
  if (code === 4902) return true;
  const message = String(error?.message || error?.shortMessage || "").toLowerCase();
  return message.includes("unknown chain") || message.includes("unrecognized chain") || message.includes("chain not found");
}

export async function ensureWalletNetwork(provider, chain, explorerBaseUrl = "") {
  if (!provider || typeof provider.request !== "function") {
    throw new Error("The wallet does not expose an EIP-1193 request method.");
  }
  const targetChainId = chainIdHex(chain.id);
  const currentChainId = await provider.request({ method: "eth_chainId" });
  if (String(currentChainId).toLowerCase() === targetChainId) return targetChainId;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: targetChainId }],
    });
  } catch (error) {
    if (!isUnknownChainError(error)) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: targetChainId,
        chainName: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: chain.rpcUrls?.default?.http || [],
        ...(explorerBaseUrl ? { blockExplorerUrls: [explorerBaseUrl] } : {}),
      }],
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: targetChainId }],
    });
  }

  const switchedChainId = await provider.request({ method: "eth_chainId" });
  if (String(switchedChainId).toLowerCase() !== targetChainId) {
    throw new Error(`The wallet did not switch to ${chain.name}.`);
  }
  return targetChainId;
}
