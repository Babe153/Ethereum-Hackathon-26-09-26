import { keccak256, stringToHex } from "viem";
import {
  assertNetwork,
  escrow,
  escrowAddress,
  getBounty,
  publicClient,
  walletFor,
} from "./config.js";
import { judge } from "./llm.js";
import { saveReason } from "./store.js";

const { account, wallet } = walletFor("VERIFIER");
const busy = new Set<string>();
const settling = new Set<string>();
const verifiedRecently = new Map<string, { hash: string; at: number }>();
const settledRecently = new Map<string, number>();
let settlementScanRunning = false;

async function verify(id: bigint) {
  if (busy.has(String(id))) return;
  busy.add(String(id));
  try {
    const bounty = await getBounty(id);
    if (bounty.status !== 2) return;
    const previous = verifiedRecently.get(String(id));
    if (
      previous?.hash === bounty.submissionHash &&
      Date.now() - previous.at < 60_000
    )
      return;
    const base = new URL(
      process.env.SERVICE_BASE_URL || "http://localhost:8787",
    );
    const uri = new URL(bounty.submissionURI);
    if (
      uri.origin !== base.origin ||
      !/^\/submissions\/[0-9a-f-]{36}$/.test(uri.pathname)
    )
      throw new Error("Submission URI is outside the trusted store");
    const response = await fetch(uri, { signal: AbortSignal.timeout(10000) });
    if (!response.ok)
      throw new Error(`Submission fetch failed: ${response.status}`);
    const { content } = (await response.json()) as { content: string };
    if (
      typeof content !== "string" ||
      keccak256(stringToHex(content)) !== bounty.submissionHash
    )
      throw new Error("On-chain submission hash mismatch");
    const verdict = await judge(bounty.criteria, content);
    const reasonHash = keccak256(stringToHex(verdict.reason));
    const tx = await wallet.writeContract({
      address: escrowAddress!,
      abi: escrow,
      functionName: "verify",
      args: [id, verdict.pass, reasonHash],
      gas: 350_000n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
    if (receipt.status !== "success") throw new Error(`Verify reverted: ${tx}`);
    verifiedRecently.set(String(id), {
      hash: bounty.submissionHash,
      at: Date.now(),
    });
    await saveReason(id, verdict.reason, verdict.score, verdict.pass);
    console.log(
      `Verified #${id}: ${verdict.pass}, score ${verdict.score}, ${tx}`,
    );
  } catch (error) {
    console.error(`Verification #${id}:`, error);
  } finally {
    busy.delete(String(id));
  }
}

await assertNetwork();
const onchainVerifier = (await publicClient.readContract({
  address: escrowAddress!,
  abi: escrow,
  functionName: "verifier",
})) as string;
if (onchainVerifier.toLowerCase() !== account.address.toLowerCase())
  throw new Error(
    `Verifier key ${account.address} differs from contract verifier ${onchainVerifier}`,
  );
console.log(`Verifier ${account.address} watching ${escrowAddress}`);
publicClient.watchContractEvent({
  address: escrowAddress!,
  abi: escrow,
  eventName: "Submitted",
  poll: true,
  onLogs: () => {
    void settleApproved();
  },
  onError: console.error,
});

// A chain cannot wake itself up. This keeper submits the permissionless claim transaction
// after the challenge window. If it is offline, the web UI can call claim instead.
async function settleApproved() {
  if (settlementScanRunning) return;
  settlementScanRunning = true;
  try {
    const latest = await publicClient.getBlock();
    const window = (await publicClient.readContract({
      address: escrowAddress!,
      abi: escrow,
      functionName: "challengeWindow",
    })) as bigint;
    const total = (await publicClient.readContract({
      address: escrowAddress!,
      abi: escrow,
      functionName: "bountyCount",
    })) as bigint;
    for (let id = 0n; id < total; id++) {
      if (settling.has(String(id)) || busy.has(String(id))) continue;
      if (Date.now() - (settledRecently.get(String(id)) || 0) < 60_000)
        continue;
      const bounty = await getBounty(id);
      if (bounty.status === 2) {
        await verify(id);
        continue;
      }
      if (bounty.status !== 3 || latest.timestamp < bounty.approvedAt + window)
        continue;
      settling.add(String(id));
      try {
        const tx = await wallet.writeContract({
          address: escrowAddress!,
          abi: escrow,
          functionName: "claim",
          args: [id],
          gas: 200_000n,
        });
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: tx,
        });
        if (receipt.status !== "success")
          throw new Error(`Claim reverted: ${tx}`);
        settledRecently.set(String(id), Date.now());
        console.log(`Automatically released bounty #${id}: ${tx}`);
      } catch (error) {
        console.error(`Settlement #${id}:`, error);
      } finally {
        settling.delete(String(id));
      }
    }
  } catch (error) {
    console.error("Settlement scan:", error);
  } finally {
    settlementScanRunning = false;
  }
}

void settleApproved();
setInterval(() => {
  void settleApproved();
}, 4000);
