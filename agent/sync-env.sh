#!/bin/bash
# Sync contract addresses from deployment.json to .env
# Usage: ./sync-env.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOYMENT="$SCRIPT_DIR/../script/deployment.json"
ENV_FILE="$SCRIPT_DIR/.env"

if [ ! -f "$DEPLOYMENT" ]; then
  echo "Error: $DEPLOYMENT not found. Deploy contracts first."
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  cp "$SCRIPT_DIR/.env.example" "$ENV_FILE"
  echo "Created .env from .env.example"
fi

# Read addresses from deployment.json
DID_REGISTRY=$(python3 -c "import json; print(json.load(open('$DEPLOYMENT'))['didRegistry'])")
DID_REGISTRAR=$(python3 -c "import json; print(json.load(open('$DEPLOYMENT'))['didRegistrar'])")
INVITE_REGISTRAR=$(python3 -c "import json; print(json.load(open('$DEPLOYMENT'))['inviteRegistrar'])")
IDENTITY_REGISTRY=$(python3 -c "import json; print(json.load(open('$DEPLOYMENT'))['identityRegistry'])")
REPUTATION_REGISTRY=$(python3 -c "import json; print(json.load(open('$DEPLOYMENT'))['reputationRegistry'])")
VALIDATION_REGISTRY=$(python3 -c "import json; print(json.load(open('$DEPLOYMENT'))['validationRegistry'])")
# mockUSDC is only present when deploying against a local Anvil chain.
# On Base Sepolia / mainnet the agent uses the real USDC address from .env,
# so we leave USDC_ADDRESS untouched when the field is missing.
MOCK_USDC=$(python3 -c "import json; print(json.load(open('$DEPLOYMENT')).get('mockUSDC',''))")
# deploymentBlock is the block at which this Deploy run completed. Runtime
# services use it as the lower bound for any historical event scan so they
# don't hit RPC getLogs range limits. Older deployment.json files lack the
# field — keep .env value untouched in that case.
DEPLOYMENT_BLOCK=$(python3 -c "import json; print(json.load(open('$DEPLOYMENT')).get('deploymentBlock',''))")

# Update .env (replace existing values or append)
update_env() {
  local key=$1 val=$2
  if grep -q "^${key}=" "$ENV_FILE"; then
    # Compatible with both macOS and Linux sed
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
    else
      sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
    fi
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

update_env "DID_REGISTRY" "$DID_REGISTRY"
update_env "DID_REGISTRAR" "$DID_REGISTRAR"
update_env "INVITE_REGISTRAR" "$INVITE_REGISTRAR"
update_env "IDENTITY_REGISTRY" "$IDENTITY_REGISTRY"
update_env "REPUTATION_REGISTRY" "$REPUTATION_REGISTRY"
update_env "VALIDATION_REGISTRY" "$VALIDATION_REGISTRY"

echo "Updated .env with addresses from deployment.json:"
echo "  DID_REGISTRY=$DID_REGISTRY"
echo "  DID_REGISTRAR=$DID_REGISTRAR"
echo "  INVITE_REGISTRAR=$INVITE_REGISTRAR"
echo "  IDENTITY_REGISTRY=$IDENTITY_REGISTRY"
echo "  REPUTATION_REGISTRY=$REPUTATION_REGISTRY"
echo "  VALIDATION_REGISTRY=$VALIDATION_REGISTRY"

if [ -n "$MOCK_USDC" ]; then
  update_env "USDC_ADDRESS" "$MOCK_USDC"
  echo "  USDC_ADDRESS=$MOCK_USDC (from mockUSDC)"
else
  echo "  USDC_ADDRESS: preserved (no mockUSDC in deployment.json — assuming real network)"
fi

if [ -n "$DEPLOYMENT_BLOCK" ]; then
  update_env "DEPLOYMENT_BLOCK" "$DEPLOYMENT_BLOCK"
  echo "  DEPLOYMENT_BLOCK=$DEPLOYMENT_BLOCK"
else
  echo "  DEPLOYMENT_BLOCK: preserved (no deploymentBlock in deployment.json — re-run forge after pulling latest Deploy.s.sol)"
fi
