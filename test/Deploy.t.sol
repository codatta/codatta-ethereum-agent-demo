// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {DIDRegistry} from "codatta-did/DIDRegistry.sol";
import {DIDRegistrar} from "codatta-did/DIDRegistrar.sol";
import {InviteRegistrar} from "codatta-did/InviteRegistrar.sol";
import {IdentityRegistry} from "../src/erc8004/IdentityRegistry.sol";
import {ReputationRegistry} from "../src/erc8004/ReputationRegistry.sol";
import {ValidationRegistry} from "../src/erc8004/ValidationRegistry.sol";

/// @notice Integration test that mirrors the Deploy.s.sol script
contract DeployIntegrationTest is Test {
    DIDRegistry public didRegistry;
    DIDRegistrar public didRegistrar;
    InviteRegistrar public inviteRegistrar;
    IdentityRegistry public identityReg;
    ReputationRegistry public reputationReg;
    ValidationRegistry public validationReg;

    address internal _deployer;
    uint256 internal _deployerKey;

    address internal _user;
    uint256 internal _userKey;

    function setUp() public {
        (_deployer, _deployerKey) = makeAddrAndKey("deployer");
        (_user, _userKey) = makeAddrAndKey("user");

        vm.startPrank(_deployer);

        // 1. DIDRegistry (UUPS proxy)
        DIDRegistry didImpl = new DIDRegistry();
        ERC1967Proxy didProxy = new ERC1967Proxy(
            address(didImpl),
            abi.encodeWithSelector(DIDRegistry.initialize.selector, _deployer)
        );
        didRegistry = DIDRegistry(address(didProxy));

        // 2. DIDRegistrar
        didRegistrar = new DIDRegistrar(address(didRegistry));

        // 3. InviteRegistrar (deployer = invite signer for demo)
        inviteRegistrar = new InviteRegistrar(address(didRegistry), _deployer);

        // 4. Authorize both registrars
        address[] memory addings = new address[](2);
        addings[0] = address(didRegistrar);
        addings[1] = address(inviteRegistrar);
        didRegistry.updateRegistrars(addings, new address[](0));

        // 5. ERC-8004 contracts
        identityReg = new IdentityRegistry();
        reputationReg = new ReputationRegistry(address(identityReg));
        validationReg = new ValidationRegistry(address(identityReg));

        vm.stopPrank();
    }

    // ─── Deployment verification ──────────────────────────────────────

    function test_didRegistryOwner() public view {
        assertEq(didRegistry.owner(), _deployer);
    }

    function test_registrarsAuthorized() public view {
        address[] memory registrars = didRegistry.getRegistrars();
        assertEq(registrars.length, 2);

        bool foundDid = false;
        bool foundInvite = false;
        for (uint256 i = 0; i < registrars.length; i++) {
            if (registrars[i] == address(didRegistrar)) foundDid = true;
            if (registrars[i] == address(inviteRegistrar)) foundInvite = true;
        }
        assertTrue(foundDid, "DIDRegistrar not authorized");
        assertTrue(foundInvite, "InviteRegistrar not authorized");
    }

    function test_erc8004_linkedToIdentity() public view {
        assertEq(reputationReg.getIdentityRegistry(), address(identityReg));
        assertEq(validationReg.getIdentityRegistry(), address(identityReg));
    }

    // ─── End-to-end: DID registration → Agent registration ───────────

    function test_e2e_didRegistrar_flow() public {
        // Register DID via DIDRegistrar
        vm.prank(address(didRegistrar));
        didRegistry.register(1, _user);

        assertEq(didRegistry.ownerOf(1), _user);
    }

    function test_e2e_inviteRegistrar_flow() public {
        // Sign invite (deployer is the invite signer)
        uint256 nonce = 1;
        bytes32 messageHash = keccak256(
            abi.encodePacked(_deployer, _user, nonce, block.chainid, address(inviteRegistrar))
        );
        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(_deployerKey, ethSignedHash);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(_user);
        inviteRegistrar.registerWithInvite(_deployer, nonce, sig);

        uint128[] memory dids = didRegistry.getOwnedDids(_user);
        assertEq(dids.length, 1);
    }

    function test_e2e_agentRegistration_flow() public {
        // Register an agent identity
        vm.prank(_user);
        uint256 agentId = identityReg.register("ipfs://agent-card");

        assertEq(identityReg.ownerOf(agentId), _user);
        assertEq(identityReg.tokenURI(agentId), "ipfs://agent-card");

        // ReputationRegistry and ValidationRegistry can reference this agent
        // (queries return empty but don't revert)
        address[] memory empty = new address[](0);
        (uint64 count, uint8 avg) = validationReg.getSummary(agentId, empty, bytes32(0));
        assertEq(count, 0);
        assertEq(avg, 0);
    }

    function test_e2e_fullLifecycle() public {
        // 1. Register DID via invite
        uint256 nonce = 42;
        bytes32 messageHash = keccak256(
            abi.encodePacked(_deployer, _user, nonce, block.chainid, address(inviteRegistrar))
        );
        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(_deployerKey, ethSignedHash);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(_user);
        inviteRegistrar.registerWithInvite(_deployer, nonce, sig);

        // 2. Register agent identity
        vm.prank(_user);
        uint256 agentId = identityReg.register("ipfs://agent");

        // 3. Set metadata
        vm.prank(_user);
        identityReg.setMetadata(agentId, "endpoint", bytes("https://agent.example.com"));

        // 4. Create validation request
        address validator = makeAddr("validator");
        bytes32 reqHash = keccak256("validate-agent");

        vm.prank(_user);
        validationReg.validationRequest(validator, agentId, "ipfs://req", reqHash);

        // 5. Validator responds
        vm.prank(validator);
        validationReg.validationResponse(reqHash, 95, "ipfs://resp", keccak256("resp"), bytes32("audit"));

        // Verify
        (, , uint8 response, , , ) = validationReg.getValidationStatus(reqHash);
        assertEq(response, 95);
    }
}
