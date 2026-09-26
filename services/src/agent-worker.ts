import { keccak256, stringToHex } from "viem";
import {
  assertNetwork,
  escrow,
  escrowAddress,
  getBounty,
  publicClient,
  walletFor,
} from "./config.js";
import { produce } from "./llm.js";

const { account, wallet } = walletFor("AGENT");
const busy = new Set<string>();
const submittedRecently = new Map<string, number>();
let scanRunning = false;

async function work(id: bigint) {
  if (busy.has(String(id))) return;
  if (Date.now() - (submittedRecently.get(String(id)) || 0) < 30_000) return;
  busy.add(String(id));
  try {
    const bounty = await getBounty(id);
    if (bounty.deadline <= BigInt(Math.floor(Date.now() / 1000))) return;
    if (
      bounty.status !== 0 &&
      !(
        bounty.status === 1 &&
        bounty.worker.toLowerCase() === account.address.toLowerCase()
      )
    )
      return;
    if (bounty.poster.toLowerCase() === account.address.toLowerCase()) return;
    let nonce = await publicClient.getTransactionCount({
      address: account.address,
      blockTag: "pending",
    });
    if (bounty.status === 0) {
      console.log(`Accepting bounty #${id}`);
      const acceptTx = await wallet.writeContract({
        address: escrowAddress!,
        abi: escrow,
        functionName: "accept",
        args: [id],
        gas: 200_000n,
        nonce,
      });
      const accepted = await publicClient.waitForTransactionReceipt({
        hash: acceptTx,
      });
      if (accepted.status !== "success")
        throw new Error(`Accept reverted: ${acceptTx}`);
      nonce++;
    }
    // HSKChain's public RPC can briefly serve an older state after a receipt.
    let ready = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const latest = await getBounty(id);
      if (
        latest.status === 1 &&
        latest.worker.toLowerCase() === account.address.toLowerCase()
      ) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!ready)
      throw new Error(
        "Accepted transaction is not yet visible to RPC; periodic scan will retry",
      );
    const content = await produce(bounty.criteria);
    const response = await fetch(
      `${process.env.SERVICE_BASE_URL || "http://localhost:8787"}/submissions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      },
    );
    if (!response.ok)
      throw new Error(`Submission API returned ${response.status}`);
    const saved = (await response.json()) as {
      uri: string;
      contentHash: `0x${string}`;
    };
    if (saved.contentHash !== keccak256(stringToHex(content)))
      throw new Error("Submission API hash mismatch");
    const submitTx = await wallet.writeContract({
      address: escrowAddress!,
      abi: escrow,
      functionName: "submit",
      args: [id, saved.uri, saved.contentHash],
      gas: 400_000n,
      nonce,
    });
    const submitted = await publicClient.waitForTransactionReceipt({
      hash: submitTx,
    });
    if (submitted.status !== "success")
      throw new Error(`Submit reverted: ${submitTx}`);
    submittedRecently.set(String(id), Date.now());
    console.log(`Submitted bounty #${id}: ${submitTx}`);
  } catch (error) {
    console.error(`Bounty #${id}:`, error);
  } finally {
    busy.delete(String(id));
  }
}

async function scan() {
  if (scanRunning) return;
  scanRunning = true;
  try {
    const count = (await publicClient.readContract({
      address: escrowAddress!,
      abi: escrow,
      functionName: "bountyCount",
    })) as bigint;
    for (let id = 0n; id < count; id++) await work(id);
  } catch (error) {
    console.error("Agent scan:", error);
  } finally {
    scanRunning = false;
  }
}

await assertNetwork();
console.log(`Agent ${account.address} watching ${escrowAddress}`);
void scan();
publicClient.watchContractEvent({
  address: escrowAddress!,
  abi: escrow,
  eventName: "BountyCreated",
  poll: true,
  onLogs: () => {
    void scan();
  },
  onError: console.error,
});
setInterval(() => {
  void scan();
}, 5000);
