/**
 * Shared accessors for `script/deployment.json` (the address map Foundry
 * writes during deploy). Test and demo scripts use these instead of
 * hardcoded addresses, since each anvil + deploy cycle gives every contract
 * a different address.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

interface Deployment {
  mockUSDC?: string;
  didRegistry?: string;
  didRegistrar?: string;
  identityRegistry?: string;
  reputationRegistry?: string;
  validationRegistry?: string;
  inviteRegistrar?: string;
  deploymentBlock?: number;
}

let cached: Deployment | null = null;

function loadDeployment(): Deployment {
  if (cached) return cached;
  const deploymentPath = path.resolve(import.meta.dirname, "../../../script/deployment.json");
  cached = JSON.parse(readFileSync(deploymentPath, "utf-8")) as Deployment;
  return cached;
}

/** ERC-3009 mock token (the demo's "USDC"). Throws if absent — fail loudly. */
export function defaultMockUSDC(): `0x${string}` {
  const addr = loadDeployment().mockUSDC;
  if (!addr) throw new Error("mockUSDC not found in script/deployment.json — run forge deploy first");
  return addr as `0x${string}`;
}

/**
 * Block at which the current deployment was made — used as the lower bound
 * for any historical event scan to keep getLogs ranges within RPC limits.
 * Returns 0 when the deployment predates this field (legacy local anvil
 * runs), letting callers fall back to from-genesis scans where it is cheap.
 */
export function defaultDeploymentBlock(): number {
  return loadDeployment().deploymentBlock ?? 0;
}
