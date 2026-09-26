import type { Metadata } from "next";
import BountyApp from "@/app/bounty-app";

export const metadata: Metadata = { title: "个人中心｜ProofPay" };

export default function ProfilePage() {
  return <BountyApp locale="zh" view="profile" />;
}
