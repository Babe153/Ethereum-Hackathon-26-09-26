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
import escrowJson from "../../abi/BountyEscrow.abi.json";
import tokenJson from "../../abi/MockUSDT.abi.json";
import { hsk } from "../providers";
import { copy, type PageLocale } from "../copy";

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

export default function Home({ locale = "en" }: { locale?: PageLocale }) {
  const t = copy[locale];
  const { address, chainId, isConnected } = useAccount();
  const { data: wallet } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<bigint | null>(null);
  const [amount, setAmount] = useState("100");
  const [criteria, setCriteria] = useState<string>(t.defaultCriteria);
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

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

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
      setNotice(`${t.chainReadFailed}: ${errorText(error)}`);
    }
  }, [address, configured, selected, t.chainReadFailed]);

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
      setNotice(t.connectFirst);
      return;
    }
    if (chainId !== hsk.id) {
      setNotice(t.switchFirst);
      return;
    }
    setBusy(name);
    setNotice("");
    setTxHash(null);
    try {
      const hash = await action();
      setTxHash(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(t.reverted);
      setNotice(`${name}${locale === "zh" ? "" : " "}${t.confirmed}`);
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
      setNotice(t.invalidBounty);
      return;
    }
    await transact(t.createAction, async () => {
      const allowance = (await publicClient.readContract({
        address: tokenAddress!,
        abi: tokenAbi,
        functionName: "allowance",
        args: [address, escrowAddress!],
      })) as bigint;
      if (allowance < value) {
        setBusy(t.approveAction);
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
          throw new Error(t.approvalReverted);
      }
      setBusy(t.createAction);
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
      setNotice(t.writeSubmission);
      return;
    }
    await transact(t.submitAction, async () => {
      const response = await fetch(`${serviceUrl}/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: submission }),
      });
      if (!response.ok)
        throw new Error(`${t.storeFailed} ${response.status}`);
      const stored = (await response.json()) as {
        uri: string;
        contentHash: `0x${string}`;
      };
      if (stored.contentHash !== keccak256(stringToHex(submission)))
        throw new Error(t.hashDiffers);
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
          <small>{t.brandTag}</small>
        </a>
        <div className="top-right">
          <a className="language-switch" href={locale === "zh" ? "/" : "/zh"} lang={locale === "zh" ? "en" : "zh-CN"}>
            {t.switchLanguage}
          </a>
          <span className="network">
            <i /> {t.network}
          </span>
          <ConnectButton showBalance={false} chainStatus="none" />
        </div>
      </header>
      <div id="top" className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="spark">✳</span> {t.eyebrow}
          </div>
          <h1>
            {t.heroLine1}
            <br />
            <em>{t.heroLine2}</em>
          </h1>
          <p>{t.heroDescription}</p>
          <div className="hero-pills">
            {t.heroPills.map((pill) => <span key={pill}>{pill}</span>)}
          </div>
        </div>
        <div className="hero-card">
          <div className="flow-title">{t.flowTitle}</div>
          {t.flow.map(([name, detail], index) => (
            <div className="flow-line" key={name}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{name}</strong>
              <small>{detail}</small>
            </div>
          ))}
        </div>
      </div>
      {!configured && (
        <div className="alert">
          {t.deploymentNeeded}
        </div>
      )}
      {isConnected && chainId !== hsk.id && (
        <div className="alert">
          {t.wrongChain}{" "}
          <button onClick={() => void switchChainAsync({ chainId: hsk.id })}>
            {t.switchChain}
          </button>
        </div>
      )}
      <section className="workspace">
        <div className="workspace-head">
          <div>
            <div className="section-kicker">{t.workspaceKicker}</div>
            <h2>{t.workspaceTitle}</h2>
          </div>
          <div className="wallet-balance">
            <small>{t.balance}</small>
            <strong>
              {formatUnits(balance, 6)} <span>mUSDT</span>
            </strong>
            <button
              disabled={!configured || !wallet || !!busy}
              onClick={() =>
                void transact(t.mintAction, () =>
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
              {t.mintButton}
            </button>
          </div>
        </div>
        <div className="panels">
          <div className="panel create-panel">
            <div className="panel-heading">
              <span className="panel-icon">＋</span>
              <div>
                <div className="panel-eyebrow">{t.newBounty}</div>
                <h3>{t.postTask}</h3>
              </div>
            </div>
            <label>
              {t.reward} <span>{t.rewardHint}</span>
              <input
                type="number"
                min="0.000001"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label>
              {t.criteria} <span>{t.criteriaHint}</span>
              <textarea
                rows={5}
                maxLength={2048}
                value={criteria}
                onChange={(e) => setCriteria(e.target.value)}
              />
            </label>
            <label>
              {t.deadline} <span>{t.deadlineHint}</span>
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
              {busy === t.createAction || busy === t.approveAction
                ? t.confirmWallet
                : t.lockFunds}
              <span>↗</span>
            </button>
            <p className="fineprint">
              {t.createNote}
            </p>
          </div>
          <div className="panel list-panel">
            <div className="panel-heading">
              <span className="panel-icon dark">▦</span>
              <div>
                <div className="panel-eyebrow">{t.live}</div>
                <h3>
                  {t.bounties} <span className="count">{entries.length}</span>
                </h3>
              </div>
              <button
                className="refresh"
                onClick={() => void refresh()}
                aria-label={t.refresh}
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
                        {t.status[item.status]}
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
                <strong>{t.noBounties}</strong>
                <p>{t.firstTask}</p>
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
                {t.bounty} #{String(current.id).padStart(3, "0")}
              </div>
              <h2>{t.taskDetails}</h2>
            </div>
            <span className={`status large status-${bounty.status}`}>
              {t.status[bounty.status]}
            </span>
          </div>
          <div className="timeline">
            {t.steps.map(
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
              <h4>{t.criteria}</h4>
              <p className="criteria-text">{bounty.criteria}</p>
              {t.originalContentNote && <p className="original-content-note">{t.originalContentNote}</p>}
              <div className="meta">
                <span>
                  {t.poster} <strong>{short(bounty.poster)}</strong>
                </span>
                <span>
                  {t.worker} <strong>{short(bounty.worker)}</strong>
                </span>
                <span>
                  {t.deadline} · {t.sydneyTime}{" "}
                  <strong>
                    {new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-AU", {
                      timeZone: "Australia/Sydney",
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    }).format(new Date(Number(bounty.deadline) * 1000))}
                  </strong>
                </span>
              </div>
              {bounty.submissionURI && (
                <div className="evidence">
                  <h4>{t.submission}</h4>
                  <a
                    href={submissionHref(bounty.submissionURI)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t.openWork}
                  </a>
                  <small>{t.contentHash}: {short(bounty.submissionHash)}</small>
                </div>
              )}
              {reason && (
                <div className="verdict">
                  <div>
                    <span>{t.aiReview}</span>
                    <strong>{reason.score}/100</strong>
                  </div>
                  <p>{reason.reason}</p>
                  <small>
                    {reasonVerified
                      ? t.reasonVerified
                      : t.reasonMismatch}
                  </small>
                </div>
              )}
            </div>
            <div className="action-box">
              <h4>{t.nextAction}</h4>
              {bounty.status === 3 && (
                <div className="countdown">
                  <small>{t.challengeWindow}</small>
                  <strong>
                    {secondsLeft > 0
                      ? `00:${String(secondsLeft).padStart(2, "0")}`
                      : t.readyToClaim}
                  </strong>
                  <p>
                    {secondsLeft > 0
                      ? t.disputeBefore
                      : t.anyoneRelease}
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
                    action(t.acceptAction, "accept", [current.id])
                  }
                >
                  {t.acceptButton}
                </button>
              )}
              {bounty.status === 1 && isWorker && (
                <>
                  <textarea
                    rows={5}
                    placeholder={t.submissionPlaceholder}
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
                    {t.submitButton}
                  </button>
                </>
              )}
              {bounty.status === 2 && (
                <p className="action-note">
                  {t.waitingVerifier}
                </p>
              )}
              {bounty.status === 3 && (
                <>
                  <button
                    className="primary"
                    disabled={!wallet || !!busy || secondsLeft > 0}
                    onClick={() =>
                      action(t.releaseAction, "claim", [current.id])
                    }
                  >
                    {t.releaseButton}
                  </button>
                  {isPoster && secondsLeft > 0 && (
                    <button
                      className="secondary"
                      disabled={!!busy}
                      onClick={() =>
                        action(t.disputeAction, "dispute", [current.id])
                      }
                    >
                      {t.disputeButton}
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
                    onClick={() => action(t.refundAction, "refund", [current.id])}
                  >
                    {t.refundButton}
                  </button>
                )}
              {bounty.status === 4 && (
                <p className="action-note">
                  {t.disputedNote}
                </p>
              )}
              {(bounty.status === 5 || bounty.status === 6) && (
                <p className="action-note">
                  {t.closedNote}
                </p>
              )}
              <div className="contract-link">
                <span>{t.escrowContract}</span>
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
              {t.viewTransaction}
            </a>
          )}
        </div>
      )}
      <footer>
        <span>
          PROOFPAY <small>{t.demoTag}</small>
        </span>
        <p>{t.demoDisclaimer}</p>
        <a href={explorer} target="_blank" rel="noreferrer">
          {t.explorer}
        </a>
      </footer>
    </main>
  );
}
