import type { Metadata } from "next";
import Home from "../../(en)/page";

export const metadata: Metadata = {
  title: "ProofPay｜AI 验收悬赏与链上托管",
  description: "用链上托管锁定测试币赏金，由 AI 按验收标准审核交付，争议期结束后放款。",
  alternates: { canonical: "/zh", languages: { en: "/", "zh-CN": "/zh" } },
};

export default function ChinesePage() {
  return <Home locale="zh" />;
}
