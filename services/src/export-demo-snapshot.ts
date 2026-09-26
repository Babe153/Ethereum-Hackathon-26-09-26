import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createCipheriv, randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { keccak256, stringToHex } from "viem";
import {
  assertNetwork,
  chain,
  escrow,
  escrowAddress,
  getBounty,
  publicClient,
} from "./config.js";

await assertNetwork();

const dataDir = process.env.DEMO_DATA_DIR || resolve(process.cwd(), "data");
const output = resolve(process.cwd(), "../web/demo-data/snapshot.json");
const trustedOrigin = new URL(
  process.env.SERVICE_BASE_URL || "http://localhost:8787",
).origin;
const count = (await publicClient.readContract({
  address: escrowAddress!,
  abi: escrow,
  functionName: "bountyCount",
})) as bigint;
const snapshot: Record<string, unknown> = { _deployment: { escrow: escrowAddress, chainId: String(chain.id) } };
let exported = 0;

for (let id = 0n; id < count; id++) {
  const bounty = await getBounty(id);
  if (bounty.status !== 5) continue;

  const uri = new URL(bounty.submissionURI);
  if (
    uri.origin !== trustedOrigin ||
    !/^\/submissions\/[0-9a-f-]{36}$/.test(uri.pathname)
  )
    throw new Error(`Bounty #${id} has an unexpected submission URI`);

  const submissionId = uri.pathname.split("/")[2];
  const submission = JSON.parse(
    await readFile(resolve(dataDir, "submissions", `${submissionId}.json`), "utf8"),
  ) as { content: string };
  if (
    typeof submission.content !== "string" ||
    keccak256(stringToHex(submission.content)) !== bounty.submissionHash
  )
    throw new Error(`Bounty #${id} submission differs from the on-chain hash`);

  const reason = JSON.parse(
    await readFile(resolve(dataDir, "reasons", `${id}.json`), "utf8"),
  ) as { reason: string; score: number; pass: boolean; hash: string };
  if (
    typeof reason.reason !== "string" ||
    keccak256(stringToHex(reason.reason)) !== bounty.reasonHash ||
    reason.hash !== bounty.reasonHash
  )
    throw new Error(`Bounty #${id} reason differs from the on-chain hash`);

  snapshot[uri.pathname] = submission;
  snapshot[`/reasons/${id}`] = reason;
  exported++;
}

if (exported === 0) throw new Error("No paid bounties to export");
const snapshotKey = process.env.SNAPSHOT_KEY;
if (!snapshotKey || !/^[0-9a-f]{64}$/i.test(snapshotKey))
  throw new Error("SNAPSHOT_KEY must be 32 random bytes in hex");
const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", Buffer.from(snapshotKey, "hex"), iv);
const ciphertext = Buffer.concat([
  cipher.update(JSON.stringify(snapshot), "utf8"),
  cipher.final(),
]);
const encrypted = {
  format: "aes-256-gcm",
  iv: iv.toString("base64"),
  tag: cipher.getAuthTag().toString("base64"),
  ciphertext: ciphertext.toString("base64"),
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(encrypted, null, 2)}\n`);
console.log(`Exported ${exported} encrypted, on-chain verified paid bounties to ${output}`);
