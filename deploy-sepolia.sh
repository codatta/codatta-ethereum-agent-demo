#!/bin/bash
# Deploy Codatta DID + ERC-8004 contracts to Base Sepolia.
# Skips Anvil and MockERC3009 — agent uses the real USDC address from .env.
#
# Usage: bash deploy-sepolia.sh
#
# Required env (read from agent/.env):
#   SEPOLIA_RPC_URL        Base Sepolia RPC endpoint
#   DEPLOYER_PRIVATE_KEY   funded deployer key (needs Base Sepolia ETH for gas)

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

ENV_FILE="$PROJECT_DIR/agent/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "✗ $ENV_FILE not found. Copy agent/.env.example → agent/.env and fill in"
  echo "  SEPOLIA_RPC_URL and DEPLOYER_PRIVATE_KEY first."
  exit 1
fi

# Load env for this shell only.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [ -z "${SEPOLIA_RPC_URL:-}" ]; then
  echo "✗ SEPOLIA_RPC_URL is empty in $ENV_FILE"
  exit 1
fi

if [ -z "${DEPLOYER_PRIVATE_KEY:-}" ]; then
  echo "✗ DEPLOYER_PRIVATE_KEY is empty in $ENV_FILE"
  exit 1
fi

echo "============================================"
echo "  Codatta — Base Sepolia deployment"
echo "  RPC: $SEPOLIA_RPC_URL"
echo "============================================"

# Sanity check: chainId 84532 (Base Sepolia)
CHAIN_ID_HEX=$(curl -s "$SEPOLIA_RPC_URL" -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
  | python3 -c "import json,sys;print(json.load(sys.stdin).get('result',''))" 2>/dev/null || true)
if [ "$CHAIN_ID_HEX" != "0x14a34" ]; then
  echo "⚠ Warning: RPC returned chainId=$CHAIN_ID_HEX (expected 0x14a34 / 84532)"
  echo "  Continuing anyway — abort with Ctrl-C if this is wrong."
  sleep 3
fi

echo "[1/2] Deploying contracts (SKIP_MOCK_USDC=true)..."
rm -rf broadcast cache
SKIP_MOCK_USDC=true \
DEPLOYER_PRIVATE_KEY="$DEPLOYER_PRIVATE_KEY" \
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --broadcast \
  --slow

if [ ! -f script/deployment.json ]; then
  echo "✗ Deployment failed — script/deployment.json not produced"
  exit 1
fi

echo ""
echo "  ✓ Contracts deployed:"
cat script/deployment.json
echo ""

if python3 -c "import json,sys; d=json.load(open('script/deployment.json')); sys.exit(0 if 'mockUSDC' in d else 1)" 2>/dev/null; then
  echo "✗ Unexpected: deployment.json contains mockUSDC field on Sepolia run."
  echo "  Aborting before sync-env to avoid overwriting USDC_ADDRESS."
  exit 1
fi

echo "[2/2] Syncing contract addresses to agent/.env..."
cd agent
bash sync-env.sh
cd "$PROJECT_DIR"

echo ""
echo "============================================"
echo "  ✅ Base Sepolia deployment complete"
echo "============================================"
echo ""
echo "Next steps:"
echo "  1. Verify USDC_ADDRESS in agent/.env points to real Base Sepolia USDC"
echo "     (Circle official: 0x036CbD53842c5426634e7929541eC2318f3dCF7e)"
echo "  2. Fund provider wallet with Base Sepolia ETH (for settle gas)"
echo "  3. Fund client wallet with Base Sepolia USDC (Circle faucet)"
echo "  4. Start invite-service + provider, run a paid annotate"
echo ""
