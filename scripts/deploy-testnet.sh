#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FOUNDRY_BIN="${FOUNDRY_BIN:-$HOME/.foundry/bin}"

if [[ ! -f "$ROOT_DIR/.env" ]]; then
  echo "Missing .env. Run: cd services && npm run wallets (or copy .env.example and fill it)." >&2
  exit 1
fi

set -a
source "$ROOT_DIR/.env"
set +a

if [[ "${CHAIN_ID:-}" != "133" || "${RPC_URL:-}" != "https://testnet.hsk.xyz" ]]; then
  echo "This script deploys only to HSKChain testnet (chain 133, https://testnet.hsk.xyz)." >&2
  exit 1
fi
actual_chain="$($FOUNDRY_BIN/cast chain-id --rpc-url "$RPC_URL")"
if [[ "$actual_chain" != "133" ]]; then
  echo "RPC returned chain ID $actual_chain, expected 133." >&2
  exit 1
fi
deployer="$($FOUNDRY_BIN/cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")"
derived_verifier="$($FOUNDRY_BIN/cast wallet address --private-key "$VERIFIER_PRIVATE_KEY")"
if [[ "$(printf '%s' "$derived_verifier" | tr '[:upper:]' '[:lower:]')" != "$(printf '%s' "$VERIFIER_ADDRESS" | tr '[:upper:]' '[:lower:]')" ]]; then
  echo "VERIFIER_ADDRESS does not match VERIFIER_PRIVATE_KEY." >&2
  exit 1
fi
balance="$($FOUNDRY_BIN/cast balance "$deployer" --rpc-url "$RPC_URL")"
if [[ "$balance" == "0" ]]; then
  echo "Deployer $deployer has no test HSK. Fund it from the official faucet first." >&2
  exit 1
fi

echo "Deploying demo contracts to HSKChain testnet from $deployer"
cd "$ROOT_DIR/contracts"
"$FOUNDRY_BIN/forge" script script/Deploy.s.sol:Deploy --rpc-url "$RPC_URL" --broadcast
echo "Copy TOKEN_ADDRESS and ESCROW_ADDRESS above into .env and NEXT_PUBLIC_* equivalents, then start the services and web app."
