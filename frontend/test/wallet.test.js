import assert from "node:assert/strict";
import test from "node:test";
import { ensureWalletNetwork } from "../src/wallet.js";

const chain = {
  id: 61997,
  name: "Studio Next",
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
  rpcUrls: { default: { http: ["https://studio-next.genlayer.com/api"] } },
};

test("does not request Snap methods for a wallet already on the target chain", async () => {
  const calls = [];
  const provider = {
    async request(request) {
      calls.push(request);
      if (request.method === "eth_chainId") return "0xf22d";
      throw new Error(`Unexpected wallet method: ${request.method}`);
    },
  };

  await ensureWalletNetwork(provider, chain);
  assert.deepEqual(calls, [{ method: "eth_chainId" }]);
});

test("switches an installed target chain without invoking Snap methods", async () => {
  const calls = [];
  let chainId = "0x1";
  const provider = {
    async request(request) {
      calls.push(request);
      if (request.method === "eth_chainId") return chainId;
      if (request.method === "wallet_switchEthereumChain") {
        chainId = request.params[0].chainId;
        return null;
      }
      throw new Error(`Unexpected wallet method: ${request.method}`);
    },
  };

  await ensureWalletNetwork(provider, chain);
  assert.deepEqual(calls.map(({ method }) => method), [
    "eth_chainId",
    "wallet_switchEthereumChain",
    "eth_chainId",
  ]);
});

test("adds an unknown target chain, then switches to it", async () => {
  const calls = [];
  let chainId = "0x1";
  const provider = {
    async request(request) {
      calls.push(request);
      if (request.method === "eth_chainId") return chainId;
      if (request.method === "wallet_switchEthereumChain") {
        if (calls.filter(({ method }) => method === "wallet_switchEthereumChain").length === 1) {
          const error = new Error("Unrecognized chain");
          error.code = 4902;
          throw error;
        }
        chainId = request.params[0].chainId;
        return null;
      }
      if (request.method === "wallet_addEthereumChain") return null;
      throw new Error(`Unexpected wallet method: ${request.method}`);
    },
  };

  await ensureWalletNetwork(provider, chain, "https://explorer.example");
  assert.equal(calls[2].method, "wallet_addEthereumChain");
  assert.deepEqual(calls[2].params[0], {
    chainId: "0xf22d",
    chainName: "Studio Next",
    nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
    rpcUrls: ["https://studio-next.genlayer.com/api"],
    blockExplorerUrls: ["https://explorer.example"],
  });
  assert.equal(calls.at(-1).method, "eth_chainId");
});
