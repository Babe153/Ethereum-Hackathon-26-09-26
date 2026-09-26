import type { NextConfig } from "next";
import { config } from "dotenv";

config({ path: "../.env" });

const nextConfig: NextConfig = {
  agentRules: false,
  turbopack: { root: process.cwd() },
};
export default nextConfig;
