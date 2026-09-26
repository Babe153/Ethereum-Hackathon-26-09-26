"use client";
import { BrandMark, ProofIllustration } from "./brand";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  useAccount,
  useSignMessage,
  useSwitchChain,
  useWalletClient,
} from "wagmi";
import {
  createPublicClient,
  fallback,
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
import agentMode from "../agent-mode.json";
import { hsk } from "./providers";
import { copy, type PageLocale } from "./copy";
import ServiceHealth from "@/app/service-health";

const escrowAbi = escrowJson as Abi;
const tokenAbi = tokenJson as Abi;
const escrowAddress = process.env.NEXT_PUBLIC_ESCROW_ADDRESS as
  `0x${string}` | undefined;
const tokenAddress = process.env.NEXT_PUBLIC_TOKEN_ADDRESS as
  `0x${string}` | undefined;
const serviceUrl = process.env.NEXT_PUBLIC_SERVICE_URL || "/api";
const explorer = hsk.blockExplorers.default.url;
const readRpcUrl =
  process.env.NEXT_PUBLIC_READ_RPC_URL ||
  "https://testnet-explorer.hskchain.net/api/eth-rpc";
const publicClient = createPublicClient({
  chain: hsk,
  transport: fallback([http(readRpcUrl), http(hsk.rpcUrls.default.http[0])]),
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
type Reason = { reason: string; score: number; pass: boolean; hash: string; source?: "ai" | "poster" };
type PendingReview = { aiPass: false; score: number; reason: string; submissionHash: string; submissionURI: string; expiresAt: number; humanApprovalPending: boolean };
type PublishReview = { typedAmount: string; value: bigint; criteria: string; durationMinutes: number; poster: string };

function short(address?: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "—";
}
function cleanCriteria(criteria: string) {
  return criteria.startsWith(agentMode.prefix)
    ? criteria.slice(agentMode.prefix.length)
    : criteria;
}
function errorText(error: unknown, locale: PageLocale) {
  const message =
    error instanceof Error
      ? "shortMessage" in error
        ? String(error.shortMessage)
        : error.message
      : String(error);
  if (/HTTP request failed|rate limit|error code: 1015/i.test(message))
    return copy[locale].requestFailed;
  return message;
}

function submissionHref(uri: string, bountyId: bigint) {
  try {
    const url = new URL(uri);
    if (
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      /^\/submissions\/[0-9a-f-]+$/.test(url.pathname)
    ) {
      return `${serviceUrl}${url.pathname}?bountyId=${bountyId}`;
    }
  } catch {
    // Only submissions stored by this service can be served privately.
  }
  return null;
}

type View = "market" | "post" | "detail" | "profile";

export default function BountyApp({
  locale = "en",
  view = "market",
  taskId,
}: {
  locale?: PageLocale;
  view?: View;
  taskId?: string;
}) {
  const t = copy[locale];
  const router = useRouter();
  const root = locale === "zh" ? "/zh" : "/";
  const postHref = locale === "zh" ? "/zh/post" : "/post";
  const taskHref = (id: bigint) =>
    `${locale === "zh" ? "/zh" : ""}/tasks/${id}`;
  const { address, chainId, isConnected } = useAccount();
  const { data: wallet } = useWalletClient();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const [filter, setFilter] = useState(view === "profile" ? "posted" : "all");
  const [entries, setEntries] = useState<Entry[]>([]);
  const hiddenKey = address && escrowAddress
    ? `proofpay:hidden:${hsk.id}:${escrowAddress.toLowerCase()}:${address.toLowerCase()}`
    : null;
  const [hiddenState, setHiddenState] = useState<{ key: string | null; ids: string[] }>({ key: null, ids: [] });
  const hiddenIds = hiddenState.key === hiddenKey ? hiddenState.ids : [];
  useEffect(() => {
    const readHidden = () => {
      let ids: string[] = [];
      try {
        const saved: unknown = hiddenKey ? JSON.parse(localStorage.getItem(hiddenKey) ?? "[]") : [];
        if (Array.isArray(saved)) ids = saved.filter((id): id is string => typeof id === "string" && /^\d+$/.test(id));
      } catch { /* Invalid or unavailable storage starts with an empty list. */ }
      setHiddenState({ key: hiddenKey, ids });
    };
    readHidden();
    const onStorage = (event: StorageEvent) => { if (event.key === hiddenKey || event.key === null) readHidden(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [hiddenKey]);

  function setTaskHidden(id: bigint, hide: boolean) {
    const entry = entries.find(entry => entry.id === id);
    if (!hiddenKey || !address || entry?.bounty.poster.toLowerCase() !== address.toLowerCase()) return;
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(hiddenKey) ?? "[]");
      const ids = Array.isArray(saved) ? saved.filter((value): value is string => typeof value === "string" && /^\d+$/.test(value)) : [];
      const next = hide ? [...new Set([...ids, String(id)])] : ids.filter(value => value !== String(id));
      localStorage.setItem(hiddenKey, JSON.stringify(next));
      setHiddenState({ key: hiddenKey, ids: next });
      setNotice(locale === "zh" ? (hide ? "已从你的个人中心和任务广场隐藏，可在“已隐藏”中恢复。" : "任务已恢复显示。") : (hide ? "Hidden from your profile and marketplace. Restore it from Hidden." : "Task restored."));
    } catch {
      setNotice(locale === "zh" ? "浏览器无法保存隐藏记录，请检查本地存储设置。" : "Unable to save this preference. Check your browser storage settings.");
    }
  }

  const selected = taskId && /^\d{1,20}$/.test(taskId) ? BigInt(taskId) : null;
  const [amount, setAmount] = useState("100");
  const amountInputRef = useRef<HTMLInputElement>(null);
  const [publishReview, setPublishReview] = useState<PublishReview | null>(null);
  const [criteria, setCriteria] = useState<string>("");
  const [autoAgent, setAutoAgent] = useState(false);
  const [minutes, setMinutes] = useState("30");
  const [submission, setSubmission] = useState("");
  const [uploadedFile, setUploadedFile] = useState("");
  const [reason, setReason] = useState<Reason | null>(null);
  const [reasonVerified, setReasonVerified] = useState(false);
  const [pendingReview, setPendingReview] = useState<PendingReview | null>(null);
  const [manualReason, setManualReason] = useState("");
  const [authAddress, setAuthAddress] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [arbiterAddress, setArbiterAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint>(0n);
  const [balanceAddress, setBalanceAddress] = useState<string | null>(null);
  const [chainError, setChainError] = useState(false);
  const [chainLoaded, setChainLoaded] = useState(false);
  const previousEntries = useRef<Entry[]>([]);
  const previousWallet = useRef<string | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [verificationEnds, setVerificationEnds] = useState<{
    id: bigint;
    at: number;
  } | null>(null);
  const configured =
    !!escrowAddress &&
    !!tokenAddress &&
    /^0x[0-9a-fA-F]{40}$/.test(escrowAddress) &&
    /^0x[0-9a-fA-F]{40}$/.test(tokenAddress);
  const rewardAmount = useMemo(() => {
    try {
      return parseUnits(amount || "0", 6);
    } catch {
      return 0n;
    }
  }, [amount]);
  const balanceLoaded = !!address && balanceAddress === address.toLowerCase();

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  useEffect(() => {
    if (!configured) return;
    let active = true;
    void publicClient.readContract({ address: escrowAddress!, abi: escrowAbi, functionName: "arbiter" })
      .then(value => { if (active && typeof value === "string") setArbiterAddress(value.toLowerCase()); })
      .catch(() => {});
    return () => { active = false; };
  }, [configured]);

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
        ids.map(async (id) => {
          const known = previousEntries.current.find(
            (entry) => entry.id === id,
          );
          if (known && (known.bounty.status === 5 || known.bounty.status === 6))
            return known;
          return {
            id,
            bounty: (await publicClient.readContract({
              address: escrowAddress!,
              abi: escrowAbi,
              functionName: "getBounty",
              args: [id],
            })) as Bounty,
          };
        }),
      );
      previousEntries.current = result;
      setEntries(result.reverse());
      if (address) {
        setBalance(
          (await publicClient.readContract({
            address: tokenAddress!,
            abi: tokenAbi,
            functionName: "balanceOf",
            args: [address],
          })) as bigint,
        );
        setBalanceAddress(address.toLowerCase());
      }
      setChainError(false);
      setChainLoaded(true);
    } catch (error) {
      console.error("Chain refresh failed", error);
      setChainError(true);
    }
  }, [address, configured]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 20000);
    return () => clearInterval(timer);
  }, [refresh]);

  // Display time must tick independently of the slower RPC polling loop.
  // Recompute from wall time so background throttling cannot accumulate drift.
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const timer = setInterval(tick, 1000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  const current = useMemo(
    () => entries.find((e) => e.id === selected),
    [entries, selected],
  );
  const bounty = current?.bounty;
  useEffect(() => {
    let active = true;
    setVerificationEnds(null);
    if (!escrowAddress || current?.id === undefined || bounty?.status !== 2)
      return;
    const id = current.id;
    void Promise.all([
      publicClient.readContract({
        address: escrowAddress,
        abi: escrowAbi,
        functionName: "submittedAt",
        args: [id],
      }),
      publicClient.readContract({
        address: escrowAddress,
        abi: escrowAbi,
        functionName: "verificationTimeout",
      }),
    ])
      .then(([at, timeout]) => {
        if (active && Number(at) > 0)
          setVerificationEnds({ id, at: Number(at) + Number(timeout) });
      })
      .catch(() => {
        /* Older contracts do not have timeout recovery. Never expose an unsupported action. */
      });
    return () => {
      active = false;
    };
  }, [current?.id, bounty?.status]);
  const [supportsConfirmation, setSupportsConfirmation] = useState(false);
  useEffect(() => {
    let active = true;
    if (!escrowAddress) return;
    void publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "supportsPosterConfirmation" })
      .then(value => { if (active) setSupportsConfirmation(value === true); })
      .catch(() => { if (active) setSupportsConfirmation(false); });
    return () => { active = false; };
  }, []);
  const [challengeWindow, setChallengeWindow] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    if (!escrowAddress) return;
    void publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "challengeWindow" })
      .then(value => { if (active) setChallengeWindow(Number(value)); })
      .catch(() => { if (active) setChallengeWindow(null); });
    return () => { active = false; };
  }, [bounty?.status]);
  const challengeEnds = bounty && challengeWindow !== null ? Number(bounty.approvedAt) + challengeWindow : Infinity;
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
  const isDisputeArbiter = !!(address && arbiterAddress && bounty?.status === 4 && address.toLowerCase() === arbiterAddress);
  const canReadReview = isPoster || isDisputeArbiter;
  const signedIn = !!address && authAddress === address.toLowerCase();

  useEffect(() => {
    const currentWallet = address?.toLowerCase() ?? null;
    if (previousWallet.current && previousWallet.current !== currentWallet) {
      setAuthAddress(null);
      void fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    }
    previousWallet.current = currentWallet;
  }, [address]);

  useEffect(() => {
    let active = true;
    setAuthAddress(null);
    if (!address) return;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { address?: string | null }) => {
        if (active && data.address?.toLowerCase() === address.toLowerCase())
          setAuthAddress(address.toLowerCase());
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [address]);

  async function signIn() {
    if (!address) return;
    setAuthBusy(true);
    setNotice("");
    try {
      const challengeResponse = await fetch(
        `/api/auth/challenge?address=${encodeURIComponent(address)}`,
        { cache: "no-store" },
      );
      if (!challengeResponse.ok)
        throw new Error(
          locale === "zh"
            ? "无法获取钱包登录请求。"
            : "Could not start wallet sign-in.",
        );
      const { message } = (await challengeResponse.json()) as {
        message: string;
      };
      const signature = await signMessageAsync({ account: address, message });
      const verifyResponse = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, signature }),
      });
      if (!verifyResponse.ok)
        throw new Error(
          locale === "zh"
            ? "签名验证失败，请重试。"
            : "Signature verification failed. Try again.",
        );
      setAuthAddress(address.toLowerCase());
      setNotice(
        locale === "zh" ? "钱包身份已验证。" : "Wallet identity verified.",
      );
    } catch (error) {
      setNotice(errorText(error, locale));
    } finally {
      setAuthBusy(false);
    }
  }

  useEffect(() => {
    setSubmission("");
    setUploadedFile("");
    setPendingReview(null);
    setManualReason("");
    setNotice("");
    setTxHash(null);
  }, [address, selected]);

  useEffect(() => {
    setReason(null);
    setReasonVerified(false);
    if (!bounty || bounty.reasonHash === zeroHash || !canReadReview || !signedIn)
      return;
    const hash = bounty.reasonHash;
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const load = () => {
      void fetch(`${serviceUrl}/reasons/${current?.id}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((data: Reason) => {
          if (active) {
            setReason(data);
            setReasonVerified(keccak256(stringToHex(data.reason)) === hash && data.hash === hash);
          }
        })
        .catch(() => {
          if (active && ++attempts < 5) retryTimer = setTimeout(load, 2000);
        });
    };
    load();
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [current?.id, bounty?.reasonHash, canReadReview, signedIn]);

useEffect(() => {
    setPendingReview(null);
    if (!bounty || bounty.status !== 2 || !isPoster || !signedIn || current?.id === undefined) return;
    let active = true;
    const id = current.id;
    const submissionHash = bounty.submissionHash;
    const submissionURI = bounty.submissionURI;
    const check = () => {
      void fetch(`${serviceUrl}/reviews/${id}`, { cache: "no-store" })
        .then(async response => response.ok ? await response.json() as PendingReview : null)
        .then(data => { if (active) setPendingReview(data?.submissionHash.toLowerCase() === submissionHash.toLowerCase() && data?.submissionURI === submissionURI ? data : null); })
        .catch(() => { if (active) setPendingReview(null); });
    };
    check();
    const timer = setInterval(check, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [current?.id, bounty?.status, bounty?.submissionHash, bounty?.submissionURI, isPoster, signedIn]);

  async function approveAiFailure() {
    if (!current || !bounty || !pendingReview || !isPoster || !signedIn) return;
    if (manualReason.trim().length < 5) {
      setNotice(locale === "zh" ? "请用至少 5 个字符说明人工认可的依据。" : "Explain your approval in at least 5 characters.");
      return;
    }
    setBusy("human-approval");
    setNotice("");
    try {
      const response = await fetch(`${serviceUrl}/reviews/${current.id}/approve`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionHash: bounty.submissionHash, submissionURI: bounty.submissionURI, reason: manualReason.trim() }),
      });
      if (!response.ok) throw new Error(locale === "zh" ? `人工认可未提交成功（HTTP ${response.status}）。请刷新任务状态。` : `Could not submit human approval (HTTP ${response.status}). Refresh the task.`);
      setPendingReview({ ...pendingReview, humanApprovalPending: true });
      setNotice(locale === "zh" ? "人工认可已记录，验收服务会将你的决定提交上链；请等待链上状态更新。" : "Your approval is recorded. The verifier will submit it on chain; wait for the task status to update.");
    } catch (error) { setNotice(errorText(error, locale)); }
    finally { setBusy(""); }
  }

  async function transact(name: string, action: () => Promise<`0x${string}`>): Promise<boolean> {
    if (!wallet || !address) {
      setNotice(t.connectFirst);
      return false;
    }
    if (chainId !== hsk.id) {
      setNotice(t.switchFirst);
      return false;
    }
    setBusy(name);
    setNotice("");
    setTxHash(null);
    let sentTransaction = false;
    try {
      const hash = await action();
      sentTransaction = true;
      setTxHash(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(t.reverted);
      setNotice(`${name}${locale === "zh" ? "" : " "}${t.confirmed}`);
      await refresh();
      return true;
    } catch (error) {
      let detail = errorText(error, locale);
      if (name === t.releaseAction && current) {
        try {
          const latest = (await publicClient.readContract({
            address: escrowAddress!, abi: escrowAbi, functionName: "getBounty", args: [current.id],
          })) as Bounty;
          if (latest.status === 5) {
            detail = sentTransaction
              ? locale === "zh"
                ? "赏金已由另一笔交易放款。你的重复放款交易失败，但接单者已收到赏金。"
                : "Another transaction paid the bounty first. Your duplicate transaction failed; the worker has been paid."
              : locale === "zh"
                ? "赏金已放款给接单者，无需再次操作。"
                : "This bounty has already been paid to the worker. No further action is needed.";
          }
        } catch {
          // Keep the original error if the chain cannot be read right now.
        }
      }
      setNotice(`${name}: ${detail}`);
      await refresh();
      return false;
    } finally {
      setBusy("");
    }
  }

  async function create() {
    if (!wallet || !address || !configured) return;
    // Read the visible field at click time. Autofill or extensions can update
    // an input without a React change event, leaving `amount` behind the UI.
    const typedAmount = (amountInputRef.current?.value ?? amount).trim();
    let value: bigint;
    try {
      if (!/^\d+(?:\.\d{1,6})?$/.test(typedAmount)) throw new Error("Invalid decimal amount");
      value = parseUnits(typedAmount, 6);
    } catch {
      setNotice(locale === "zh" ? "赏金最多保留 6 位小数，请重新输入。" : "Enter a reward with no more than 6 decimal places.");
      return;
    }
    const onchainCriteria = `${autoAgent ? agentMode.prefix : ""}${criteria.trim()}`;
    const durationMinutes = Number(minutes);
    if (new TextEncoder().encode(onchainCriteria).length > 2048) {
      setNotice(
        locale === "zh"
          ? "验收标准超过链上 2,048 字节限制，请缩短内容。"
          : "Acceptance criteria exceed the 2,048-byte on-chain limit. Shorten the text.",
      );
      return;
    }
    if (
      value <= 0n ||
      !criteria.trim() ||
      !Number.isInteger(durationMinutes) ||
      durationMinutes < 1 ||
      durationMinutes > 43200
    ) {
      setNotice(t.invalidBounty);
      return;
    }
    const deadline = BigInt(
      Math.floor(Date.now() / 1000 + durationMinutes * 60),
    );
    if (!balanceLoaded || value > balance) {
      setNotice(t.insufficientBalance);
      return;
    }
    const review = { typedAmount, value, criteria: onchainCriteria, durationMinutes, poster: address.toLowerCase() };
    if (!publishReview ||
      publishReview.typedAmount !== review.typedAmount ||
      publishReview.value !== review.value ||
      publishReview.criteria !== review.criteria ||
      publishReview.durationMinutes !== review.durationMinutes ||
      publishReview.poster !== review.poster) {
      if (typedAmount !== amount) setAmount(typedAmount);
      setPublishReview(review);
      setNotice("");
      return;
    }
    const created = await transact(t.createAction, async () => {
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
        if (receipt.status !== "success") throw new Error(t.approvalReverted);
      }
      setBusy(t.createAction);
      return wallet.writeContract({
        address: escrowAddress!,
        abi: escrowAbi,
        functionName: "createBounty",
        args: [value, onchainCriteria, deadline],
        gas: 700_000n,
        chain: hsk,
        account: address,
      });
    });
    if (created) router.push(root);
  }

  async function readDeliverable(file: File) {
    if (!/\.(txt|md|json|csv)$/i.test(file.name) || file.size > 20_000) {
      setNotice(
        locale === "zh"
          ? "仅支持不超过 20 KB 的 .txt、.md、.json、.csv 文本文件。"
          : "Choose a .txt, .md, .json or .csv file under 20 KB.",
      );
      return;
    }
    const content = await file.text();
    if (!content.trim()) {
      setNotice(
        locale === "zh"
          ? "文件内容为空，请重新选择。"
          : "The file is empty. Choose another file.",
      );
      return;
    }
    setSubmission(content);
    setUploadedFile(file.name);
    setNotice("");
  }

  async function submit() {
    if (
      !wallet ||
      !address ||
      selected === null ||
      !submission.trim() ||
      !signedIn
    ) {
      setNotice(t.writeSubmission);
      return;
    }
    await transact(t.submitAction, async () => {
      const response = await fetch(`${serviceUrl}/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: submission,
          bountyId: String(selected),
        }),
      });
      if (!response.ok) throw new Error(`${t.storeFailed} ${response.status}`);
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

  async function releasePayment(confirmNow = false) {
    if (!wallet || !address || !current || !escrowAddress || !isPoster) return;
    if (confirmNow && (!supportsConfirmation || !window.confirm(locale === "zh"
      ? "确认交付符合要求并立即放款？此操作会结束异议期，将全部托管赏金支付给接单者，无法撤销。"
      : "Accept this delivery and pay now? This ends the challenge window and sends the full escrowed reward to the worker. It cannot be undone."))) return;
    const id = current.id;
    await transact(t.releaseAction, async () => {
      const [latest, window, block] = await Promise.all([
        publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "getBounty", args: [id] }) as Promise<Bounty>,
        publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "challengeWindow" }) as Promise<bigint>,
        publicClient.getBlock(),
      ]);
      if (latest.status !== 3) {
        throw new Error(locale === "zh"
          ? (latest.status === 5 ? "赏金已结算，无需重复付款。" : "任务状态已改变，目前不能放款。")
          : (latest.status === 5 ? "Reward already paid. No further payment is needed." : "The task status changed; payment is unavailable."));
      }
      if (!confirmNow && block.timestamp < latest.approvedAt + window) {
        throw new Error(locale === "zh" ? "链上异议期尚未结束，请稍后重试。" : "The on-chain challenge window is still open. Try again later.");
      }
      const { request } = await publicClient.simulateContract({
        address: escrowAddress, abi: escrowAbi, functionName: confirmNow ? "confirmAndPay" : "claim", args: [id], account: address,
      });
      return wallet.writeContract({ ...request, chain: hsk, account: address });
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

  const zh = locale === "zh";
  const personalEntries = entries.filter(({ bounty }) => address && (
    bounty.poster.toLowerCase() === address.toLowerCase() ||
    bounty.worker.toLowerCase() === address.toLowerCase()
  ));
  const visibleEntries = (view === "profile" ? personalEntries : entries).filter(({ id, bounty }) => {
    const hidden = hiddenIds.includes(String(id)) && bounty.poster.toLowerCase() === address?.toLowerCase();
    if (view === "profile" && filter === "hidden") return hidden;
    if ((view === "profile" || view === "market") && hidden) return false;
    if (filter === "all") return true;
    if (filter === "open") return bounty.status === 0;
    if (filter === "active") return [1, 2, 3, 4].includes(bounty.status);
    if (filter === "closed") return [5, 6].includes(bounty.status);
    if (!address) return false;
    if (filter === "posted")
      return bounty.poster.toLowerCase() === address.toLowerCase();
    if (filter === "working")
      return bounty.worker.toLowerCase() === address.toLowerCase();
    if (filter === "arbitration")
      return address.toLowerCase() === arbiterAddress && bounty.status === 4;
    return false;
  });
  const locked = entries
    .filter((e) => e.bounty.status < 5)
    .reduce((sum, e) => sum + e.bounty.amount, 0n);
  return (
    <main className={`shell view-${view}`}>
      <header className="topbar">
        <a className="brand" href={root}>
          <BrandMark className="brand-mark" />
          <span className="brand-word">ProofPay</span>
          <small>{t.brandTag}</small>
        </a>
        <nav
          className="main-nav"
          aria-label={zh ? "主导航" : "Main navigation"}
        >
          <a
            href={root}
            aria-current={
              view === "market" || view === "detail" ? "page" : undefined
            }
          >
            {zh ? "任务广场" : "Marketplace"}
          </a>
          <a
            href={postHref}
            aria-current={view === "post" ? "page" : undefined}
          >
            {zh ? "发布任务" : "Post a task"}
          </a>
          <a href={zh ? "/zh/profile" : "/profile"} aria-current={view === "profile" ? "page" : undefined}>
            {zh ? "个人中心" : "Profile"}
          </a>
        </nav>
        <div className="top-right">
          <a
            className="language-switch"
            href={
              view === "profile" ? (zh ? "/profile" : "/zh/profile") : locale === "zh"
                ? view === "post"
                  ? "/post"
                  : view === "detail"
                    ? `/tasks/${taskId}`
                    : "/"
                : view === "post"
                  ? "/zh/post"
                  : view === "detail"
                    ? `/zh/tasks/${taskId}`
                    : "/zh"
            }
            lang={locale === "zh" ? "en" : "zh-CN"}
          >
            {t.switchLanguage}
          </a>
          <span className="network">
            <i /> {t.network}
          </span>
          <ConnectButton showBalance={false} chainStatus="none" />
        </div>
      </header>
      <section className="page-intro" aria-labelledby="page-title">
        <div>
          {view === "detail" && (
            <a className="back-link" href={root}>
              ← {zh ? "返回任务广场" : "Back to marketplace"}
            </a>
          )}
          <div className="section-kicker">
            {view === "profile" ? (zh ? "个人中心" : "YOUR PROFILE") : view === "post"
              ? zh
                ? "发布任务"
                : "POST A TASK"
              : view === "detail"
                ? zh
                  ? "任务详情"
                  : "TASK DETAILS"
                : zh
                  ? "任务广场"
                  : "BOUNTY MARKETPLACE"}
          </div>
          <h1 id="page-title">
            {view === "profile" ? (zh ? "我的任务，尽在这里。" : "Your work, in one place.") : view === "post" ? (
              zh ? (
                "发布任务，锁定赏金"
              ) : (
                "Post a task. Secure the reward."
              )
            ) : view === "detail" ? (
              `${zh ? "任务" : "Bounty"} #${taskId ?? ""}`
            ) : zh ? (
              <>
                让每份交付，
                <br />
                <em>都有回报。</em>
              </>
            ) : (
              <>
                Good work.
                <br />
                <em>Clear rewards.</em>
              </>
            )}
          </h1>
          <p>
            {view === "profile" ? (zh ? "按当前连接的钱包管理发布和接下的任务。切换钱包后，列表会同步更新。" : "Manage tasks posted and accepted by your connected wallet. Switching wallets updates your tasks.") : view === "post"
              ? zh
                ? "写清验收标准，设置赏金与截止时间。发布后，测试币会进入链上托管。"
                : "Set clear acceptance criteria, a reward and a deadline. Demo tokens are locked on chain when you post."
              : view === "detail"
                ? zh
                  ? "按任务标准接单和交付。DeepSeek 验收后，发布者可在这里查看报告并提出异议。"
                  : "Accept and submit work here. After DeepSeek reviews it, the poster can inspect the report and dispute it."
                : zh
                  ? "浏览链上任务，连接钱包即可接单。已接任务可在详情页上传成果。"
                  : "Browse on-chain tasks. Connect a wallet to accept one, then upload your work on its detail page."}
          </p>
          {view === "market" && (
            <div className="intro-links">
              <a className="primary" href={postHref}>
                {zh ? "发布新任务" : "Post a bounty"} <span>↗</span>
              </a>
              <a className="text-link" href="#bounty-market">
                {zh ? "探索任务广场" : "Explore bounties"} <span>↓</span>
              </a>
            </div>
          )}
        </div>
        {view === "market" && <ProofIllustration zh={zh} />}
      </section>
      {view === "profile" && (
        <section className="profile-wallet" aria-label={zh ? "钱包身份" : "Wallet identity"}>
          <div className="profile-avatar" aria-hidden="true">{address ? address.slice(2, 4).toUpperCase() : "◇"}</div>
          <div className="profile-identity"><span className="section-kicker">{zh ? "当前钱包" : "CONNECTED WALLET"}</span>
            <strong>{address ?? (zh ? "尚未连接钱包" : "No wallet connected")}</strong>
            <p>{zh ? "钱包地址是你的个人身份；链上任务信息仍然公开。" : "Your wallet address identifies your profile. On-chain task information remains public."}</p>
          </div>
          {!address && <ConnectButton showBalance={false} chainStatus="none" />}
        </section>
      )}
      {view === "market" && (
        <div
          className="overview-stats"
          aria-label={zh ? "链上任务概览" : "On-chain overview"}
        >
          <div>
            <small>{zh ? "托管中的赏金" : "REWARDS IN ESCROW"}</small>
            <strong>
              {chainLoaded ? formatUnits(locked, 6) : "—"} <em>mUSDT</em>
            </strong>
            <span>
              {zh ? "测试代币，无实际价值" : "Demo tokens · no monetary value"}
            </span>
          </div>
          <div>
            <small>{zh ? "开放任务" : "OPEN BOUNTIES"}</small>
            <strong>
              {chainLoaded
                ? entries.filter((e) => e.bounty.status === 0).length
                : "—"}
            </strong>
            <span>{zh ? "等待接单" : "Ready for a worker"}</span>
          </div>
          <div>
            <small>{zh ? "进行中的任务" : "IN PROGRESS"}</small>
            <strong>
              {chainLoaded
                ? entries.filter((e) => [1, 2, 3, 4].includes(e.bounty.status))
                    .length
                : "—"}
            </strong>
            <span>
              {zh ? "交付、验收或仲裁中" : "Delivery, review or arbitration"}
            </span>
          </div>
          <div>
            <small>{zh ? "已付款任务" : "PAID BOUNTIES"}</small>
            <strong>
              {chainLoaded
                ? entries.filter((e) => e.bounty.status === 5).length
                : "—"}
            </strong>
            <span>
              {zh ? "结算记录保存在链上" : "Settlement recorded on chain"}
            </span>
          </div>
        </div>
      )}
      {!configured && <div className="alert">{t.deploymentNeeded}</div>}
      {isConnected && chainId !== hsk.id && (
        <div className="alert">
          {t.wrongChain}{" "}
          <button onClick={() => void switchChainAsync({ chainId: hsk.id })}>
            {t.switchChain}
          </button>
        </div>
      )}
      {chainError && (
        <div className="alert" role="status">
          {t.chainUnavailable}
          {zh ? "。" : ". "}
          {t.chainRetry}
        </div>
      )}
      {(view === "market" || view === "post" || view === "profile") && (
        <section className={`workspace workspace-${view}`}>
          {view === "post" && (
            <div className="workspace-head">
              <div>
                <div className="section-kicker">{t.newBounty}</div>
                <h2>{zh ? "任务信息" : "Task details"}</h2>
              </div>
              <div className="wallet-balance">
                <small>{t.balance}</small>
                <strong>
                  {balanceLoaded ? formatUnits(balance, 6) : "—"}{" "}
                  <span>mUSDT</span>
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
          )}
          <div className={`panels panels-${view}`}>
            {view === "post" && (
              <>
                {!isConnected && (
                  <div className="wallet-gate" role="status">
                    <strong>
                      {zh ? "连接钱包后发布" : "Connect your wallet to post"}
                    </strong>
                    <p>
                      {zh
                        ? "钱包地址就是你的登录身份。连接后可领取测试币并发布链上任务。"
                        : "Your wallet address is your sign-in. Connect it to get demo tokens and post on chain."}
                    </p>
                    <ConnectButton showBalance={false} chainStatus="none" />
                  </div>
                )}
                <div className="panel create-panel" id="create-task">
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
                      ref={amountInputRef}
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={amount}
                      disabled={!!busy}
                      onChange={(e) => { setAmount(e.target.value); setPublishReview(null); }}
                    />
                  </label>
                  <label>
                    {t.criteria} <span>{t.criteriaHint}</span>
                    <textarea
                      rows={5}
                      maxLength={2048}
                      placeholder={t.defaultCriteria}
                      value={criteria}
                      disabled={!!busy}
                      onChange={(e) => { setCriteria(e.target.value); setPublishReview(null); }}
                    />
                  </label>
                  <label className="agent-choice">
                    <input
                      type="checkbox"
                      checked={autoAgent}
                      disabled={!!busy}
                      onChange={(event) => { setAutoAgent(event.target.checked); setPublishReview(null); }}
                    />
                    <span>
                      {zh
                        ? "由演示 AI 智能体自动接单"
                        : "Let the demo AI agent accept automatically"}
                    </span>
                  </label>
                  <p className="agent-choice-note">
                    {autoAgent
                      ? zh
                        ? "AI 智能体会尽快接单并交付，真人可能来不及接单。"
                        : "The AI agent will claim and submit soon. Human workers may not get a chance."
                      : zh
                        ? "默认开放给真人接单；交付后仍由 DeepSeek 验收。"
                        : "Open to human workers by default. DeepSeek still reviews their work."}
                  </p>
                  <label>
                    {t.deadline} <span>{t.deadlineHint}</span>
                    <input
                      type="number"
                      min="1"
                      max="43200"
                      value={minutes}
                      disabled={!!busy}
                      onChange={(e) => { setMinutes(e.target.value); setPublishReview(null); }}
                    />
                  </label>
                  {publishReview && (
                    <div className="publish-confirmation" role="status">
                      <strong>{zh ? "请核对最终上链赏金" : "Review the exact on-chain reward"}</strong>
                      <p>{zh ? "本次将锁定" : "This task will lock"} <b>{formatUnits(publishReview.value, 6)} mUSDT</b></p>
                      <small>{zh ? "发布后无法修改这笔赏金。如金额不对，请返回修改。" : "The reward cannot be edited after posting. Change it now if it is wrong."}</small>
                      <button type="button" className="secondary" disabled={!!busy} onClick={() => { setPublishReview(null); amountInputRef.current?.focus(); }}>{zh ? "返回修改金额" : "Edit reward"}</button>
                    </div>
                  )}
                  <button
                    className="primary"
                    disabled={
                      !configured ||
                      !wallet ||
                      !!busy ||
                      chainError ||
                      !balanceLoaded
                    }
                    onClick={() => void create()}
                  >
                    {busy === t.createAction || busy === t.approveAction
                      ? t.confirmWallet
                      : publishReview
                        ? (zh ? `确认锁定 ${formatUnits(publishReview.value, 6)} mUSDT 并发布` : `Lock ${formatUnits(publishReview.value, 6)} mUSDT and post`)
                        : (zh ? "先核对赏金金额" : "Review reward amount")}
                    <span>↗</span>
                  </button>
                  <p className="fineprint">{t.createNote}</p>
                  {wallet && !balanceLoaded && (
                    <p className="form-hint">{t.balancePending}</p>
                  )}
                  {wallet && balanceLoaded && rewardAmount > balance && (
                    <p className="form-hint">{t.insufficientBalance}</p>
                  )}
                </div>
                <aside className="posting-guide">
                  <div className="section-kicker">
                    {zh ? "发布前请确认" : "BEFORE YOU POST"}
                  </div>
                  <h3>
                    {zh
                      ? "写得清楚，验收才有依据"
                      : "Clear criteria make review useful"}
                  </h3>
                  <ol>
                    {(zh
                      ? [
                          "说明具体要交付什么成果。",
                          "列出必须包含的内容和不能遗漏的条件。",
                          "设置合理截止时间，确认测试币和测试网手续费充足。",
                          "DeepSeek 会按标准给出完成度和验收理由，发布者可在争议期查看并提出异议。",
                        ]
                      : [
                          "Describe the deliverable.",
                          "List the required details and conditions.",
                          "Set a realistic deadline and check demo token and testnet gas balances.",
                          "DeepSeek scores the work against these criteria. The poster can inspect and dispute the result.",
                        ]
                    ).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ol>
                </aside>
              </>
            )}
            {(view === "market" || view === "profile") && (
              <div className="panel list-panel" id="bounty-market">
                <div className="panel-heading">
                  <span className="panel-icon dark">▦</span>
                  <div>
                    <div className="panel-eyebrow">{t.live}</div>
                    <h3>
                      {view === "profile" ? (zh ? "我的任务" : "My tasks") : t.bounties}{" "}
                      <span className="count">
                        {!chainLoaded && !entries.length ? "—" : visibleEntries.length}
                      </span>
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
                <div
                  className="market-filters"
                  aria-label={zh ? "筛选任务" : "Filter bounties"}
                >
                  {(view === "profile" ? [
                    ["posted", zh ? "我发布的" : "Posted by me"],
                    ["working", zh ? "我接的" : "Accepted by me"],
                    ["hidden", zh ? "已隐藏" : "Hidden"],
                  ] : [
                    ["all", zh ? "全部" : "All"],
                    ["open", zh ? "待接单" : "Open"],
                    ["active", zh ? "进行中" : "Active"],
                    ["closed", zh ? "已结束" : "Closed"],
                    ...(address?.toLowerCase() === arbiterAddress
                      ? [["arbitration", zh ? "待我仲裁" : "Needs my arbitration"]]
                      : []),
                  ]).map(([key, label]) => (
                    <button
                      key={key}
                      aria-pressed={filter === key}
                      className={filter === key ? "chosen" : ""}
                      onClick={() => setFilter(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {(filter === "posted" || filter === "working") && address && (
                  <p className="wallet-scope">
                    {zh ? "当前钱包" : "Current wallet"}：{short(address)}
                  </p>
                )}
                {view === "profile" && <p className="wallet-scope">{zh ? "隐藏会同步作用于你的个人中心和任务广场，仅保存在当前浏览器并按钱包区分；其他人仍可查看、接单。" : "Hiding applies to your profile and marketplace, saved per wallet in this browser. Other users can still view and accept these tasks."}</p>}
                {view === "market" && address && hiddenIds.length > 0 && (
                  <p className="wallet-scope">
                    {zh ? "已按当前钱包的偏好隐藏任务。" : "Your wallet’s hidden tasks are excluded from this list."}{" "}
                    <a className="text-link" href={zh ? "/zh/profile" : "/profile"}>{zh ? "前往个人中心恢复 →" : "Restore in Profile →"}</a>
                  </p>
                )}
                {visibleEntries.length ? (
                  <div className="bounty-list">
                    {visibleEntries.map(({ id, bounty: item }) => (
                      <div className="bounty-card" key={String(id)}>
                      <a
                        className="bounty-item"
                        href={taskHref(id)}
                      >
                        <div>
                          <span className="item-id">
                            #{String(id).padStart(3, "0")}
                          </span>
                          <span className={`status status-${item.status}`}>
                            {t.status[item.status]}
                          </span>
                        </div>
                        <strong>{cleanCriteria(item.criteria)}</strong>
                        {item.criteria.startsWith(agentMode.prefix) && (
                          <small className="agent-badge">
                            {zh ? "AI 自动接单" : "AI agent"}
                          </small>
                        )}
                        <div className="item-bottom">
                          <span>{short(item.poster)}</span>
                          <b>{formatUnits(item.amount, 6)} mUSDT</b>
                        </div>
                        <span className="item-open">
                          {zh ? "查看任务 →" : "View task →"}
                        </span>
                      </a>
                      {view === "profile" && item.poster.toLowerCase() === address?.toLowerCase() && (
                        <div className="bounty-card-actions">
                          <button type="button" onClick={() => setTaskHidden(id, filter !== "hidden")}>
                            {filter === "hidden" ? (zh ? "恢复显示" : "Restore task") : (zh ? "对我隐藏" : "Hide for me")}
                          </button>
                        </div>
                      )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty">
                    <div>◌</div>
                    <strong>
                      {view === "profile" && !address ? (zh ? "连接钱包查看自己的任务" : "Connect your wallet to see your tasks") : !configured ? (zh ? "任务数据尚未接入" : "Task data is not connected yet") : chainError
                        ? t.chainUnavailable
                        : !chainLoaded
                          ? t.loadingBounties
                          : (filter === "posted" || filter === "working") &&
                              !address
                            ? zh
                              ? "连接钱包查看自己的任务"
                              : "Connect your wallet to see your tasks"
                            : view === "market" && hiddenIds.length > 0 && entries.length > 0
                              ? (zh ? "当前没有可显示的任务" : "No tasks to show with your preferences")
                            : filter === "all"
                              ? t.noBounties
                              : zh
                                ? "暂无符合筛选条件的任务"
                                : "No matching bounties"}
                    </strong>
                    <p>
                      {chainError
                        ? t.chainRetry
                        : !chainLoaded
                          ? ""
                          : view === "market" && hiddenIds.length > 0 && entries.length > 0
                            ? (zh ? "可切换筛选条件，或在个人中心的“已隐藏”中恢复任务。" : "Try another filter or restore tasks from the Hidden tab in Profile.")
                          : filter === "all"
                            ? t.firstTask
                            : (filter === "posted" || filter === "working") &&
                                !address
                              ? zh
                                ? "连接后仅显示该钱包发布或接下的任务。"
                                : "Only tasks posted or accepted by this wallet will appear."
                              : view === "profile"
                                ? (zh ? "这个钱包还没有此类任务，可以前往任务广场接单，或发布一个新任务。" : "This wallet has no tasks in this category. Explore the marketplace or post a new task.")
                                : zh
                                  ? "切换其他状态查看任务。"
                                  : "Try another status filter."}
                    </p>
                    {(filter === "posted" || filter === "working") &&
                      !address && (
                        <ConnectButton showBalance={false} chainStatus="none" />
                      )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}
      {view === "market" && <ServiceHealth url={serviceUrl} locale={locale} />}
      {view === "detail" && !chainLoaded && !chainError && (
        <div className="empty missing-task" role="status">
          <strong>{!configured ? (zh ? "任务数据尚未接入" : "Task data is not connected yet") : zh ? "正在读取链上任务…" : "Loading on-chain task…"}</strong>
        </div>
      )}
      {view === "detail" && chainLoaded && !current && (
        <div className="empty missing-task">
          <strong>{zh ? "找不到这个任务" : "Task not found"}</strong>
          <p>
            {zh
              ? "请检查任务编号，或返回广场选择任务。"
              : "Check the task number or choose one from the marketplace."}
          </p>
          <a href={root}>{zh ? "返回任务广场 →" : "Back to marketplace →"}</a>
        </div>
      )}
      {view === "detail" && current && bounty && (
        <section className="detail" id="task-details">
          <div className="detail-head">
            <div>
              <div className="section-kicker">
                {t.bounty} #{String(current.id).padStart(3, "0")}
              </div>
              <h2>{zh ? "任务进度" : "Task progress"}</h2>
            </div>
            <span className={`status large status-${bounty.status}`}>
              {t.status[bounty.status]}
            </span>
          </div>
          <div className="timeline">
            {t.steps.map((step, index) => (
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
            ))}
          </div>
          <div className="detail-grid">
            <div>
              <h4>{t.criteria}</h4>
              <p className="criteria-text">{cleanCriteria(bounty.criteria)}</p>
              {bounty.criteria.startsWith(agentMode.prefix) && (
                <p className="original-content-note">
                  {zh
                    ? "此任务已指定演示 AI 智能体自动接单。"
                    : "This task is open to the demo AI agent."}
                </p>
              )}
              {t.originalContentNote && (
                <p className="original-content-note">{t.originalContentNote}</p>
              )}
              <div className="meta">
                <span>
                  {t.poster} <strong>{short(bounty.poster)}</strong>
                </span>
                <span>
                  {t.worker}{" "}
                  <strong>
                    {bounty.status === 0
                      ? zh
                        ? "待接单"
                        : "Unassigned"
                      : short(bounty.worker)}
                  </strong>
                </span>
                <span>
                  {t.deadline} · {t.sydneyTime}{" "}
                  <strong>
                    {new Intl.DateTimeFormat(
                      locale === "zh" ? "zh-CN" : "en-AU",
                      {
                        timeZone: "Australia/Sydney",
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      },
                    ).format(new Date(Number(bounty.deadline) * 1000))}
                  </strong>
                </span>
              </div>
              {bounty.submissionURI && (isPoster || isWorker || isDisputeArbiter) && (
                <div className="evidence">
                  <h4>{t.submission}</h4>
                  {submissionHref(bounty.submissionURI, current.id) ? (
                    signedIn ? (
                      <a
                        href={submissionHref(bounty.submissionURI, current.id)!}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t.openWork}
                      </a>
                    ) : (
                      <button
                        className="secondary"
                        disabled={authBusy}
                        onClick={() => void signIn()}
                      >
                        {zh ? "签名后查看交付内容" : "Sign to view deliverable"}
                      </button>
                    )
                  ) : (
                    <p className="private-note">
                      {zh
                        ? "这份交付使用外部地址，平台无法保证其访问权限。"
                        : "This deliverable uses an external address; the platform cannot control its access."}
                    </p>
                  )}
                  <small>
                    {t.contentHash}: {short(bounty.submissionHash)}
                  </small>
                </div>
              )}
              {bounty.submissionURI && !isPoster && !isWorker && !isDisputeArbiter && <p className="private-note">{zh ? "交付内容仅发布者和接单者可见；争议期间仲裁人也可查看。" : "The poster and worker can view the deliverable; the arbiter can also view it during a dispute."}</p>}
              {pendingReview && isPoster && signedIn && bounty.status === 2 && (
                <section className="verdict" aria-label={zh ? "DeepSeek 待确认建议" : "Pending DeepSeek recommendation"}>
                  <div className="report-heading"><span>{zh ? "DeepSeek 建议 · 等待人工确认" : "DeepSeek recommendation · awaiting human review"}</span><span className="status status-4">{zh ? "建议未通过" : "Suggests revision"}</span></div>
                  <div className="report-score"><strong>{pendingReview.score}%</strong><span>{zh ? "AI 评估完成度" : "AI assessed completion"}</span></div>
                  <p>{pendingReview.reason}</p>
                  <small>{zh ? "这是 AI 建议，尚未写入链上。发布者可根据交付内容人工认可；5 分钟内未操作，系统才按 AI 建议处理。" : "This is an AI recommendation, not yet committed on chain. The poster can approve the work within five minutes; otherwise the AI recommendation takes effect."}</small>
                </section>
              )}
              {reason && canReadReview && signedIn && (
                <section className="verdict" aria-label={zh ? "DeepSeek 验收报告" : "DeepSeek review report"}>
                  <div className="report-heading"><span>{reason.source === "poster" ? (zh ? "发布者人工认可 · DeepSeek 原建议" : "Poster approval · original DeepSeek review") : /scripted demo/i.test(reason.reason) ? (zh ? "脚本演示结果" : "Scripted demo result") : (zh ? "DeepSeek 验收报告" : "DeepSeek review report")}</span><span className={`status status-${reason.pass ? 3 : 4}`}>{reason.source === "poster" ? (zh ? "人工通过" : "Approved by poster") : reason.pass ? (zh ? "通过" : "Passed") : (zh ? "未通过" : "Needs revision")}</span></div>
                  <div className="report-score"><strong>{reason.score}%</strong><span>{reason.source === "poster" ? (zh ? "DeepSeek 原评估完成度" : "Original DeepSeek score") : (zh ? "任务完成度" : "Task completion")}</span></div>
                  <div className="report-meter" role="progressbar" aria-label={zh ? "任务完成度" : "Task completion"} aria-valuenow={reason.score} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${reason.score}%` }} /></div>
                  <h5>{zh ? "验收依据" : "Review findings"}</h5>
                  <p>{reason.reason}</p>
                  <small>
                    {reasonVerified ? t.reasonVerified : t.reasonMismatch}
                  </small>
                  <p className="report-disclaimer">
                    {zh
                      ? "完成度是 AI 的评估，不代表付款比例；链上只校验验收理由的哈希。"
                      : "The score is an AI assessment, not a payment percentage. Only the review reason's hash is committed on chain."}
                  </p>
                </section>
              )}
              {bounty.reasonHash !== zeroHash && canReadReview && !signedIn && (
                <div className="report-gate">
                  <strong>
                    {isDisputeArbiter
                      ? (zh ? "仲裁人签名查看报告" : "Arbiter sign-in required")
                      : (zh ? "验收报告仅向发布者开放" : "Review report for the poster")}
                  </strong>
                  <p>
                    {zh
                      ? "请用当前钱包签名，查看完成度和验收依据。"
                      : "Sign with this wallet to see the score and review findings."}
                  </p>
                  <button
                    className="secondary"
                    disabled={authBusy}
                    onClick={() => void signIn()}
                  >
                    {authBusy
                      ? zh
                        ? "等待钱包签名…"
                        : "Waiting for signature…"
                      : zh
                        ? "签名查看报告"
                        : "Sign to view report"}
                  </button>
                </div>
              )}
              {bounty.reasonHash !== zeroHash && !canReadReview && (
                <p className="private-note">
                  {zh
                    ? "完整验收报告仅发布者可见；争议期间仲裁人也可查看。"
                    : "The full report is visible to the poster and, during a dispute, the arbiter."}
                </p>
              )}
            </div>
            <div className="action-box">
              <h4>{t.nextAction}</h4>
              {!isConnected && bounty.status < 5 && (
                <div className="action-note wallet-prompt">
                  <p>
                    {zh
                      ? "连接钱包后可接单、提交成果或管理自己发布的任务。"
                      : "Connect your wallet to accept, submit or manage your task."}
                  </p>
                  <ConnectButton showBalance={false} chainStatus="none" />
                </div>
              )}
              {bounty.status === 3 && (
                <div className="countdown">
                  <small>{t.challengeWindow}</small>
                  <strong>
                    {challengeWindow === null ? (zh ? "读取链上时间中…" : "Loading on-chain window…") : secondsLeft > 0
                      ? `${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`
                      : t.readyToClaim}
                  </strong>
                  <p>{challengeWindow === null ? (zh ? "暂不可放款，等待链上窗口信息。" : "Payment is unavailable until the on-chain window is loaded.") : secondsLeft > 0 ? t.disputeBefore : t.anyoneRelease}</p>
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
                  onClick={() => action(t.acceptAction, "accept", [current.id])}
                >
                  {t.acceptButton}
                </button>
              )}
              {bounty.status === 1 && isWorker && (
                <>
                  {!signedIn && (
                    <div className="report-gate">
                      <strong>{zh ? "签名后交付" : "Sign in to submit"}</strong>
                      <p>
                        {zh
                          ? "请用接单的钱包签名，避免把成果提交到其他账户。"
                          : "Sign with the assigned worker wallet before submitting work."}
                      </p>
                      <button
                        className="secondary"
                        disabled={authBusy}
                        onClick={() => void signIn()}
                      >
                        {zh ? "签名验证钱包" : "Verify wallet signature"}
                      </button>
                    </div>
                  )}
                  <label className="upload-label" htmlFor="deliverable-file">
                    {zh
                      ? "上传成果（文本文件）"
                      : "Upload deliverable (text file)"}
                  </label>
                  <input
                    id="deliverable-file"
                    className="file-input"
                    type="file"
                    accept=".txt,.md,.json,.csv,text/plain,text/markdown,application/json,text/csv"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void readDeliverable(file);
                    }}
                  />
                  <p className="upload-hint">
                    {uploadedFile
                      ? `${zh ? "已读取" : "Loaded"}: ${uploadedFile}`
                      : zh
                        ? "支持 .txt、.md、.json、.csv，最大 20 KB；也可以直接在下方填写。"
                        : "Supports .txt, .md, .json and .csv up to 20 KB. You can also write below."}
                  </p>
                  <textarea
                    rows={5}
                    maxLength={20000}
                    placeholder={t.submissionPlaceholder}
                    value={submission}
                    onChange={(e) => {
                      setSubmission(e.target.value);
                      setUploadedFile("");
                    }}
                  />
                  <button
                    className="primary"
                    disabled={
                      !wallet ||
                      !signedIn ||
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
              {bounty.status === 1 && isPoster && reason?.pass === false && <p className="action-note">{zh ? "这次 AI 未通过已写入旧合约，无法原地改判。接单者可在截止前重新提交；下一次 AI 建议未通过时，你将有 5 分钟人工认可交付。" : "This AI rejection is already recorded by the existing contract and cannot be changed in place. The worker can resubmit before the deadline; you can then approve an AI rejection within a five-minute review window."}</p>}
              {bounty.status === 2 && (
                <div className="action-note">
                  <p>{t.waitingVerifier}</p>
{isPoster && pendingReview && !pendingReview.humanApprovalPending && <div className="manual-review">
                    <strong>{zh ? "你可以推翻 AI 的未通过建议" : "You can overrule the AI rejection"}</strong>
                    <p>{zh ? "先核对交付内容，再写下认可依据。你的决定会由验收服务写入链上。" : "Read the deliverable, then explain why you accept it. The verifier service will record your decision on chain."}</p>
                    <textarea aria-label={zh ? "人工认可理由" : "Reason for human approval"} aria-describedby="manual-review-help" maxLength={500} rows={3} value={manualReason} onChange={event => setManualReason(event.target.value)} placeholder={zh ? "例如：交付已满足我最看重的要求……" : "For example: The delivery meets the requirement that matters most…"} />
                    <small id="manual-review-help" role="status">
                      {now * 1000 >= pendingReview.expiresAt
                        ? (zh ? "人工认可时间已结束，不能再提交。" : "The human review window has closed.")
                        : manualReason.trim().length < 5
                          ? (zh ? `理由至少需要 5 个字符，还差 ${5 - manualReason.trim().length} 个。` : `The reason needs at least 5 characters; ${5 - manualReason.trim().length} more to go.`)
                          : (zh ? "理由已符合要求，可以提交人工认可。" : "The reason is ready; you can submit your approval.")}
                    </small>
                    <button className="primary" disabled={!!busy || manualReason.trim().length < 5 || Date.now() >= pendingReview.expiresAt} onClick={() => void approveAiFailure()}>{zh ? "人工认可这份交付" : "Approve this work manually"}</button>
                    <small>{zh ? `人工认可截止：${new Intl.DateTimeFormat("zh-CN", { timeZone: "Australia/Sydney", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(pendingReview.expiresAt))}（悉尼时间）` : `Human review closes at ${new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(pendingReview.expiresAt))} Sydney time`}</small>
                  </div>}
                  {isPoster && pendingReview?.humanApprovalPending && <p>{zh ? "人工认可已提交，正在等待链上确认。" : "Human approval submitted; waiting for chain confirmation."}</p>}
                  {verificationEnds?.id === current.id ? (
                    <>
                      <p>
                        {now < verificationEnds.at
                          ? zh
                            ? `还需 ${Math.max(0, verificationEnds.at - now)} 秒可申请超时仲裁。`
                            : `Timeout arbitration available in ${Math.max(0, verificationEnds.at - now)} seconds.`
                          : zh
                            ? "验收已超时。发布者或接单者可申请仲裁，裁决前资金继续托管。"
                            : "Verification is overdue. Either participant may request arbitration; funds remain escrowed until a decision."}
                      </p>
                      {(isPoster || isWorker) && (
                        <button
                          className="secondary"
                          disabled={
                            !wallet || !!busy || now < verificationEnds.at
                          }
                          onClick={() =>
                            action(
                              "Request timeout arbitration",
                              "escalateVerificationTimeout",
                              [current.id],
                            )
                          }
                        >
                          {zh ? "申请超时仲裁" : "Request timeout arbitration"}
                        </button>
                      )}
                    </>
                  ) : (
                    <p>
                      {zh
                        ? "当前合约不支持超时仲裁，或暂时无法读取。旧版本需重新部署才能使用。"
                        : "Timeout recovery is unavailable or could not be read. Older contracts need redeployment to support it."}
                    </p>
                  )}
                </div>
              )}
              {bounty.status === 3 && (
                <>
                  {isPoster && supportsConfirmation && <>
                    <button className="primary" disabled={!wallet || !!busy || chainId !== hsk.id} onClick={() => void releasePayment(true)}>
                      {zh ? "确认交付并立即放款" : "Confirm delivery & pay now"}
                    </button>
                    <p className="action-note">{zh ? "确认后立即向接单者支付全部赏金，并结束异议期。" : "Confirmation pays the full reward to the worker immediately and ends the challenge window."}</p>
                  </>}
                  {isPoster && !supportsConfirmation && <p className="action-note">{zh ? "当前合约未确认支持立即放款，请等待异议期结束。新版合约部署后可启用。" : "Immediate payment support is unavailable on this contract. Wait for the challenge window or use an upgraded deployment."}</p>}
                  {isPoster && <button
                    className="primary"
                    disabled={!wallet || !!busy || chainId !== hsk.id || challengeWindow === null || secondsLeft > 0}
                    onClick={() => void releasePayment()}
                  >
                    {t.releaseButton}
                  </button>}
                  <p className="action-note">{zh ? "赏金由合约支付给接单者。后台会在异议期后自动结算；发布者也可手动触发，仅需支付 Gas。" : "The contract pays the assigned worker. The keeper settles after the challenge window; the poster can also trigger settlement and pays only gas."}</p>
                  {isPoster && secondsLeft > 0 && (
                    <button
                      className="secondary"
                      disabled={!!busy}
                      onClick={() =>
                        action(t.disputeAction, "dispute", [current.id])
                      }
                    >
                      {zh ? "驳回 AI 通过，申请人工仲裁" : "Challenge AI approval for human arbitration"}
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
                    onClick={() =>
                      action(t.refundAction, "refund", [current.id])
                    }
                  >
                    {t.refundButton}
                  </button>
                )}
              {bounty.status === 4 && (
                <div className="action-note">
                  <p>{t.disputedNote}</p>
                  {isDisputeArbiter && <div className="arbiter-actions">
                    <strong>{zh ? "人工仲裁 · 由你决定赏金归属" : "Human arbitration · decide where the reward goes"}</strong>
                    <p>{zh ? "先查看交付内容和验收报告，再选择链上裁决。该交易会立即结算。" : "Review the deliverable and report before deciding. This transaction settles the reward immediately."}</p>
                    <button className="primary" disabled={!wallet || !!busy} onClick={() => void action(zh ? "裁定放款" : "Award worker", "resolve", [current.id, true])}>{zh ? "裁定放款给接单者" : "Award payment to worker"}</button>
                    <button className="secondary" disabled={!wallet || !!busy} onClick={() => void action(zh ? "裁定退款" : "Refund poster", "resolve", [current.id, false])}>{zh ? "裁定退回发布者" : "Refund the poster"}</button>
                  </div>}
                </div>
              )}
              {(bounty.status === 5 || bounty.status === 6) && (
                <p className="action-note">{t.closedNote}</p>
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
