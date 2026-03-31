// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {DIDRegistry} from "../src/did/DIDRegistry.sol";
import {DIDRegistrar} from "../src/did/DIDRegistrar.sol";
import {IdentityRegistry} from "../src/erc8004/IdentityRegistry.sol";
import {ReputationRegistry} from "../src/erc8004/ReputationRegistry.sol";
import {ValidationRegistry} from "../src/erc8004/ValidationRegistry.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // Codatta DID (UUPS proxy)
        DIDRegistry didImpl = new DIDRegistry();
        ERC1967Proxy didProxy = new ERC1967Proxy(
            address(didImpl),
            abi.encodeWithSelector(DIDRegistry.initialize.selector, deployer)
        );
        console.log("DIDRegistry (proxy):", address(didProxy));

        DIDRegistrar didRegistrar = new DIDRegistrar(address(didProxy));
        console.log("DIDRegistrar:", address(didRegistrar));

        // Authorize registrar
        address[] memory addings = new address[](1);
        addings[0] = address(didRegistrar);
        address[] memory removings = new address[](0);
        DIDRegistry(address(didProxy)).updateRegistrars(addings, removings);

        // ERC-8004
        IdentityRegistry identity = new IdentityRegistry();
        console.log("IdentityRegistry:", address(identity));

        ReputationRegistry reputation = new ReputationRegistry(address(identity));
        console.log("ReputationRegistry:", address(reputation));

        ValidationRegistry validation = new ValidationRegistry(address(identity));
        console.log("ValidationRegistry:", address(validation));

        vm.stopBroadcast();

        // Write deployment addresses
        string memory obj = "d";
        vm.serializeAddress(obj, "didRegistry", address(didProxy));
        vm.serializeAddress(obj, "didRegistrar", address(didRegistrar));
        vm.serializeAddress(obj, "identityRegistry", address(identity));
        vm.serializeAddress(obj, "reputationRegistry", address(reputation));
        string memory result = vm.serializeAddress(obj, "validationRegistry", address(validation));
        vm.writeJson(result, "./script/deployment.json");
    }
}
