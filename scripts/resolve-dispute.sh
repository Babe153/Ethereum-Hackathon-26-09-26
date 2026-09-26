#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: bash scripts/resolve-dispute.sh BOUNTY_ID worker|poster" >&2
  exit 1
fi
if [[ ! "$1" =~ ^[0-9]+$ || ( "$2" != "worker" && "$2" != "poster" ) ]]; then
  echo "Usage: bash scripts/resolve-dispute.sh BOUNTY_ID worker|poster" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FOUNDRY_BIN="${FOUNDRY_BIN:-$HOME/.foundry/bin}"
set -a
source "$ROOT_DIR/.env"
set +a

if [[ "$($FOUNDRY_BIN/cast chain-id --rpc-url "$RPC_URL")" != "133" ]]; then
  echo "Configured RPC is not HSKChain testnet (133)." >&2
  exit 1
fi
derived_arbiter="$($FOUNDRY_BIN/cast wallet address --private-key "$ARBITER_PRIVATE_KEY")"
if [[ -z "${ESCROW_ADDRESS:-}" || "$(printf '%s' "$derived_arbiter" | tr '[:upper:]' '[:lower:]')" != "$(printf '%s' "$ARBITER_ADDRESS" | tr '[:upper:]' '[:lower:]')" ]]; then
  echo "Escrow address missing or arbiter key/address mismatch." >&2
  exit 1
fi

to_worker=false
if [[ "$2" == "worker" ]]; then to_worker=true; fi
"$FOUNDRY_BIN/cast" send "$ESCROW_ADDRESS" 'resolve(uint256,bool)' "$1" "$to_worker" --rpc-url "$RPC_URL" --private-key "$ARBITER_PRIVATE_KEY"
