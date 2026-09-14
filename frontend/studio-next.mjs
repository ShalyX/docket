import { studioDevnet } from "genlayer-js/chains";

export const STUDIO_NEXT_RPC_URL = "https://studio-next.genlayer.com/api";

// genlayer-js 2.0.0-rc.1 still ships the older Studio Dev hostname. The
// hackathon requires Studio Next, which currently serves the same chain ID and
// deployed state, so keep the SDK chain metadata and pin the required RPC.
export const studioNext = {
  ...studioDevnet,
  name: "Studio Next",
  rpcUrls: {
    default: {
      http: [STUDIO_NEXT_RPC_URL],
    },
  },
};
