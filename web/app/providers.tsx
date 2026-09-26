"use client";

import { useState } from "react";
import {
  RainbowKitProvider,
  connectorsForWallets,
} from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig } from "wagmi";
import { defineChain, http } from "viem";

export const hsk = defineChain({
  id: Number(process.env.NEXT_PUBLIC_CHAIN_ID || 133),
  name: "HSKChain Testnet",
  nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_RPC_URL || "https://testnet.hsk.xyz"],
    },
  },
  blockExplorers: {
    default: { name: "HSK Explorer", url: "https://testnet-explorer.hskchain.net" },
  },
  testnet: true,
});

const connectors = connectorsForWallets(
  [{ groupName: "Browser wallets", wallets: [injectedWallet] }],
  {
    appName: "ProofPay",
    projectId:
      process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ||
      "unused-injected-only",
  },
);

const config = createConfig({
  chains: [hsk],
  transports: { [hsk.id]: http(hsk.rpcUrls.default.http[0]) },
  connectors,
  ssr: true,
});

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>{children}</RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
