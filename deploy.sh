#!/bin/bash
# Codatta Demo — One-click deployment script
# Usage: bash deploy.sh [SERVER_IP]
#
# Starts: Anvil (8086) → Deploy contracts → Invite Service (4060) → Web (5173)

set -e

SERVER_IP="${1:-47.236.240.1}"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

echo "============================================"
echo "  Codatta Demo Deployment"
echo "  Server: $SERVER_IP"
echo "============================================"

# ── Kill existing processes ──────────────────────────────
echo "[1/6] Cleaning up old processes..."
pkill -f "anvil" 2>/dev/null || true
pkill -f "tsx src/invite-service" 2>/dev/null || true
pkill -f "vite preview" 2>/dev/null || true
sleep 2

# ── Start Anvil ──────────────────────────────────────────
echo "[2/6] Starting Anvil on port 8086..."
nohup anvil --host 0.0.0.0 --port 8086 --block-time 1 > /tmp/anvil.log 2>&1 &
sleep 3

if curl -s http://127.0.0.1:8086 -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' | grep -q "0x7a69"; then
  echo "  ✓ Anvil running on port 8086"
else
  echo "  ✗ Anvil failed to start"
  exit 1
fi

# ── Deploy contracts ─────────────────────────────────────
echo "[3/6] Deploying contracts..."
rm -rf broadcast cache
forge script script/Deploy.s.sol:Deploy --rpc-url http://127.0.0.1:8086 --broadcast > /tmp/deploy.log 2>&1

if [ -f script/deployment.json ]; then
  echo "  ✓ Contracts deployed"
  cat script/deployment.json
else
  echo "  ✗ Deployment failed"
  cat /tmp/deploy.log
  exit 1
fi

# ── Setup agent .env ─────────────────────────────────────
echo "[4/6] Configuring agent..."
cd agent
cp .env.example .env 2>/dev/null || true

# Sync contract addresses
bash sync-env.sh

# Ensure all config present
grep -q "INVITE_SERVICE_URL" .env || echo "INVITE_SERVICE_URL=http://127.0.0.1:4060" >> .env
grep -q "INVITE_REGISTRAR" .env || echo "INVITE_REGISTRAR=$(python3 -c "import json; print(json.load(open('../script/deployment.json'))['inviteRegistrar'])")" >> .env

# Update RPC URL
sed -i "s|LOCAL_RPC_URL=.*|LOCAL_RPC_URL=http://127.0.0.1:8086|" .env

npm install --silent 2>/dev/null
echo "  ✓ Agent configured"

# ── Start Invite Service ─────────────────────────────────
echo "[5/6] Starting Invite Service on port 4060..."
nohup npx tsx src/invite-service/index.ts > /tmp/invite-service.log 2>&1 &
sleep 3

if curl -s http://127.0.0.1:4060/health | grep -q "ok"; then
  echo "  ✓ Invite Service running"
else
  echo "  ✗ Invite Service failed to start"
  tail -10 /tmp/invite-service.log
  exit 1
fi

# ── Build & Start Web ────────────────────────────────────
echo "[6/6] Building and starting Web Dashboard..."
cd ../web

# Write web .env
cat > .env << EOF
VITE_INVITE_SERVICE_URL=http://${SERVER_IP}:4060
VITE_RPC_URL=http://${SERVER_IP}:8086
VITE_CHAIN_ID=31337
VITE_CHAIN_NAME=Codatta Testnet
VITE_DEFAULT_PORT_WEB=4021
VITE_DEFAULT_PORT_MCP=4022
VITE_DEFAULT_PORT_A2A=4023
EOF

npm install --silent 2>/dev/null
npm run build
nohup npx vite preview --host 0.0.0.0 --port 5173 > /tmp/web.log 2>&1 &
sleep 2

echo ""
echo "============================================"
echo "  ✅ Deployment Complete!"
echo "============================================"
echo ""
echo "  Web Dashboard:    http://${SERVER_IP}:5173"
echo "  Invite Service:   http://${SERVER_IP}:4060"
echo "  Anvil RPC:        http://${SERVER_IP}:8086"
echo ""
echo "  MetaMask Setup:"
echo "    Network Name: Codatta Testnet"
echo "    RPC URL:      http://${SERVER_IP}:8086"
echo "    Chain ID:     31337"
echo "    Symbol:       ETH"
echo ""
echo "  Test Account (Anvil #0):"
echo "    Private Key:  0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
echo "    Address:      0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
echo ""
echo "  Quick Start:"
echo "    1. Open http://${SERVER_IP}:5173"
echo "    2. Import test account to MetaMask"
echo "    3. Use Faucet to get ETH"
echo "    4. Register Agent via + New Agent"
echo ""
echo "  Logs:"
echo "    tail -f /tmp/anvil.log"
echo "    tail -f /tmp/invite-service.log"
echo "    tail -f /tmp/web.log"
echo ""
