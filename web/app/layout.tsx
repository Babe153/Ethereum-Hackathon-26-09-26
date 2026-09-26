import type { Metadata } from "next";
import "@rainbow-me/rainbowkit/styles.css";
import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "ProofPay — AI Bounty Escrow",
  description: "AI verified bounties with on-chain escrow and a timed challenge window on HSKChain.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><Providers>{children}</Providers></body></html>;
}
