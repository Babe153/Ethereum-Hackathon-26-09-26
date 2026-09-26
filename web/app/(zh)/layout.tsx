import type { Metadata } from "next";
import "@rainbow-me/rainbowkit/styles.css";
import "../globals.css";
import Providers from "../providers";

export const metadata: Metadata = {
  title: "ProofPay｜AI 验收悬赏与链上托管",
  description: "用链上托管锁定测试币赏金，由 AI 按验收标准审核交付，争议期结束后放款。",
};

export default function ChineseLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><Providers>{children}</Providers></body></html>;
}
