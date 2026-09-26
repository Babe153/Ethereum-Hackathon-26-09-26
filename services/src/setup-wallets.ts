import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { privateKeyToAccount } from "viem/accounts";

const wallets = Object.fromEntries(
  ["DEPLOYER", "VERIFIER", "AGENT", "ARBITER"].map((role) => {
    const key = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;
    return [role, { key, address: privateKeyToAccount(key).address }];
  }),
) as Record<string, { key: string; address: string }>;

const lines = [
  "# Demo wallets only. Never use these keys on a mainnet or for real funds.",
  "RPC_URL=https://testnet.hsk.xyz",
  "CHAIN_ID=133",
  `DEPLOYER_PRIVATE_KEY=${wallets.DEPLOYER.key}`,
  `VERIFIER_PRIVATE_KEY=${wallets.VERIFIER.key}`,
  `VERIFIER_ADDRESS=${wallets.VERIFIER.address}`,
  `AGENT_PRIVATE_KEY=${wallets.AGENT.key}`,
  `ARBITER_PRIVATE_KEY=${wallets.ARBITER.key}`,
  `ARBITER_ADDRESS=${wallets.ARBITER.address}`,
  "TOKEN_ADDRESS=",
  "ESCROW_ADDRESS=",
  "OPENAI_API_KEY=",
  "OPENAI_MODEL=gpt-4.1-mini",
  "DEEPSEEK_API_KEY=",
  "DEEPSEEK_MODEL=deepseek-flash",
  "SERVICE_BASE_URL=http://localhost:8787",
  "SERVICE_PORT=8787",
  "DEMO_MODE=0",
  "NEXT_PUBLIC_RPC_URL=https://testnet.hsk.xyz",
  "NEXT_PUBLIC_CHAIN_ID=133",
  "NEXT_PUBLIC_TOKEN_ADDRESS=",
  "NEXT_PUBLIC_ESCROW_ADDRESS=",
  "NEXT_PUBLIC_SERVICE_URL=http://localhost:8787",
  "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=",
];

const path = resolve(process.cwd(), "../.env");
await writeFile(path, `${lines.join("\n")}\n`, { flag: "wx", mode: 0o600 });
console.log(
  `Created ${path} with mode 0600. Fund these HSKChain testnet addresses only:`,
);
for (const [role, wallet] of Object.entries(wallets))
  console.log(`${role}: ${wallet.address}`);
