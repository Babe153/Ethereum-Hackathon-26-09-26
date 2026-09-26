import type { Metadata } from "next";
import BountyApp from "@/app/bounty-app";

export const metadata: Metadata = { title: "Profile | ProofPay" };

export default function ProfilePage() {
  return <BountyApp locale="en" view="profile" />;
}
