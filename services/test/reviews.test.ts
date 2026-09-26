import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("manual approval is tied to one submission and closes after five minutes", async () => {
  const original = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), "proofpay-reviews-"));
  process.chdir(directory);
  try {
    const { savePendingReview, readPendingReview, approvePendingReview, humanReviewWindowMs } = await import("../src/reviews.js");
    const hash = `0x${"a".repeat(64)}`;
    const firstUri = "http://localhost:8787/submissions/first";
    const secondUri = "http://localhost:8787/submissions/second";
    await savePendingReview(1n, hash, firstUri, 10, "Missing evidence");
    await assert.rejects(approvePendingReview("1", hash, secondUri, "I accept the work"), /No current AI review/);
    await approvePendingReview("1", hash, firstUri, "I accept the work");
    assert.equal((await readPendingReview(1n))?.humanApproval?.reason, "I accept the work");

    await savePendingReview(1n, hash, secondUri, 15, "Still missing evidence");
    assert.equal((await readPendingReview(1n))?.humanApproval, undefined);
    const path = join(directory, "data", "reviews", "1.json");
    const review = JSON.parse(await readFile(path, "utf8")) as { createdAt: number };
    review.createdAt = Date.now() - humanReviewWindowMs - 1;
    await writeFile(path, JSON.stringify(review));
    await assert.rejects(approvePendingReview("1", hash, secondUri, "I accept the work"), /window has closed/);
  } finally {
    process.chdir(original);
    await rm(directory, { recursive: true, force: true });
  }
});
