"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useSignMessage, useSwitchChain, useWalletClient } from "wagmi";
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
const serviceUrl =
  process.env.NEXT_PUBLIC_SERVICE_URL || "/api";
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
type Reason = { reason: string; score: number; pass: boolean; hash: string };

function short(address?: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "—";
}
function cleanCriteria(criteria: string) {
  return criteria.startsWith(agentMode.prefix) ? criteria.slice(agentMode.prefix.length) : criteria;
}
function errorText(error: unknown, locale: PageLocale) {
  const message = error instanceof Error
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

type View = "market" | "post" | "detail";

export default function BountyApp({ locale = "en", view = "market", taskId }: { locale?: PageLocale; view?: View; taskId?: string }) {
  const t = copy[locale];
  const router = useRouter();
  const root = locale === "zh" ? "/zh" : "/";
  const postHref = locale === "zh" ? "/zh/post" : "/post";
  const taskHref = (id: bigint) => `${locale === "zh" ? "/zh" : ""}/tasks/${id}`;
  const { address, chainId, isConnected } = useAccount();
  const { data: wallet } = useWalletClient();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const [filter, setFilter] = useState("all");
  const [entries, setEntries] = useState<Entry[]>([]);
  const selected = taskId && /^\d{1,20}$/.test(taskId) ? BigInt(taskId) : null;
  const [amount, setAmount] = useState("100");
  const [criteria, setCriteria] = useState<string>("");
  const [autoAgent, setAutoAgent] = useState(false);
  const [minutes, setMinutes] = useState("30");
  const [submission, setSubmission] = useState("");
  const [uploadedFile, setUploadedFile] = useState("");
  const [reason, setReason] = useState<Reason | null>(null);
  const [reasonVerified, setReasonVerified] = useState(false);
  const [authAddress, setAuthAddress] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
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
  const [verificationEnds, setVerificationEnds] = useState<{ id: bigint; at: number } | null>(null);
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
          const known = previousEntries.current.find((entry) => entry.id === id);
          if (known && (known.bounty.status === 5 || known.bounty.status === 6))
            return known;
          return { id, bounty: (await publicClient.readContract({
            address: escrowAddress!,
            abi: escrowAbi,
            functionName: "getBounty",
            args: [id],
          })) as Bounty };
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
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
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
    if (!escrowAddress || current?.id === undefined || bounty?.status !== 2) return;
    const id = current.id;
    void Promise.all([
      publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: 'submittedAt', args: [id] }),
      publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: 'verificationTimeout' }),
    ]).then(([at, timeout]) => {
      if (active && Number(at) > 0) setVerificationEnds({ id, at: Number(at) + Number(timeout) });
    }).catch(() => { /* Older contracts do not have timeout recovery. Never expose an unsupported action. */ });
    return () => { active = false; };
  }, [current?.id, bounty?.status]);
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
      .then(response => response.json())
      .then((data: { address?: string | null }) => {
        if (active && data.address?.toLowerCase() === address.toLowerCase()) setAuthAddress(address.toLowerCase());
      })
      .catch(() => {});
    return () => { active = false; };
  }, [address]);

  async function signIn() {
    if (!address) return;
    setAuthBusy(true);
    setNotice("");
    try {
      const challengeResponse = await fetch(`/api/auth/challenge?address=${encodeURIComponent(address)}`, { cache: "no-store" });
      if (!challengeResponse.ok) throw new Error(locale === "zh" ? "无法获取钱包登录请求。" : "Could not start wallet sign-in.");
      const { message } = await challengeResponse.json() as { message: string };
      const signature = await signMessageAsync({ account: address, message });
      const verifyResponse = await fetch("/api/auth/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, signature }),
      });
      if (!verifyResponse.ok) throw new Error(locale === "zh" ? "签名验证失败，请重试。" : "Signature verification failed. Try again.");
      setAuthAddress(address.toLowerCase());
      setNotice(locale === "zh" ? "钱包身份已验证。" : "Wallet identity verified.");
    } catch (error) {
      setNotice(errorText(error, locale));
    } finally {
      setAuthBusy(false);
    }
  }

  useEffect(() => {
    setSubmission("");
    setUploadedFile("");
    setNotice("");
    setTxHash(null);
  }, [address, selected]);

  useEffect(() => {
    setReason(null);
    setReasonVerified(false);
    if (!bounty || bounty.reasonHash === zeroHash || !isPoster || !signedIn) return;
    const hash = bounty.reasonHash;
    let active = true;
    fetch(`${serviceUrl}/reasons/${current?.id}`, { cache: "no-store" })
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
  }, [current?.id, bounty?.reasonHash, isPoster, signedIn]);

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
    try {
      const hash = await action();
      setTxHash(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(t.reverted);
      setNotice(`${name}${locale === "zh" ? "" : " "}${t.confirmed}`);
      await refresh();
      return true;
    } catch (error) {
      setNotice(`${name}: ${errorText(error, locale)}`);
      return false;
    } finally {
      setBusy("");
    }
  }

  async function create() {
    if (!wallet || !address || !configured) return;
    const value = rewardAmount;
    const onchainCriteria = `${autoAgent ? agentMode.prefix : ""}${criteria.trim()}`;
    const durationMinutes = Number(minutes);
    if (new TextEncoder().encode(onchainCriteria).length > 2048) {
      setNotice(locale === "zh" ? "验收标准超过链上 2,048 字节限制，请缩短内容。" : "Acceptance criteria exceed the 2,048-byte on-chain limit. Shorten the text.");
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
    const deadline = BigInt(Math.floor(Date.now() / 1000 + durationMinutes * 60));
    if (!balanceLoaded || value > balance) {
      setNotice(t.insufficientBalance);
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
        if (receipt.status !== "success")
          throw new Error(t.approvalReverted);
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
      setNotice(locale === "zh" ? "仅支持不超过 20 KB 的 .txt、.md、.json、.csv 文本文件。" : "Choose a .txt, .md, .json or .csv file under 20 KB.");
      return;
    }
    const content = await file.text();
    if (!content.trim()) {
      setNotice(locale === "zh" ? "文件内容为空，请重新选择。" : "The file is empty. Choose another file.");
      return;
    }
    setSubmission(content);
    setUploadedFile(file.name);
    setNotice("");
  }

  async function submit() {
    if (!wallet || !address || selected === null || !submission.trim() || !signedIn) {
      setNotice(t.writeSubmission);
      return;
    }
    await transact(t.submitAction, async () => {
      const response = await fetch(`${serviceUrl}/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: submission, bountyId: String(selected) }),
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

  const zh = locale === 'zh';
  const visibleEntries = entries.filter(({ bounty }) => {
    if (filter === "all") return true;
    if (filter === "open") return bounty.status === 0;
    if (filter === "active") return [1, 2, 3, 4].includes(bounty.status);
    if (filter === "closed") return [5, 6].includes(bounty.status);
    if (!address) return false;
    if (filter === "posted") return bounty.poster.toLowerCase() === address.toLowerCase();
    if (filter === "working") return bounty.worker.toLowerCase() === address.toLowerCase();
    return false;
  });
  const locked = entries.filter(e => e.bounty.status < 5).reduce((sum, e) => sum + e.bounty.amount, 0n);
  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href={root}>
          <span className="brand-mark">P</span>
          <span>PROOFPAY</span>
          <small>{t.brandTag}</small>
        </a>
        <nav className="main-nav" aria-label={zh ? "主导航" : "Main navigation"}>
          <a href={root} aria-current={view === "market" || view === "detail" ? "page" : undefined}>{zh ? "任务广场" : "Marketplace"}</a>
          <a href={postHref} aria-current={view === "post" ? "page" : undefined}>{zh ? "发布任务" : "Post a task"}</a>
        </nav>
        <div className="top-right">
          <a className="language-switch" href={locale === "zh" ? (view === "post" ? "/post" : view === "detail" ? `/tasks/${taskId}` : "/") : (view === "post" ? "/zh/post" : view === "detail" ? `/zh/tasks/${taskId}` : "/zh")} lang={locale === "zh" ? "en" : "zh-CN"}>
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
          {view === "detail" && <a className="back-link" href={root}>← {zh ? "返回任务广场" : "Back to marketplace"}</a>}
          <div className="section-kicker">{view === "post" ? (zh ? "发布任务" : "POST A TASK") : view === "detail" ? (zh ? "任务详情" : "TASK DETAILS") : (zh ? "任务广场" : "BOUNTY MARKETPLACE")}</div>
          <h1 id="page-title">{view === "post" ? (zh ? "发布任务，锁定赏金" : "Post a task. Secure the reward.") : view === "detail" ? `${zh ? "任务" : "Bounty"} #${taskId ?? ""}` : (zh ? "发现任务，交付成果" : "Find work. Deliver results.")}</h1>
          <p>{view === "post" ? (zh ? "写清验收标准，设置赏金与截止时间。发布后，测试币会进入链上托管。" : "Set clear acceptance criteria, a reward and a deadline. Demo tokens are locked on chain when you post.") : view === "detail" ? (zh ? "按任务标准接单和交付。DeepSeek 验收后，发布者可在这里查看报告并提出异议。" : "Accept and submit work here. After DeepSeek reviews it, the poster can inspect the report and dispute it.") : (zh ? "浏览链上任务，连接钱包即可接单。已接任务可在详情页上传成果。" : "Browse on-chain tasks. Connect a wallet to accept one, then upload your work on its detail page.")}</p>
        </div>
        {view === "market" && <a className="primary intro-action" href={postHref}>{zh ? "发布新任务" : "Post a task"} <span>↗</span></a>}
      </section>
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
      {chainError && <div className="alert" role="status">{t.chainUnavailable}{zh ? "。" : ". "}{t.chainRetry}</div>}
      {(view === "market" || view === "post") && <section className={`workspace workspace-${view}`}>
        {view === "post" && <div className="workspace-head">
          <div>
            <div className="section-kicker">{t.newBounty}</div>
            <h2>{zh ? "任务信息" : "Task details"}</h2>
          </div>
          <div className="wallet-balance">
            <small>{t.balance}</small>
            <strong>
              {balanceLoaded ? formatUnits(balance, 6) : "—"} <span>mUSDT</span>
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
        </div>}
        <div className={`panels panels-${view}`}>
          {view === "post" && <>
          {!isConnected && <div className="wallet-gate" role="status"><strong>{zh ? "连接钱包后发布" : "Connect your wallet to post"}</strong><p>{zh ? "钱包地址就是你的登录身份。连接后可领取测试币并发布链上任务。" : "Your wallet address is your sign-in. Connect it to get demo tokens and post on chain."}</p><ConnectButton showBalance={false} chainStatus="none" /></div>}
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
                placeholder={t.defaultCriteria}
                value={criteria}
                onChange={(e) => setCriteria(e.target.value)}
              />
            </label>
            <label className="agent-choice"><input type="checkbox" checked={autoAgent} onChange={event => setAutoAgent(event.target.checked)} /><span>{zh ? "由演示 AI 智能体自动接单" : "Let the demo AI agent accept automatically"}</span></label>
            <p className="agent-choice-note">{autoAgent ? (zh ? "AI 智能体会尽快接单并交付，真人可能来不及接单。" : "The AI agent will claim and submit soon. Human workers may not get a chance.") : (zh ? "默认开放给真人接单；交付后仍由 DeepSeek 验收。" : "Open to human workers by default. DeepSeek still reviews their work.")}</p>
            <label>
              {t.deadline} <span>{t.deadlineHint}</span>
              <input
                type="number"
                min="1"
                max="43200"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
              />
            </label>
            <button
              className="primary"
              disabled={!configured || !wallet || !!busy || chainError || !balanceLoaded || rewardAmount <= 0n || rewardAmount > balance}
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
            {wallet && !balanceLoaded && <p className="form-hint">{t.balancePending}</p>}
            {wallet && balanceLoaded && rewardAmount > balance && (
              <p className="form-hint">{t.insufficientBalance}</p>
            )}
          </div>
          <aside className="posting-guide"><div className="section-kicker">{zh ? "发布前请确认" : "BEFORE YOU POST"}</div><h3>{zh ? "写得清楚，验收才有依据" : "Clear criteria make review useful"}</h3><ol>{(zh ? ["说明具体要交付什么成果。", "列出必须包含的内容和不能遗漏的条件。", "设置合理截止时间，确认测试币和测试网手续费充足。", "DeepSeek 会按标准给出完成度和验收理由，发布者可在争议期查看并提出异议。"] : ["Describe the deliverable.", "List the required details and conditions.", "Set a realistic deadline and check demo token and testnet gas balances.", "DeepSeek scores the work against these criteria. The poster can inspect and dispute the result."]).map(item => <li key={item}>{item}</li>)}</ol></aside>
          </>}
          {view === "market" &&
          <div className="panel list-panel" id="bounty-market">
            <div className="panel-heading">
              <span className="panel-icon dark">▦</span>
              <div>
                <div className="panel-eyebrow">{t.live}</div>
                <h3>
                  {t.bounties} <span className="count">{!chainLoaded && !entries.length ? "—" : entries.length}</span>
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
            <div className="market-filters" aria-label={zh ? '筛选任务' : 'Filter bounties'}>{[['all',zh?'全部':'All'],['open',zh?'待接单':'Open'],['active',zh?'进行中':'Active'],['closed',zh?'已结束':'Closed'],['posted',zh?'我发布的':'Posted by me'],['working',zh?'我接的':'Accepted by me']].map(([key,label])=><button key={key} aria-pressed={filter===key} className={filter===key?'chosen':''} onClick={()=>setFilter(key)}>{label}</button>)}</div>
            {(filter === "posted" || filter === "working") && address && <p className="wallet-scope">{zh ? "当前钱包" : "Current wallet"}：{short(address)}</p>}
            {visibleEntries.length ? (
              <div className="bounty-list">
                {visibleEntries.map(({ id, bounty: item }) => (
                  <a
                    key={String(id)}
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
                    {item.criteria.startsWith(agentMode.prefix) && <small className="agent-badge">{zh ? "AI 自动接单" : "AI agent"}</small>}
                    <div className="item-bottom">
                      <span>{short(item.poster)}</span>
                      <b>{formatUnits(item.amount, 6)} mUSDT</b>
                    </div>
                    <span className="item-open">{zh ? "查看任务 →" : "View task →"}</span>
                  </a>
                ))}
              </div>
            ) : (
              <div className="empty">
                <div>◌</div>
                <strong>{chainError ? t.chainUnavailable : !chainLoaded ? t.loadingBounties : (filter === "posted" || filter === "working") && !address ? (zh ? "连接钱包查看自己的任务" : "Connect your wallet to see your tasks") : filter === "all" ? t.noBounties : zh ? "暂无符合筛选条件的任务" : "No matching bounties"}</strong>
                <p>{chainError ? t.chainRetry : !chainLoaded ? "" : filter === "all" ? t.firstTask : (filter === "posted" || filter === "working") && !address ? (zh ? "连接后仅显示该钱包发布或接下的任务。" : "Only tasks posted or accepted by this wallet will appear.") : zh ? "切换其他状态查看任务。" : "Try another status filter."}</p>
                {(filter === "posted" || filter === "working") && !address && <ConnectButton showBalance={false} chainStatus="none" />}
              </div>
            )}
          </div>}
        </div>
      </section>}
      {view === "market" && <div className="overview-stats" aria-label={zh ? '链上任务概览' : 'On-chain overview'}>
        <div><small>{zh ? '托管中的赏金' : 'REWARDS IN ESCROW'}</small><strong>{chainLoaded ? formatUnits(locked,6) : '—'} <em>mUSDT</em></strong><span>{zh ? '测试代币，无实际价值' : 'Demo tokens · no monetary value'}</span></div>
        <div><small>{zh ? '开放任务' : 'OPEN BOUNTIES'}</small><strong>{chainLoaded ? entries.filter(e => e.bounty.status === 0).length : '—'}</strong><span>{zh ? '等待接单' : 'Ready for a worker'}</span></div>
        <div><small>{zh ? '进行中的任务' : 'IN PROGRESS'}</small><strong>{chainLoaded ? entries.filter(e => [1,2,3,4].includes(e.bounty.status)).length : '—'}</strong><span>{zh ? '交付、验收或仲裁中' : 'Delivery, review or arbitration'}</span></div>
        <div><small>{zh ? '已付款任务' : 'PAID BOUNTIES'}</small><strong>{chainLoaded ? entries.filter(e => e.bounty.status === 5).length : '—'}</strong><span>{zh ? '结算记录保存在链上' : 'Settlement recorded on chain'}</span></div>
      </div>}
      {view === "market" && <ServiceHealth url={serviceUrl} locale={locale} />}
      {view === "detail" && !chainLoaded && !chainError && <div className="empty missing-task" role="status"><strong>{zh ? "正在读取链上任务…" : "Loading on-chain task…"}</strong></div>}
      {view === "detail" && chainLoaded && !current && <div className="empty missing-task"><strong>{zh ? "找不到这个任务" : "Task not found"}</strong><p>{zh ? "请检查任务编号，或返回广场选择任务。" : "Check the task number or choose one from the marketplace."}</p><a href={root}>{zh ? "返回任务广场 →" : "Back to marketplace →"}</a></div>}
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
              <p className="criteria-text">{cleanCriteria(bounty.criteria)}</p>
              {bounty.criteria.startsWith(agentMode.prefix) && <p className="original-content-note">{zh ? "此任务已指定演示 AI 智能体自动接单。" : "This task is open to the demo AI agent."}</p>}
              {t.originalContentNote && <p className="original-content-note">{t.originalContentNote}</p>}
              <div className="meta">
                <span>
                  {t.poster} <strong>{short(bounty.poster)}</strong>
                </span>
                <span>
                  {t.worker} <strong>{bounty.status === 0 ? (zh ? "待接单" : "Unassigned") : short(bounty.worker)}</strong>
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
              {bounty.submissionURI && (isPoster || isWorker) && (
                <div className="evidence">
                  <h4>{t.submission}</h4>
                  {submissionHref(bounty.submissionURI, current.id) ? (signedIn ? <a href={submissionHref(bounty.submissionURI, current.id)!} target="_blank" rel="noreferrer">{t.openWork}</a> : <button className="secondary" disabled={authBusy} onClick={() => void signIn()}>{zh ? "签名后查看交付内容" : "Sign to view deliverable"}</button>) : <p className="private-note">{zh ? "这份交付使用外部地址，平台无法保证其访问权限。" : "This deliverable uses an external address; the platform cannot control its access."}</p>}
                  <small>{t.contentHash}: {short(bounty.submissionHash)}</small>
                </div>
              )}
              {bounty.submissionURI && !isPoster && !isWorker && <p className="private-note">{zh ? "平台内交付内容仅发布者和接单者可见。" : "Platform-hosted deliverables are visible only to the poster and worker."}</p>}
              {reason && isPoster && signedIn && (
                <section className="verdict" aria-label={zh ? "DeepSeek 验收报告" : "DeepSeek review report"}>
                  <div className="report-heading"><span>{/scripted demo/i.test(reason.reason) ? (zh ? "脚本演示结果" : "Scripted demo result") : (zh ? "DeepSeek 验收报告" : "DeepSeek review report")}</span><span className={`status status-${reason.pass ? 3 : 4}`}>{reason.pass ? (zh ? "通过" : "Passed") : (zh ? "未通过" : "Needs revision")}</span></div>
                  <div className="report-score"><strong>{reason.score}%</strong><span>{zh ? "任务完成度" : "Task completion"}</span></div>
                  <div className="report-meter" role="progressbar" aria-label={zh ? "任务完成度" : "Task completion"} aria-valuenow={reason.score} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${reason.score}%` }} /></div>
                  <h5>{zh ? "验收依据" : "Review findings"}</h5>
                  <p>{reason.reason}</p>
                  <small>
                    {reasonVerified
                      ? t.reasonVerified
                      : t.reasonMismatch}
                  </small>
                  <p className="report-disclaimer">{zh ? "完成度是 AI 的评估，不代表付款比例；链上只校验验收理由的哈希。" : "The score is an AI assessment, not a payment percentage. Only the review reason's hash is committed on chain."}</p>
                </section>
              )}
              {bounty.reasonHash !== zeroHash && isPoster && !signedIn && <div className="report-gate"><strong>{zh ? "验收报告仅向发布者开放" : "Review report for the poster"}</strong><p>{zh ? "请用发布任务的钱包签名，查看完成度和验收依据。" : "Sign with the posting wallet to see the score and review findings."}</p><button className="secondary" disabled={authBusy} onClick={() => void signIn()}>{authBusy ? (zh ? "等待钱包签名…" : "Waiting for signature…") : (zh ? "签名查看报告" : "Sign to view report")}</button></div>}
              {bounty.reasonHash !== zeroHash && !isPoster && <p className="private-note">{zh ? "完整验收报告仅发布者可见。" : "The full review report is visible only to the poster."}</p>}
            </div>
            <div className="action-box">
              <h4>{t.nextAction}</h4>
              {!isConnected && bounty.status < 5 && <div className="action-note wallet-prompt"><p>{zh ? "连接钱包后可接单、提交成果或管理自己发布的任务。" : "Connect your wallet to accept, submit or manage your task."}</p><ConnectButton showBalance={false} chainStatus="none" /></div>}
              {bounty.status === 3 && (
                <div className="countdown">
                  <small>{t.challengeWindow}</small>
                  <strong>
                    {secondsLeft > 0
                      ? `${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`
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
                  {!signedIn && <div className="report-gate"><strong>{zh ? "签名后交付" : "Sign in to submit"}</strong><p>{zh ? "请用接单的钱包签名，避免把成果提交到其他账户。" : "Sign with the assigned worker wallet before submitting work."}</p><button className="secondary" disabled={authBusy} onClick={() => void signIn()}>{zh ? "签名验证钱包" : "Verify wallet signature"}</button></div>}
                  <label className="upload-label" htmlFor="deliverable-file">{zh ? "上传成果（文本文件）" : "Upload deliverable (text file)"}</label>
                  <input id="deliverable-file" className="file-input" type="file" accept=".txt,.md,.json,.csv,text/plain,text/markdown,application/json,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readDeliverable(file); }} />
                  <p className="upload-hint">{uploadedFile ? `${zh ? "已读取" : "Loaded"}: ${uploadedFile}` : (zh ? "支持 .txt、.md、.json、.csv，最大 20 KB；也可以直接在下方填写。" : "Supports .txt, .md, .json and .csv up to 20 KB. You can also write below.")}</p>
                  <textarea
                    rows={5}
                    maxLength={20000}
                    placeholder={t.submissionPlaceholder}
                    value={submission}
                    onChange={(e) => { setSubmission(e.target.value); setUploadedFile(""); }}
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
              {bounty.status === 2 && (
                <div className="action-note">
                  <p>{t.waitingVerifier}</p>
                  {verificationEnds?.id === current.id ? <>
                    <p>{now < verificationEnds.at ? (zh ? `还需 ${Math.max(0, verificationEnds.at - now)} 秒可申请超时仲裁。` : `Timeout arbitration available in ${Math.max(0, verificationEnds.at - now)} seconds.`) : (zh ? '验收已超时。发布者或接单者可申请仲裁，裁决前资金继续托管。' : 'Verification is overdue. Either participant may request arbitration; funds remain escrowed until a decision.')}</p>
                    {(isPoster || isWorker) && <button className="secondary" disabled={!wallet || !!busy || now < verificationEnds.at} onClick={() => action('Request timeout arbitration', 'escalateVerificationTimeout', [current.id])}>{zh ? "申请超时仲裁" : "Request timeout arbitration"}</button>}
                  </> : <p>{zh ? "当前合约不支持超时仲裁，或暂时无法读取。旧版本需重新部署才能使用。" : "Timeout recovery is unavailable or could not be read. Older contracts need redeployment to support it."}</p>}
                </div>
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
