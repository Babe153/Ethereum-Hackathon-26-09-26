import { createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { accountFor, chain, publicClient } from "./config.js";

if (
  chain.id !== 133 ||
  chain.rpcUrls.default.http[0] !== "https://testnet.hsk.xyz"
) {
  throw new Error("Funding is restricted to HSKChain testnet");
}
if ((await publicClient.getChainId()) !== 133)
  throw new Error("RPC chain ID mismatch");

const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
const arbiterKey = process.env.ARBITER_PRIVATE_KEY;
if (!deployerKey || !arbiterKey)
  throw new Error("Missing deployer or arbiter key in ../.env");
const deployer = privateKeyToAccount(deployerKey as `0x${string}`);
const arbiter = privateKeyToAccount(arbiterKey as `0x${string}`);
if (
  arbiter.address.toLowerCase() !== process.env.ARBITER_ADDRESS?.toLowerCase()
) {
  throw new Error("Arbiter key/address mismatch");
}
const wallet = createWalletClient({
  account: deployer,
  chain,
  transport: http(chain.rpcUrls.default.http[0]),
});
const recipients = [accountFor("VERIFIER"), accountFor("AGENT"), arbiter];
const amount = parseEther("0.01");
let nonce = await publicClient.getTransactionCount({
  address: deployer.address,
  blockTag: "pending",
});

for (const recipient of recipients) {
  const balance = await publicClient.getBalance({ address: recipient.address });
  if (balance >= parseEther("0.005")) {
    console.log(`${recipient.address} already has ${balance} wei; skipped`);
    continue;
  }
  const tx = await wallet.sendTransaction({
    to: recipient.address,
    value: amount,
    nonce,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success")
    throw new Error(`Funding transaction reverted: ${tx}`);
  nonce++;
  console.log(`Funded ${recipient.address} with 0.01 test HSK: ${tx}`);
}
