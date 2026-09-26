import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { keccak256, stringToHex } from "viem";

const dir = resolve(process.cwd(), "data");
const submissionDir = resolve(dir, "submissions");
const reasonDir = resolve(dir, "reasons");

export function contentHash(content: string) {
  return keccak256(stringToHex(content));
}

export async function saveSubmission(content: string) {
  if (!content.trim() || content.length > 20_000)
    throw new Error("Submission must be 1–20,000 characters");
  await mkdir(submissionDir, { recursive: true });
  const id = randomUUID();
  await writeFile(
    resolve(submissionDir, `${id}.json`),
    JSON.stringify({ content }),
    { flag: "wx" },
  );
  return { id, hash: contentHash(content) };
}

export async function readSubmission(id: string): Promise<{ content: string }> {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid submission ID");
  return JSON.parse(
    await readFile(resolve(submissionDir, `${id}.json`), "utf8"),
  );
}

export async function saveReason(
  bountyId: bigint,
  reason: string,
  score: number,
  pass: boolean,
) {
  await mkdir(reasonDir, { recursive: true });
  await writeFile(
    resolve(reasonDir, `${bountyId}.json`),
    JSON.stringify({ reason, score, pass, hash: contentHash(reason) }),
  );
}

export async function readReason(
  id: string,
): Promise<{ reason: string; score: number; pass: boolean; hash: string }> {
  if (!/^\d+$/.test(id)) throw new Error("Invalid bounty ID");
  return JSON.parse(await readFile(resolve(reasonDir, `${id}.json`), "utf8"));
}
