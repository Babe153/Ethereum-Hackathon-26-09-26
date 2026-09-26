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
import { humanReviewWindowMs, readPendingReview, savePendingReview } from "./reviews.js";
import { startHeartbeat } from "./health.js";
import agentMode from "../../web/agent-mode.json" with { type: "json" };

let health: ReturnType<typeof startHeartbeat>;
let scanFailed = false;

const { account, wallet } = walletFor("VERIFIER");
const busy = new Set<string>();
const settling = new Set<string>();
const verifiedRecently = new Map<string, { uri: string; at: number }>();
const settledRecently = new Map<string, number>();
const finishedForVerifier = new Set<string>();
let settlementScanRunning = false;

async function verify(id: bigint) {
  if (busy.has(String(id))) return;
  busy.add(String(id));
  try {
    const bounty = await getBounty(id);
    if (bounty.status !== 2) return;
    const previous = verifiedRecently.get(String(id));
    if (
      previous?.uri === bounty.submissionURI &&
      Date.now() - previous.at < 60_000
    )
      return;
    const pending = await readPendingReview(id);
    const currentPending = pending?.submissionURI === bounty.submissionURI && pending.submissionHash.toLowerCase() === bounty.submissionHash.toLowerCase() ? pending : null;
    let verdict: { pass: boolean; score: number; reason: string; source: "ai" | "poster" };
    if (currentPending) {
      if (currentPending.humanApproval) {
        const posterReason = currentPending.humanApproval.reason;
        const chinese = /[\u3400-\u9fff]/.test(bounty.criteria);
        verdict = {
          pass: true,
          score: currentPending.score,
          source: "poster",
          reason: chinese
            ? `发布者人工认可交付，推翻 DeepSeek 的未通过建议。发布者理由：${posterReason}\nDeepSeek 原建议：${currentPending.reason}`
            : `The poster approved this work despite DeepSeek's rejection. Poster reason: ${posterReason}\nOriginal DeepSeek finding: ${currentPending.reason}`,
        };
      } else if (Date.now() >= currentPending.createdAt + humanReviewWindowMs) {
        verdict = { pass: false, score: currentPending.score, reason: currentPending.reason, source: "ai" };
      } else return;
    } else {
    const base = new URL(
      process.env.SERVICE_BASE_URL || "http://localhost:8787",
    );
    const uri = new URL(bounty.submissionURI);
    if (
      uri.origin !== base.origin ||
      !/^\/submissions\/[0-9a-f-]{36}$/.test(uri.pathname)
    )
      throw new Error("Submission URI is outside the trusted store");
    const response = await fetch(uri, { headers: { "x-proofpay-service-secret": process.env.SERVICE_PROXY_SECRET || "" }, signal: AbortSignal.timeout(10000) });
    if (!response.ok)
      throw new Error(`Submission fetch failed: ${response.status}`);
    const { content } = (await response.json()) as { content: string };
    if (
      typeof content !== "string" ||
      keccak256(stringToHex(content)) !== bounty.submissionHash
    )
      throw new Error("On-chain submission hash mismatch");
    const criteria = bounty.criteria.startsWith(agentMode.prefix) ? bounty.criteria.slice(agentMode.prefix.length) : bounty.criteria;
    const aiVerdict = await judge(criteria, content);
    if (!aiVerdict.pass) {
      await savePendingReview(id, bounty.submissionHash, bounty.submissionURI, aiVerdict.score, aiVerdict.reason);
      console.log(`AI recommends revising #${id}; poster may approve within 5 minutes.`);
      return;
    }
    verdict = { ...aiVerdict, source: "ai" };
    }
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
      uri: bounty.submissionURI,
      at: Date.now(),
    });
    await saveReason(id, verdict.reason, verdict.score, verdict.pass, verdict.source);
    console.log(
      `Verified #${id}: ${verdict.pass}, score ${verdict.score}, ${tx}`,
    );
  } catch (error) {
    scanFailed = true;
    health?.failed();
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
health = startHeartbeat('verifier');

// A chain cannot wake itself up. This keeper submits the permissionless claim transaction
// after the challenge window. If it is offline, the web UI can call claim instead.
async function settleApproved() {
  if (settlementScanRunning) return;
  settlementScanRunning = true;
  scanFailed = false;
  try {
    const total = (await publicClient.readContract({
      address: escrowAddress!,
      abi: escrow,
      functionName: "bountyCount",
    })) as bigint;
    for (let id = 0n; id < total; id++) {
      if (finishedForVerifier.has(String(id))) continue;
      if (settling.has(String(id)) || busy.has(String(id))) continue;
      if (Date.now() - (settledRecently.get(String(id)) || 0) < 60_000)
        continue;
      const bounty = await getBounty(id);
      if (bounty.status >= 4) {
        finishedForVerifier.add(String(id));
        continue;
      }
      if (bounty.status === 2) {
        await verify(id);
        continue;
      }
      if (bounty.status !== 3) continue;
      const latest = await publicClient.getBlock();
      const window = (await publicClient.readContract({
        address: escrowAddress!,
        abi: escrow,
        functionName: "challengeWindow",
      })) as bigint;
      if (latest.timestamp < bounty.approvedAt + window) continue;
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
        scanFailed = true;
        health.failed();
        console.error(`Settlement #${id}:`, error);
      } finally {
        settling.delete(String(id));
      }
    }
    if (!scanFailed) health.healthy();
  } catch (error) {
    health.failed();
    console.error("Settlement scan:", error);
  } finally {
    settlementScanRunning = false;
  }
}

void settleApproved();
setInterval(() => {
  void settleApproved();
}, 8000);
