// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {IdentityRegistry} from "../src/erc8004/IdentityRegistry.sol";
import {ReputationRegistry} from "../src/erc8004/ReputationRegistry.sol";
import {ValidationRegistry} from "../src/erc8004/ValidationRegistry.sol";
import {ACPContract} from "../src/erc8183/ACPContract.sol";
import {CodattaJobHook} from "../src/erc8183/CodattaJobHook.sol";
import {MockERC20} from "../src/mock/MockERC20.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address treasury = vm.envAddress("TREASURY_ADDRESS");

        vm.startBroadcast(deployerKey);

        // ERC-8004
        IdentityRegistry identity = new IdentityRegistry();
        console.log("IdentityRegistry:", address(identity));

        ReputationRegistry reputation = new ReputationRegistry(address(identity));
        console.log("ReputationRegistry:", address(reputation));

        ValidationRegistry validation = new ValidationRegistry(address(identity));
        console.log("ValidationRegistry:", address(validation));

        // ERC-20 Token
        MockERC20 token = new MockERC20("Codatta Token", "XNY");
        console.log("MockERC20 (XNY):", address(token));

        // ERC-8183: 2.5% platform fee, 5% evaluator fee
        ACPContract acp = new ACPContract(address(token), treasury, 250, 500);
        console.log("ACPContract:", address(acp));

        // Hook
        CodattaJobHook hook = new CodattaJobHook(address(acp));
        console.log("CodattaJobHook:", address(hook));

        vm.stopBroadcast();

        // Write deployment addresses to file
        string memory obj = "d";
        vm.serializeAddress(obj, "identityRegistry", address(identity));
        vm.serializeAddress(obj, "reputationRegistry", address(reputation));
        vm.serializeAddress(obj, "validationRegistry", address(validation));
        vm.serializeAddress(obj, "token", address(token));
        vm.serializeAddress(obj, "acpContract", address(acp));
        vm.serializeAddress(obj, "hookContract", address(hook));
        string memory result = vm.serializeAddress(obj, "treasury", treasury);
        vm.writeJson(result, "./script/deployment.json");
    }
}
