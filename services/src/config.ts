import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  getAddress,
  type Abi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import escrowAbi from "../../shared/BountyEscrow.abi.json" with { type: "json" };

loadEnv({ path: resolve(process.cwd(), "../.env") });

export const chain = defineChain({
  id: Number(process.env.CHAIN_ID || 133),
  name: "HSKChain Testnet",
  nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.RPC_URL || "https://testnet.hsk.xyz"] },
  },
  blockExplorers: {
    default: { name: "HSK Explorer", url: "https://testnet-explorer.hskchain.net" },
  },
});

export const publicClient = createPublicClient({
  chain,
  transport: http(chain.rpcUrls.default.http[0]),
});
export const escrowAddress = process.env.ESCROW_ADDRESS
  ? getAddress(process.env.ESCROW_ADDRESS)
  : undefined;
export const escrow = escrowAbi as Abi;

export function accountFor(name: "VERIFIER" | "AGENT") {
  const key = process.env[`${name}_PRIVATE_KEY`];
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key))
    throw new Error(
      `${name}_PRIVATE_KEY must be a 0x-prefixed 32-byte key in ../.env`,
    );
  return privateKeyToAccount(key as `0x${string}`);
}

export function walletFor(name: "VERIFIER" | "AGENT") {
  const account = accountFor(name);
  return {
    account,
    wallet: createWalletClient({
      account,
      chain,
      transport: http(chain.rpcUrls.default.http[0]),
    }),
  };
}

export async function assertNetwork() {
  const actual = await publicClient.getChainId();
  if (actual !== chain.id)
    throw new Error(
      `RPC chain ID ${actual} does not match configured ${chain.id}`,
    );
  if (!escrowAddress) throw new Error("ESCROW_ADDRESS is missing from ../.env");
  const code = await publicClient.getCode({ address: escrowAddress });
  if (!code) throw new Error(`No escrow contract at ${escrowAddress}`);
}

export type Bounty = {
  poster: `0x${string}`;
  worker: `0x${string}`;
  amount: bigint;
  criteria: string;
  deadline: bigint;
  submissionURI: string;
  submissionHash: `0x${string}`;
  reasonHash: `0x${string}`;
  approvedAt: bigint;
  status: number;
};

export async function getBounty(id: bigint): Promise<Bounty> {
  return (await publicClient.readContract({
    address: escrowAddress!,
    abi: escrow,
    functionName: "getBounty",
    args: [id],
  })) as Bounty;
}
