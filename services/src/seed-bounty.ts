import { createWalletClient, http, parseUnits, type Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import tokenAbiJson from "../../shared/MockUSDT.abi.json" with { type: "json" };
import { assertNetwork, assertWriteNetwork, chain, escrow, escrowAddress, publicClient } from "./config.js";
import agentMode from "../../web/agent-mode.json" with { type: "json" };

if (chain.id !== 133) {
  throw new Error("Expected HSKChain testnet chain ID 133");
}
await assertNetwork();
await assertWriteNetwork();
const key = process.env.DEPLOYER_PRIVATE_KEY;
const tokenAddress = process.env.TOKEN_ADDRESS as `0x${string}` | undefined;
if (!key || !tokenAddress || !escrowAddress)
  throw new Error("Missing deployer key or contract addresses in ../.env");

const account = privateKeyToAccount(key as `0x${string}`);
const wallet = createWalletClient({
  account,
  chain,
  transport: http(chain.rpcUrls.default.http[0]),
});
const tokenAbi = tokenAbiJson as Abi;
const amount = parseUnits("100", 6);
const autoAgent = process.env.DEMO_AGENT_MODE !== "0";
const criteria = (autoAgent ? agentMode.prefix : "") + (process.env.DEMO_CRITERIA ||
  "Write one paragraph explaining why a pre-funded escrow protects a freelancer. Include the exact words escrow and challenge window.");
const deadlineMinutes = Number(process.env.DEMO_DEADLINE_MINUTES || 30);
if (!Number.isInteger(deadlineMinutes) || deadlineMinutes < 1 || deadlineMinutes > 43200)
  throw new Error("DEMO_DEADLINE_MINUTES must be 1-43200");
let nonce = await publicClient.getTransactionCount({
  address: account.address,
  blockTag: "pending",
});

async function send(
  address: `0x${string}`,
  abi: Abi,
  functionName: string,
  args: unknown[],
) {
  const hash = await wallet.writeContract({
    address,
    abi,
    functionName,
    args,
    // The public RPC can lag behind a confirmed transaction during gas estimation.
    gas: 700_000n,
    nonce,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success")
    throw new Error(`${functionName} reverted: ${hash}`);
  nonce++;
  console.log(`${functionName}: ${hash}`);
}

const balance = (await publicClient.readContract({
  address: tokenAddress,
  abi: tokenAbi,
  functionName: "balanceOf",
  args: [account.address],
})) as bigint;
if (balance < amount)
  await send(tokenAddress, tokenAbi, "mint", [account.address, amount]);
const allowance = (await publicClient.readContract({
  address: tokenAddress,
  abi: tokenAbi,
  functionName: "allowance",
  args: [account.address, escrowAddress],
})) as bigint;
if (allowance < amount)
  await send(tokenAddress, tokenAbi, "approve", [escrowAddress, amount]);
const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineMinutes * 60);
await send(escrowAddress, escrow, "createBounty", [amount, criteria, deadline]);
console.log(
  autoAgent ? "Created an AI agent test bounty. Watch the agent and verifier terminals." : "Created a human-open test bounty. The AI agent will leave it open.",
);
