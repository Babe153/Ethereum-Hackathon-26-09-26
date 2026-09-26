# ProofPay — AI verified bounty escrow

ProofPay locks a demo reward on HSKChain, lets a human or an AI agent deliver work, and lets an AI verifier check the result against written acceptance criteria. A poster has 60 seconds to dispute an approval. After that, the verifier service calls the public `claim` function to release payment; anyone can call it manually if the service is offline.

**This is a hackathon prototype. `mUSDT` is an unrestricted mint demo token with no value. Do not use real funds.**

GitHub repository: [Babe153/Ethereum-Hackathon-26-09-26](https://github.com/Babe153/Ethereum-Hackathon-26-09-26).

Live testnet demo: [proofpay-hskchain.vercel.app](https://proofpay-hskchain.vercel.app). Task #0 is a clearly labelled scripted rehearsal; tasks #1–#3 used real DeepSeek API calls and paid the workers on chain. The four completed tasks have a read-only, on-chain-hash-verified evidence snapshot bundled into the web app. Keep the demo Mac, API process and HTTPS tunnel online for new submissions and live AI processing during judging.

## What works

- Create a bounty by approving and locking 6-decimal `mUSDT` in `BountyEscrow`.
- Accept and submit as a human via the web app, or let an agent wallet do both.
- Store submission text in the service; keep its URI and Keccak-256 hash on chain.
- AI verifier checks the stored text hash, returns a JSON verdict, and commits the reason hash on chain.
- Show the score and reason in the UI and verify the reason against its on-chain hash.
- Dispute during the challenge window; an arbiter decides where the escrow goes.
- Automatically call `claim` after 60 seconds while the verifier service is running; permissionless manual claim remains available.
- Refund an open or taken bounty after its deadline.

## Stack and layout

| Directory | Purpose |
| --- | --- |
| `contracts/` | Foundry, Solidity 0.8.24, OpenZeppelin ERC-20 and escrow |
| `services/` | Node/TypeScript submission API, agent worker, AI verifier and keeper |
| `web/` | Next.js, RainbowKit, wagmi and viem interface |
| `web/demo-data/` | Verified read-only evidence for completed testnet tasks |
| `shared/` | ABI JSON generated from the compiled contracts |
| `CONTRIBUTING.md` | Team setup and pull request workflow |
| `docs/ARCHITECTURE.md` | Architecture, trust model and roadmap |
| `docs/SUBMISSION.md` | Copy-ready Devfolio draft and demo Q&A |

## Prerequisites

- Node.js 22+, npm and [Foundry](https://getfoundry.sh/)
- Browser wallet (MetaMask or another injected EVM wallet)
- Test HSK for the deployer, agent and verifier wallets from the [official HSKChain faucet guide](https://docs.hskchain.net/docs/Build-on-HashKey-Chain/Tools/Faucet)
- A DeepSeek or OpenAI API key for actual AI execution. `DEMO_MODE=1` runs a scripted dry run and labels its output as such.

HSKChain testnet: chain ID **133**, RPC `https://testnet.hsk.xyz`, live explorer `https://testnet-explorer.hskchain.net`. The [official quickstart](https://docs.hskchain.net/docs/Developer-QuickStart) still lists `testnet-explorer.hsk.xyz`, which did not resolve on 26 September 2026; the [Chainlist entry](https://chainid.network/chain/133/) lists the working domain. RPC chain ID and the working explorer were checked live.

Verified HSKChain testnet deployment (26 September 2026):

| Contract | Address |
| --- | --- |
| BountyEscrow | [`0xE0c95F19d607bA0B3100F1c942589B63D4f3Ea03`](https://testnet-explorer.hskchain.net/address/0xE0c95F19d607bA0B3100F1c942589B63D4f3Ea03) |
| MockUSDT | [`0x41c4986C36Af380d0E5Ba910Bd04947574918ca8`](https://testnet-explorer.hskchain.net/address/0x41c4986C36Af380d0E5Ba910Bd04947574918ca8) |

Task #0 completed a testnet dry run with a scripted verdict: [create transaction](https://testnet-explorer.hskchain.net/tx/0x7380cbf5494162c17aaa7459f2e770d4e9dcd6424020eb2b18e28df2990d9d45), [verdict transaction](https://testnet-explorer.hskchain.net/tx/0xf5fe693ddbc5df8767c1c0b44909a8f52d9c1914ce1c2b5e10ab08d627b652a3), [automatic payout](https://testnet-explorer.hskchain.net/tx/0xd40a90d3570a8b4b363e0202fbb4e163b19a4661d821353a94141c34ff4611f7). The worker received 100 demo mUSDT. This is **not** evidence of a live model call.

Task #1 used `deepseek-flash` in non-thinking mode for both worker and verifier: [create transaction](https://testnet-explorer.hskchain.net/tx/0xab63f82038aeff8ede9e14b57bf94fb9e302a52c7ec410dcd1bfdf336a04a002), [submission](https://testnet-explorer.hskchain.net/tx/0xf191c685a7d83d8931a577ffbfbeb3f02653c6e86957863f423b0a3dbdf286ca), [verdict](https://testnet-explorer.hskchain.net/tx/0x96245213f859c0a2be4923b592335e8ec496ce1b2d8379b96722353f886b8a84), [automatic payout](https://testnet-explorer.hskchain.net/tx/0x9565c2d4f059c54d3a91201b0de488310c5277dd30a97ffee1b427f5055326a6). The verifier scored it 95/100, its displayed reason matched the on-chain hash, and the worker's balance rose to 200 demo mUSDT across tasks #0 and #1.

**Recommended judging example: task #3.** A more specific factual task was completed by DeepSeek, scored 100/100 with an evidence-based reason, and paid automatically: [create](https://testnet-explorer.hskchain.net/tx/0xae1b84821d0d93f708bd2bc2197fc06bfe4f474d073c3bd0cc1760cc352d4631), [submit](https://testnet-explorer.hskchain.net/tx/0x802dfb2fa9c7066948e29f143510ea57f10bf0e613d77af3c02534e923e8e783), [verify](https://testnet-explorer.hskchain.net/tx/0xac4012e94331fdcc6a8e456aed83ff676d0fa2065a60116a174e321c8aac4c3c), [payout](https://testnet-explorer.hskchain.net/tx/0x4f0dd71eec45441cd7ab8c25b80542fedd53bacd5d630603394f561f8775b3d2). The displayed reason matched the on-chain hash, and the worker's final balance was 400 demo mUSDT across four test tasks.

## Install and test

```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts@v5.4.0 foundry-rs/forge-std@v1.14.0 --no-git
forge test -vv
cd ../services && npm ci && npm run typecheck
cd ../web && npm ci && npm run build
```

If Foundry is installed at `~/.foundry/bin` but not on your `PATH`, prepend that directory to `PATH` for the terminal session.

## Deploy to HSKChain testnet

1. From `services/`, run `npm run wallets` to create four fresh **demo-only** wallets in the root `.env`. It refuses to overwrite an existing file. Or copy `.env.example` and enter your own demo keys and addresses.
2. Fund the printed **deployer**, **agent**, and **verifier** addresses with test HSK. Keep the arbiter wallet accessible for disputes.
3. In `.env`, set `DEEPSEEK_API_KEY` for real DeepSeek calls (`DEEPSEEK_MODEL=deepseek-flash`), or `OPENAI_API_KEY` for OpenAI. DeepSeek takes priority if both are present. Keep `DEMO_MODE=0` for real calls. To rehearse without a key, set `DEMO_MODE=1` and state clearly that the verdict is scripted. Do not put a key in the repository or browser environment.
4. Run `bash scripts/deploy-testnet.sh` from the repository root. It checks the RPC chain ID, verifier key and deployer balance before broadcasting.
5. Copy the two deployed addresses printed by Foundry into `.env` as `TOKEN_ADDRESS` and `ESCROW_ADDRESS`, and also into `NEXT_PUBLIC_TOKEN_ADDRESS` and `NEXT_PUBLIC_ESCROW_ADDRESS`.
6. From `services/`, run `npm run fund-wallets` to send 0.01 test HSK to each agent, verifier and arbiter wallet (it skips wallets already holding at least 0.005 HSK).
7. Start four terminals:

```bash
cd services && npm run server
cd services && npm run agent
cd services && npm run verifier
cd web && npm run dev
```

Open `http://localhost:3000`, connect a browser wallet on HSKChain testnet and get test HSK for its gas. The page can mint its own `mUSDT` demo balance. A real WalletConnect project ID is optional for injected wallets; this MVP's RainbowKit list includes browser wallets only.

For a repeatable terminal rehearsal using the deployer wallet, run `cd services && npm run seed`. It mints or reuses 100 demo mUSDT, approves the escrow, and posts a 30-minute task. The agent and verifier processes then pick it up. To change the task wording, set `DEMO_CRITERIA` before running the command.

If a poster disputes a task, the demo arbiter can run `bash scripts/resolve-dispute.sh BOUNTY_ID worker` to pay the worker, or replace `worker` with `poster` to refund the poster. This signs with the locally stored arbiter key.

The deployed Next.js app uses its `/api` route. For completed paid tasks, it serves a bundled snapshot generated only after checking the submission and reason hashes against HSKChain. To refresh that snapshot after another payout, run `cd services && npm run snapshot` on the demo Mac and redeploy `web/`. New submissions still reach the local service through the proxy: set the web project's `SERVICE_UPSTREAM_URL` to its public HTTPS URL and `NEXT_PUBLIC_SERVICE_URL=/api` at build time. The proxy supplies the ngrok bypass header for the current temporary tunnel. The UI rewrites local submission URLs to `/api/submissions/:id` for viewing; the locally running verifier still fetches the original `localhost` URI from the chain. Keep the API and JSON store online for interactive demonstrations. This storage is not durable production infrastructure.

## Three-minute presentation

1. “Freelancers can finish work and still wait for a client to approve payment.”
2. Mint demo USDT, create a 100 mUSDT task with concrete acceptance criteria, and show the escrow transaction.
3. Show the agent process accepting and submitting, and the verifier process recording its result. Open the task: score, reason and matching on-chain reason hash are visible.
4. Show the 60-second challenge timer. Explain that the poster can dispute and the arbiter decides in that case.
5. Watch the verifier keeper call `claim`, then show the worker's token balance and the transaction in the explorer.

**Demo fallback:** If the model API is unavailable, use `DEMO_MODE=1`; say “scripted dry run” and do not present the verdict as an AI call. If the keeper is unavailable, use the page's “Release payment” button after 60 seconds.

## Submission checklist

- Add the public GitHub repository and [live demo](https://proofpay-hskchain.vercel.app) to the submission.
- Add both verified HSKChain testnet contract addresses and explorer links to the submission.
- Keep the local API and HTTPS tunnel running for new submissions and live AI work; completed tasks remain readable from the bundled snapshot.
- Include `docs/ARCHITECTURE.md` as technical documentation.
- Select the **AI x Ethereum & Agent Economy** EAG track and the HSK Chain track if the submission form permits both; ask the organizer what they mean by additional “HSK Chain technology integration.”
- Submit before the local event's **14:00 Sydney time** cutoff. The [organizer's event page](https://luma.com/49iyovqf) lists the 3-minute demo and 2-minute Q&A format.

## Prototype limitations

The verifier and arbiter are trusted keys. The model can make mistakes, and a reason hash proves only that a stored explanation matches the committed bytes, not that the verdict or numeric score is correct. A submitted task can become stuck if the verifier never responds; this prototype has no timeout arbitration path for `Submitted`. The API has local file storage and no abuse protection. The bundled snapshot keeps completed examples readable, but does not store new work when the local service is offline. Before handling real funds, add independent security review, a robust dispute process, durable content storage, and a recovery path for unavailable verifiers.
