# Timeout recovery and live service health

## Behavior

- Every successful submission records its timestamp. After **10 minutes**, poster or worker can call `escalateVerificationTimeout(id)` if it is still Submitted. Anyone else is rejected. The task becomes Disputed; funds remain escrowed. The existing arbiter resolves payment or refund. A late verifier cannot overwrite a dispute. Resubmission starts a new 10-minute timer.
- The UI reads timeout capability from the contract. Old deployments remain readable but display an unavailable/redeployment message instead of an unusable button. A displayed countdown is approximate local time; contract block time enforces eligibility.
- Agent and verifier write atomic local heartbeat records every 5 seconds after startup checks pass. The API reports each separately. Heartbeats expire after 30 seconds. Failed work/scans report degraded; a subsequent error-free scan recovers. Online is process liveness, not proof that all model/RPC operations will succeed.
- The page polls health every 8 seconds. API timeout/non-success means API unreachable and workers unknown, never falsely offline/online. Older API responses without worker telemetry show unknown. Health is never read from the completed-task snapshot.
- API, agent and verifier must run from the same `services/` directory on the same host and share `data/health`. A different host requires a separate authenticated reporting design.

## Tests

From `services/`:

```sh
npm ci
npm run compile
npm run typecheck
npm test
```

The local EVM tests require no keys or external RPC. Foundry tests also cover timeout escalation. `npm run compile` synchronizes both ABI copies. From `web/`, run `npm ci && npm run build`.

## Rollout

1. These are local code changes, not an upgrade to the old immutable deployed escrow. Old locked funds stay under the old contract's rules; they cannot be repaired by a frontend update.
2. Deploy the new escrow with the existing deployment workflow; record new token/escrow addresses. Keep old deployment records and pending tasks accessible separately.
3. Stop old agent/verifier processes before changing their configuration. Update root `ESCROW_ADDRESS`, `TOKEN_ADDRESS`, and matching `NEXT_PUBLIC_*` values plus the Vercel environment. Use a fresh/archive-separated service data directory for a new deployment because reason records are keyed by task ID.
4. Restart API, agent and verifier from `services/`; rebuild/redeploy web. Verify all three statuses and the deployed contract's `verificationTimeout()` getter (600 seconds).
5. Old completed-task snapshots are now scoped to chain and escrow address, so they cannot mask new task IDs. Export a new snapshot after successful new-chain tasks and redeploy when ready.
6. Rehearse: stop verifier, submit as a human, observe its heartbeat become offline, wait 10 minutes, escalate as poster/worker, resolve as arbiter. Restart verifier and check it cannot override the resolved/disputed task.

Arbiter availability remains a trust assumption. This change supplies access to arbitration, not guaranteed resolution if the arbiter also disappears.


## Poster confirmation and immediate payout

The updated contract exposes `supportsPosterConfirmation()` and `confirmAndPay(id)`.
Only the task poster can confirm, and only from `Approved`. Confirmation immediately
pays the full escrow to the assigned worker, marks the task `Paid`, and waives the
remaining challenge window. Submitted, rejected, disputed and settled tasks cannot
use this path. The permissionless delayed `claim` and verifier keeper remain unchanged.

Deploy a new escrow to enable this capability, synchronize the service and web escrow
addresses, and restart services / rebuild the web app. Existing tasks and funds remain
in the old escrow; preserve access to that deployment to finish them. They cannot be
migrated simply by changing configuration. The UI probes the capability and retains
delayed settlement when support cannot be confirmed. The deployment below followed
the initial code change.

Validation: the local EVM test covers poster-only authorization, early payout, worker
balance changes, rejection of repeat payouts and exclusion of disputed/unverified tasks.

### September 26 testnet rollout

- Existing token: `0x41c4986C36Af380d0E5Ba910Bd04947574918ca8`.
- Previous escrow: `0xE0c95F19d607bA0B3100F1c942589B63D4f3Ea03`; existing tasks remain there.
- Historical tasks remain available at https://proofpay-hskchain-legacy.vercel.app.
- New escrow: `0x989c71426552fF963e2A6647c05565003A922ff5`, deployed with
  `contracts/script/DeployEscrowOnly.s.sol` in transaction
  `0x07d6c03774f9ce3e97a31f9a3c5ec3e1d54b1accafb45052af72b497a18f3e2c`.
- The new service uses port 8788 and `services/data/v2`, with the existing tunnel's
  `/v2/` path forwarded by the previous API on port 8787. Run
  `bash scripts/start-v2-services.sh --foreground` from the repository root.
- The web proxy for the new deployment needs `SERVICE_UPSTREAM_PREFIX=/v2`.
  The historical deployment leaves this variable unset.
