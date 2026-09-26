"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";
import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  keccak256,
  parseUnits,
  stringToHex,
  type Abi,
} from "viem";
import escrowJson from "../abi/BountyEscrow.abi.json";
import tokenJson from "../abi/MockUSDT.abi.json";
import { hsk } from "./providers";

const escrowAbi = escrowJson as Abi;
const tokenAbi = tokenJson as Abi;
const escrowAddress = process.env.NEXT_PUBLIC_ESCROW_ADDRESS as
  `0x${string}` | undefined;
const tokenAddress = process.env.NEXT_PUBLIC_TOKEN_ADDRESS as
  `0x${string}` | undefined;
const serviceUrl =
  process.env.NEXT_PUBLIC_SERVICE_URL || "/api";
const explorer = hsk.blockExplorers.default.url;
const publicClient = createPublicClient({
  chain: hsk,
  transport: http(hsk.rpcUrls.default.http[0]),
});
const labels = [
  "Open",
  "Taken",
  "Submitted",
  "Approved",
  "Disputed",
  "Paid",
  "Refunded",
];
const zeroHash = `0x${"0".repeat(64)}`;

type Bounty = {
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
type Entry = { id: bigint; bounty: Bounty };
type Reason = { reason: string; score: number; pass: boolean; hash: string };

function short(address?: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "—";
}
function errorText(error: unknown) {
  return error instanceof Error
    ? "shortMessage" in error
      ? String(error.shortMessage)
      : error.message
    : String(error);
}

function submissionHref(uri: string) {
  try {
    const url = new URL(uri);
    if (
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      /^\/submissions\/[0-9a-f-]+$/.test(url.pathname)
    ) {
      return `${serviceUrl}${url.pathname}`;
    }
  } catch {
    // Preserve other URI formats as recorded onchain.
  }
  return uri;
}

export default function Home() {
  const { address, chainId, isConnected } = useAccount();
  const { data: wallet } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<bigint | null>(null);
  const [amount, setAmount] = useState("100");
  const [criteria, setCriteria] = useState(
    "Summarize the article in one paragraph. Mention X and Y.",
  );
  const [minutes, setMinutes] = useState("30");
  const [submission, setSubmission] = useState("");
  const [reason, setReason] = useState<Reason | null>(null);
  const [reasonVerified, setReasonVerified] = useState(false);
  const [balance, setBalance] = useState<bigint>(0n);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const configured =
    !!escrowAddress &&
    !!tokenAddress &&
    /^0x[0-9a-fA-F]{40}$/.test(escrowAddress) &&
    /^0x[0-9a-fA-F]{40}$/.test(tokenAddress);

  const refresh = useCallback(async () => {
    if (!configured) return;
    try {
      const count = (await publicClient.readContract({
        address: escrowAddress!,
        abi: escrowAbi,
        functionName: "bountyCount",
      })) as bigint;
      const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i));
      const result = await Promise.all(
        ids.map(async (id) => ({
          id,
          bounty: (await publicClient.readContract({
            address: escrowAddress!,
            abi: escrowAbi,
            functionName: "getBounty",
            args: [id],
          })) as Bounty,
        })),
      );
      setEntries(result.reverse());
      if (selected === null && result.length) setSelected(result[0].id);
      if (address)
        setBalance(
          (await publicClient.readContract({
            address: tokenAddress!,
            abi: tokenAbi,
            functionName: "balanceOf",
            args: [address],
          })) as bigint,
        );
    } catch (error) {
      setNotice(`Chain read failed: ${errorText(error)}`);
    }
  }, [address, configured, selected]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
      setNow(Math.floor(Date.now() / 1000));
    }, 4000);
    return () => clearInterval(timer);
  }, [refresh]);
  const current = useMemo(
    () => entries.find((e) => e.id === selected),
    [entries, selected],
  );
  const bounty = current?.bounty;
  const challengeEnds = bounty ? Number(bounty.approvedAt) + 60 : 0;
  const secondsLeft = Math.max(0, challengeEnds - now);
  const isPoster = !!(
    address &&
    bounty &&
    getAddress(address) === getAddress(bounty.poster)
  );
  const isWorker = !!(
    address &&
    bounty &&
    getAddress(address) === getAddress(bounty.worker)
  );

  useEffect(() => {
    setReason(null);
    setReasonVerified(false);
    if (!bounty || bounty.reasonHash === zeroHash) return;
    const hash = bounty.reasonHash;
    let active = true;
    fetch(`${serviceUrl}/reasons/${current?.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: Reason) => {
        if (active) {
          setReason(data);
          setReasonVerified(
            keccak256(stringToHex(data.reason)) === hash && data.hash === hash,
          );
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [current?.id, bounty?.reasonHash]);

  async function transact(name: string, action: () => Promise<`0x${string}`>) {
    if (!wallet || !address) {
      setNotice("Connect a wallet first.");
      return;
    }
    if (chainId !== hsk.id) {
      setNotice("Switch to HSKChain Testnet first.");
      return;
    }
    setBusy(name);
    setNotice("");
    setTxHash(null);
    try {
      const hash = await action();
      setTxHash(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Transaction reverted");
      setNotice(`${name} confirmed on HSKChain.`);
      await refresh();
    } catch (error) {
      setNotice(`${name}: ${errorText(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function create() {
    if (!wallet || !address || !configured) return;
    const value = parseUnits(amount || "0", 6);
    const deadline = BigInt(
      Math.floor(Date.now() / 1000) + Number(minutes) * 60,
    );
    if (
      value <= 0n ||
      !criteria.trim() ||
      !Number.isFinite(Number(minutes)) ||
      Number(minutes) <= 0
    ) {
      setNotice("Enter a positive amount, criteria and deadline.");
      return;
    }
    await transact("Create bounty", async () => {
      const allowance = (await publicClient.readContract({
        address: tokenAddress!,
        abi: tokenAbi,
        functionName: "allowance",
        args: [address, escrowAddress!],
      })) as bigint;
      if (allowance < value) {
        setBusy("Approve token");
        const approval = await wallet.writeContract({
          address: tokenAddress!,
          abi: tokenAbi,
          functionName: "approve",
          args: [escrowAddress!, value],
          chain: hsk,
          account: address,
        });
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: approval,
        });
        if (receipt.status !== "success")
          throw new Error("Token approval reverted");
      }
      setBusy("Create bounty");
      return wallet.writeContract({
        address: escrowAddress!,
        abi: escrowAbi,
        functionName: "createBounty",
        args: [value, criteria.trim(), deadline],
        gas: 700_000n,
        chain: hsk,
        account: address,
      });
    });
  }

  async function submit() {
    if (!wallet || !address || selected === null || !submission.trim()) {
      setNotice("Write a submission first.");
      return;
    }
    await transact("Submit work", async () => {
      const response = await fetch(`${serviceUrl}/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: submission }),
      });
      if (!response.ok)
        throw new Error(`Submission store returned HTTP ${response.status}`);
      const stored = (await response.json()) as {
        uri: string;
        contentHash: `0x${string}`;
      };
      if (stored.contentHash !== keccak256(stringToHex(submission)))
        throw new Error("Stored content hash differs");
      return wallet.writeContract({
        address: escrowAddress!,
        abi: escrowAbi,
        functionName: "submit",
        args: [selected, stored.uri, stored.contentHash],
        chain: hsk,
        account: address,
      });
    });
  }

  function action(name: string, functionName: string, args: unknown[]) {
    if (!wallet || !address) return;
    void transact(name, () =>
      wallet.writeContract({
        address: escrowAddress!,
        abi: escrowAbi,
        functionName,
        args,
        chain: hsk,
        account: address,
      }),
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#top">
          <span className="brand-mark">P</span>
          <span>PROOFPAY</span>
          <small>AI BOUNTY ESCROW</small>
        </a>
        <div className="top-right">
          <span className="network">
            <i /> HSKChain Testnet
          </span>
          <ConnectButton showBalance={false} chainStatus="none" />
        </div>
      </header>
      <div id="top" className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="spark">✳</span> AUTONOMOUS WORK. GUARANTEED
            PAYMENT.
          </div>
          <h1>
            Work gets verified.
            <br />
            <em>Payment gets released.</em>
          </h1>
          <p>
            Post a bounty with clear acceptance criteria. An AI agent can do the
            work. An AI reviewer checks it. The reward stays locked on chain
            until the challenge window closes.
          </p>
          <div className="hero-pills">
            <span>◈ On-chain escrow</span>
            <span>✦ AI verification</span>
            <span>◷ 60s challenge window</span>
          </div>
        </div>
        <div className="hero-card">
          <div className="flow-title">HOW A BOUNTY MOVES</div>
          <div className="flow-line">
            <span>01</span>
            <strong>Fund</strong>
            <small>Lock demo USDT in escrow</small>
          </div>
          <div className="flow-line">
            <span>02</span>
            <strong>Deliver</strong>
            <small>Human or agent submits proof</small>
          </div>
          <div className="flow-line">
            <span>03</span>
            <strong>Verify</strong>
            <small>AI scores against your criteria</small>
          </div>
          <div className="flow-line">
            <span>04</span>
            <strong>Release</strong>
            <small>Anyone calls claim after 60s</small>
          </div>
        </div>
      </div>
      {!configured && (
        <div className="alert">
          Deployment needed: set NEXT_PUBLIC_TOKEN_ADDRESS and
          NEXT_PUBLIC_ESCROW_ADDRESS in the root .env, then restart the web
          server.
        </div>
      )}
      {isConnected && chainId !== hsk.id && (
        <div className="alert">
          Your wallet is on another chain.{" "}
          <button onClick={() => void switchChainAsync({ chainId: hsk.id })}>
            Switch to HSKChain Testnet
          </button>
        </div>
      )}
      <section className="workspace">
        <div className="workspace-head">
          <div>
            <div className="section-kicker">THE WORKSPACE</div>
            <h2>Build trust into every task.</h2>
          </div>
          <div className="wallet-balance">
            <small>YOUR DEMO BALANCE</small>
            <strong>
              {formatUnits(balance, 6)} <span>mUSDT</span>
            </strong>
            <button
              disabled={!configured || !wallet || !!busy}
              onClick={() =>
                void transact("Mint demo tokens", () =>
                  wallet!.writeContract({
                    address: tokenAddress!,
                    abi: tokenAbi,
                    functionName: "mint",
                    args: [address!, 1000n * 10n ** 6n],
                    chain: hsk,
                    account: address!,
                  }),
                )
              }
            >
              + Get 1,000 demo USDT
            </button>
          </div>
        </div>
        <div className="panels">
          <div className="panel create-panel">
            <div className="panel-heading">
              <span className="panel-icon">＋</span>
              <div>
                <div className="panel-eyebrow">NEW BOUNTY</div>
                <h3>Post a task</h3>
              </div>
            </div>
            <label>
              Reward <span>mUSDT · demo token</span>
              <input
                type="number"
                min="0.000001"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label>
              Acceptance criteria <span>Be specific about what passes</span>
              <textarea
                rows={5}
                maxLength={2048}
                value={criteria}
                onChange={(e) => setCriteria(e.target.value)}
              />
            </label>
            <label>
              Deadline <span>Minutes from now</span>
              <input
                type="number"
                min="1"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
              />
            </label>
            <button
              className="primary"
              disabled={!configured || !wallet || !!busy}
              onClick={() => void create()}
            >
              {busy === "Create bounty" || busy === "Approve token"
                ? "Confirm in wallet…"
                : "Lock funds & create bounty"}
              <span>↗</span>
            </button>
            <p className="fineprint">
              Your wallet approves an exact amount, then locks it in the escrow
              contract.
            </p>
          </div>
          <div className="panel list-panel">
            <div className="panel-heading">
              <span className="panel-icon dark">▦</span>
              <div>
                <div className="panel-eyebrow">LIVE ON HSKCHAIN</div>
                <h3>
                  Bounties <span className="count">{entries.length}</span>
                </h3>
              </div>
              <button
                className="refresh"
                onClick={() => void refresh()}
                aria-label="Refresh bounties"
              >
                ↻
              </button>
            </div>
            {entries.length ? (
              <div className="bounty-list">
                {entries.map(({ id, bounty: item }) => (
                  <button
                    key={String(id)}
                    className={`bounty-item ${selected === id ? "selected" : ""}`}
                    onClick={() => setSelected(id)}
                  >
                    <div>
                      <span className="item-id">
                        #{String(id).padStart(3, "0")}
                      </span>
                      <span className={`status status-${item.status}`}>
                        {labels[item.status]}
                      </span>
                    </div>
                    <strong>{item.criteria}</strong>
                    <div className="item-bottom">
                      <span>{short(item.poster)}</span>
                      <b>{formatUnits(item.amount, 6)} mUSDT</b>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty">
                <div>◌</div>
                <strong>No bounties yet</strong>
                <p>Fund the first task to start the flow.</p>
              </div>
            )}
          </div>
        </div>
      </section>
      {current && bounty && (
        <section className="detail">
          <div className="detail-head">
            <div>
              <div className="section-kicker">
                BOUNTY #{String(current.id).padStart(3, "0")}
              </div>
              <h2>Task details</h2>
            </div>
            <span className={`status large status-${bounty.status}`}>
              {labels[bounty.status]}
            </span>
          </div>
          <div className="timeline">
            {["Open", "Taken", "Submitted", "Approved", "Paid"].map(
              (step, index) => (
                <div
                  key={step}
                  className={
                    bounty.status === 4
                      ? index < 4
                        ? "active"
                        : ""
                      : bounty.status === 6
                        ? ""
                        : bounty.status >= index
                          ? "active"
                          : ""
                  }
                >
                  <span>{index + 1}</span>
                  <small>{step}</small>
                </div>
              ),
            )}
          </div>
          <div className="detail-grid">
            <div>
              <h4>Acceptance criteria</h4>
              <p className="criteria-text">{bounty.criteria}</p>
              <div className="meta">
                <span>
                  POSTER <strong>{short(bounty.poster)}</strong>
                </span>
                <span>
                  WORKER <strong>{short(bounty.worker)}</strong>
                </span>
                <span>
                  DEADLINE{" "}
                  <strong>
                    {new Date(Number(bounty.deadline) * 1000).toLocaleString()}
                  </strong>
                </span>
              </div>
              {bounty.submissionURI && (
                <div className="evidence">
                  <h4>Submission</h4>
                  <a
                    href={submissionHref(bounty.submissionURI)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open submitted work ↗
                  </a>
                  <small>Content hash: {short(bounty.submissionHash)}</small>
                </div>
              )}
              {reason && (
                <div className="verdict">
                  <div>
                    <span>AI REVIEW</span>
                    <strong>{reason.score}/100</strong>
                  </div>
                  <p>{reason.reason}</p>
                  <small>
                    {reasonVerified
                      ? "✓ Reason matches on-chain hash"
                      : "⚠ Reason hash does not match chain"}
                  </small>
                </div>
              )}
            </div>
            <div className="action-box">
              <h4>Next action</h4>
              {bounty.status === 3 && (
                <div className="countdown">
                  <small>CHALLENGE WINDOW</small>
                  <strong>
                    {secondsLeft > 0
                      ? `00:${String(secondsLeft).padStart(2, "0")}`
                      : "Ready to claim"}
                  </strong>
                  <p>
                    {secondsLeft > 0
                      ? "The poster may dispute before this timer ends."
                      : "Anyone can release the escrowed reward to the worker."}
                  </p>
                </div>
              )}
              {bounty.status === 0 && (
                <button
                  className="primary"
                  disabled={
                    !wallet ||
                    !!busy ||
                    isPoster ||
                    now >= Number(bounty.deadline)
                  }
                  onClick={() =>
                    action("Accept bounty", "accept", [current.id])
                  }
                >
                  Accept this bounty ↗
                </button>
              )}
              {bounty.status === 1 && isWorker && (
                <>
                  <textarea
                    rows={5}
                    placeholder="Paste your completed work here…"
                    value={submission}
                    onChange={(e) => setSubmission(e.target.value)}
                  />
                  <button
                    className="primary"
                    disabled={
                      !wallet ||
                      !!busy ||
                      !submission.trim() ||
                      now >= Number(bounty.deadline)
                    }
                    onClick={() => void submit()}
                  >
                    Submit work ↗
                  </button>
                </>
              )}
              {bounty.status === 2 && (
                <p className="action-note">
                  Waiting for the AI verifier to review the submitted work.
                </p>
              )}
              {bounty.status === 3 && (
                <>
                  <button
                    className="primary"
                    disabled={!wallet || !!busy || secondsLeft > 0}
                    onClick={() =>
                      action("Release payment", "claim", [current.id])
                    }
                  >
                    Release payment to worker ↗
                  </button>
                  {isPoster && secondsLeft > 0 && (
                    <button
                      className="secondary"
                      disabled={!!busy}
                      onClick={() =>
                        action("Open dispute", "dispute", [current.id])
                      }
                    >
                      Dispute AI verdict
                    </button>
                  )}
                </>
              )}
              {(bounty.status === 0 || bounty.status === 1) &&
                isPoster &&
                now >= Number(bounty.deadline) && (
                  <button
                    className="secondary"
                    disabled={!!busy}
                    onClick={() => action("Refund", "refund", [current.id])}
                  >
                    Refund expired bounty
                  </button>
                )}
              {bounty.status === 4 && (
                <p className="action-note">
                  Disputed. The configured arbiter must resolve this on chain.
                </p>
              )}
              {(bounty.status === 5 || bounty.status === 6) && (
                <p className="action-note">
                  This bounty is closed. The chain records the final transfer.
                </p>
              )}
              <div className="contract-link">
                <span>ESCROW CONTRACT</span>
                <a
                  href={`${explorer}/address/${escrowAddress}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {short(escrowAddress)} ↗
                </a>
              </div>
            </div>
          </div>
        </section>
      )}
      {(notice || txHash) && (
        <div className="toast" role="status">
          {notice}
          {txHash && (
            <a
              href={`${explorer}/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
            >
              View transaction ↗
            </a>
          )}
        </div>
      )}
      <footer>
        <span>
          PROOFPAY <small>· HACKATHON DEMO</small>
        </span>
        <p>
          Demo token has no value. AI judgments are reviewable and may be
          disputed.
        </p>
        <a href={explorer} target="_blank" rel="noreferrer">
          HSKChain Explorer ↗
        </a>
      </footer>
    </main>
  );
}
