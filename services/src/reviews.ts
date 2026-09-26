import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

const reviewDir = resolve(process.env.DEMO_DATA_DIR || resolve(process.cwd(), "data"), "reviews");
export const humanReviewWindowMs = 5 * 60_000;

export type PendingReview = {
  submissionHash: string;
  submissionURI: string;
  aiPass: false;
  score: number;
  reason: string;
  createdAt: number;
  humanApproval?: { reason: string; recordedAt: number };
};

function pathFor(id: bigint | string) {
  if (!/^\d+$/.test(String(id))) throw new Error("Invalid bounty ID");
  return resolve(reviewDir, `${id}.json`);
}

export async function readPendingReview(id: bigint | string): Promise<PendingReview | null> {
  try {
    const value = JSON.parse(await readFile(pathFor(id), "utf8")) as PendingReview;
    if (!/^0x[0-9a-fA-F]{64}$/.test(value.submissionHash) || typeof value.submissionURI !== "string" || value.aiPass !== false ||
      !Number.isInteger(value.score) || typeof value.reason !== "string" ||
      !Number.isFinite(value.createdAt)) throw new Error("Invalid pending review");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writePendingReview(id: bigint | string, review: PendingReview) {
  await mkdir(reviewDir, { recursive: true });
  const target = pathFor(id);
  const temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(review), { flag: "wx", mode: 0o600 });
  await rename(temp, target);
}

export async function savePendingReview(id: bigint, submissionHash: string, submissionURI: string, score: number, reason: string) {
  const existing = await readPendingReview(id);
  if (existing?.submissionURI === submissionURI && existing.submissionHash.toLowerCase() === submissionHash.toLowerCase()) return existing;
  const review: PendingReview = { submissionHash, submissionURI, aiPass: false, score, reason, createdAt: Date.now() };
  await writePendingReview(id, review);
  return review;
}

export async function approvePendingReview(id: string, submissionHash: string, submissionURI: string, reason: string) {
  if (reason.trim().length < 5 || reason.length > 500) throw new Error("Decision reason must be 5–500 characters");
  const review = await readPendingReview(id);
  if (!review || review.submissionHash.toLowerCase() !== submissionHash.toLowerCase() || review.submissionURI !== submissionURI)
    throw new Error("No current AI review for this submission");
  if (Date.now() >= review.createdAt + humanReviewWindowMs)
    throw new Error("Human review window has closed");
  if (review.humanApproval) return review;
  review.humanApproval = { reason: reason.trim(), recordedAt: Date.now() };
  await writePendingReview(id, review);
  return review;
}
