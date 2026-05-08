// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {DIDRegistry} from "codatta-did/DIDRegistry.sol";
import {DIDRegistrar} from "codatta-did/DIDRegistrar.sol";
import {InviteRegistrar} from "codatta-did/InviteRegistrar.sol";
import {IdentityRegistry} from "../src/erc8004/IdentityRegistry.sol";
import {ReputationRegistry} from "../src/erc8004/ReputationRegistry.sol";
import {ValidationRegistry} from "../src/erc8004/ValidationRegistry.sol";
import {MockERC3009} from "../src/erc-3009/MockERC3009.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        // SKIP_DID=true → reuse existing DID stack (DIDRegistry + DIDRegistrar +
        // InviteRegistrar already deployed elsewhere). Caller passes the three
        // addresses via env. We do NOT touch updateRegistrars in this mode —
        // assumes the existing DIDRegistry already has both registrars wired.
        bool skipDid = vm.envOr("SKIP_DID", false);

        vm.startBroadcast(deployerKey);

        address didRegistryAddr;
        address didRegistrarAddr;
        address inviteRegistrarAddr;

        if (skipDid) {
            didRegistryAddr = vm.envAddress("DID_REGISTRY");
            didRegistrarAddr = vm.envAddress("DID_REGISTRAR");
            inviteRegistrarAddr = vm.envAddress("INVITE_REGISTRAR");
            console.log("DIDRegistry (existing):", didRegistryAddr);
            console.log("DIDRegistrar (existing):", didRegistrarAddr);
            console.log("InviteRegistrar (existing):", inviteRegistrarAddr);
        } else {
            // Codatta DID (UUPS proxy)
            DIDRegistry didImpl = new DIDRegistry();
            ERC1967Proxy didProxy = new ERC1967Proxy(
                address(didImpl),
                abi.encodeWithSelector(DIDRegistry.initialize.selector, deployer)
            );
            didRegistryAddr = address(didProxy);
            console.log("DIDRegistry (proxy):", didRegistryAddr);

            DIDRegistrar didRegistrar = new DIDRegistrar(didRegistryAddr);
            didRegistrarAddr = address(didRegistrar);
            console.log("DIDRegistrar:", didRegistrarAddr);

            // Invite Registrar (deployer is the invite signer for demo)
            InviteRegistrar inviteRegistrar = new InviteRegistrar(didRegistryAddr, deployer);
            inviteRegistrarAddr = address(inviteRegistrar);
            console.log("InviteRegistrar:", inviteRegistrarAddr);

            // Authorize both registrars
            address[] memory addings = new address[](2);
            addings[0] = didRegistrarAddr;
            addings[1] = inviteRegistrarAddr;
            address[] memory removings = new address[](0);
            DIDRegistry(didRegistryAddr).updateRegistrars(addings, removings);
        }

        // ERC-8004
        IdentityRegistry identity = new IdentityRegistry();
        console.log("IdentityRegistry:", address(identity));

        ReputationRegistry reputation = new ReputationRegistry(address(identity));
        console.log("ReputationRegistry:", address(reputation));

        ValidationRegistry validation = new ValidationRegistry(address(identity));
        console.log("ValidationRegistry:", address(validation));

        // MockERC3009 - ERC-3009 token for x402 payments (skip on real networks
        // where USDC already exists; agent reads USDC_ADDRESS from .env directly).
        bool skipMockUsdc = vm.envOr("SKIP_MOCK_USDC", false);
        address mockUSDC;
        if (!skipMockUsdc) {
            mockUSDC = address(new MockERC3009());
            console.log("MockERC3009 (USDC):", mockUSDC);
        }

        vm.stopBroadcast();

        // Write deployment addresses. `deploymentBlock` is the floor for any
        // off-chain consumer that needs to backfill events (e.g. invite-service
        // reconciling InviteRegistered nonces) — without it, RPC providers
        // reject getLogs(0, latest) on real networks for being too wide.
        string memory obj = "d";
        vm.serializeAddress(obj, "didRegistry", didRegistryAddr);
        vm.serializeAddress(obj, "didRegistrar", didRegistrarAddr);
        vm.serializeAddress(obj, "inviteRegistrar", inviteRegistrarAddr);
        vm.serializeAddress(obj, "identityRegistry", address(identity));
        vm.serializeAddress(obj, "reputationRegistry", address(reputation));
        vm.serializeAddress(obj, "validationRegistry", address(validation));
        if (!skipMockUsdc) {
            vm.serializeAddress(obj, "mockUSDC", mockUSDC);
        }
        string memory result = vm.serializeUint(obj, "deploymentBlock", block.number);
        vm.writeJson(result, "./script/deployment.json");
    }
}
