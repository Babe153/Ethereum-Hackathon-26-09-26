# Working together on ProofPay

This [team repository](https://github.com/Babe153/Ethereum-Hackathon-26-09-26) is the shared source for the hackathon submission. Create a branch from `main`, keep one focused change per pull request, and ask a teammate to review before merging. Do not commit `.env`, wallet keys, API keys, or `services/data`.

## Run the public demo locally

```bash
cd web
cp .env.example .env.local
npm ci
npm run dev
```

Open `http://localhost:3000`. The four completed testnet tasks and their verified evidence are bundled with the web app, so teammates can inspect them without running the submission service. Creating new tasks still needs a funded testnet wallet; new submissions and live AI processing need the Node service, agent and verifier running.

## Validate a change

```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts@v5.4.0 foundry-rs/forge-std@v1.14.0 --no-git
forge test -q
cd ../services && npm ci && npm run typecheck
cd ../web && npm ci && npm run typecheck && npm run build
```

GitHub Actions runs these checks on pushes and pull requests. Contract ABI files in `shared/` and `web/abi/` must match when contracts change.

Each teammate should use their own local `.env` and demo wallets. The deployed testnet contract has fixed verifier and arbiter addresses; coordinate with the demo operator for live tasks instead of exchanging private keys. Coordinate production Vercel updates with the team so the public demo remains available during judging.
