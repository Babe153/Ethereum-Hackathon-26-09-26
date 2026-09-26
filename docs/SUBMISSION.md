# Devfolio submission draft

The public repository, live web page, contract source verification, and testnet payouts were checked on 26 September 2026. Task #0 is a scripted dry run; tasks #1–#3 used real DeepSeek API calls for worker and verifier. Show task #3 to judges: its factual output, specific 100/100 reason, hash match, and payout are visible on the live page. The API behind the page depends on a temporary tunnel from the demo Mac, so keep it running through judging.

## Project name

ProofPay — AI Verified Bounty Escrow on HSKChain

## One-line pitch

Fund work up front, let an AI agent deliver and an AI reviewer verify it, then release payment automatically after a short challenge window.

## Project description

Freelancers and AI agents can finish work but still depend on a client choosing to approve payment. ProofPay makes the payment rule explicit before work begins. A poster writes acceptance criteria and locks demo USDT in an HSKChain escrow contract. A human or AI worker accepts and submits a deliverable. An AI reviewer checks it against the criteria, records a verdict and commits a hash of its reason on chain. The poster has 60 seconds to dispute an approval. If nobody disputes, a keeper calls the permissionless claim function and the worker is paid. An arbiter wallet resolves contested tasks in this prototype.

## Tracks

- EAG: AI x Ethereum & Agent Economy
- HSKChain: AI Agents / AI × Web3 / Payments (choose the available matching HSK Chain track)

## HSKChain integration

The escrow and demo ERC-20 are Solidity contracts on HSKChain testnet (chain ID 133). Poster, agent, verifier and arbiter use HSKChain wallets. Task creation, token custody, acceptance, submissions, verdict hashes, disputes and payouts are transactions or events on HSKChain. The UI links to the HSKChain explorer. The app does not claim to use additional HSKChain-specific infrastructure beyond the chain itself unless confirmed with organizers.

## What to show in the three-minute demo

1. Post a task and lock 100 demo USDT.
2. Show the agent wallet accepting and submitting.
3. Show the verifier score, reason and hash match.
4. Show the 60-second challenge window and possible dispute.
5. Show the keeper's payout transaction and worker token balance.

## Links to fill in

- GitHub: https://github.com/Babe153/Ethereum-Hackathon-26-09-26
- Live demo: https://proofpay-hskchain.vercel.app
- HSKChain testnet escrow: [0xE0c95F19d607bA0B3100F1c942589B63D4f3Ea03](https://testnet-explorer.hskchain.net/address/0xE0c95F19d607bA0B3100F1c942589B63D4f3Ea03)
- HSKChain testnet demo token: [0x41c4986C36Af380d0E5Ba910Bd04947574918ca8](https://testnet-explorer.hskchain.net/address/0x41c4986C36Af380d0E5Ba910Bd04947574918ca8)
- Testnet payout: [claim transaction for task #0](https://testnet-explorer.hskchain.net/tx/0xd40a90d3570a8b4b363e0202fbb4e163b19a4661d821353a94141c34ff4611f7)
- Real-AI testnet payout: [claim transaction for task #1](https://testnet-explorer.hskchain.net/tx/0x9565c2d4f059c54d3a91201b0de488310c5277dd30a97ffee1b427f5055326a6)
- Recommended demo transaction: [task #3 automatic payout](https://testnet-explorer.hskchain.net/tx/0x4f0dd71eec45441cd7ab8c25b80542fedd53bacd5d630603394f561f8775b3d2)
- Technical documentation: `docs/ARCHITECTURE.md` in the repository

## Common questions

**Can the AI judge incorrectly?** Yes. The poster can dispute during the challenge window. A trusted arbiter wallet makes the final decision in this demo. The reason hash makes the displayed explanation tamper evident but does not prove the judgment is right.

**Is the AI verifier centralized?** Yes. The prototype uses one verifier key. A production design would use multiple independent verifiers or attested execution and a stronger arbitration process.

**Why use a blockchain?** The reward is locked before work starts, and release conditions are enforced by a contract rather than the platform. The worker or anyone else can call `claim` after the challenge window, even if the platform UI is offline.

**Is this real USDT?** No. `mUSDT` is an unrestricted mint token for testnet demonstration only and has no monetary value.

## Current validation status

Foundry tests, TypeScript checks, Next.js build, browser rendering, and local Anvil and HSKChain testnet transaction flows passed. Task #0 used a labelled scripted verdict. Tasks #1–#3 used real DeepSeek calls and paid 100 demo mUSDT each after the challenge window. Task #3 scored 100/100; its output accurately described the contract flow. The public Vercel page displayed all four paid tasks, reasons matching on-chain hashes, and working submission links. Its API returned reasons and submissions through the temporary tunnel. OpenAI was not tested.
