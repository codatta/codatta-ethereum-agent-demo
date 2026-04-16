// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IdentityRegistry} from "../src/erc8004/IdentityRegistry.sol";
import {ValidationRegistry} from "../src/erc8004/ValidationRegistry.sol";

contract ValidationRegistryTest is Test {
    IdentityRegistry public identity;
    ValidationRegistry public validation;

    address internal _agentOwner;
    address internal _validator;
    address internal _other;

    uint256 internal _agentId;

    function setUp() public {
        _agentOwner = makeAddr("agentOwner");
        _validator = makeAddr("validator");
        _other = makeAddr("other");

        identity = new IdentityRegistry();
        validation = new ValidationRegistry(address(identity));

        // Register an agent
        vm.prank(_agentOwner);
        _agentId = identity.register("ipfs://agent");
    }

    // ─── constructor ──────────────────────────────────────────────────

    function test_constructor_zeroAddress() public {
        vm.expectRevert("bad identity");
        new ValidationRegistry(address(0));
    }

    function test_getIdentityRegistry() public view {
        assertEq(validation.getIdentityRegistry(), address(identity));
    }

    // ─── validationRequest ────────────────────────────────────────────

    function test_validationRequest_success() public {
        bytes32 reqHash = keccak256("request1");

        vm.prank(_agentOwner);
        validation.validationRequest(_validator, _agentId, "ipfs://req", reqHash);

        (
            address validatorAddr,
            uint256 agentId,
            uint8 response,
            bytes32 responseHash,
            bytes32 tag,
            uint256 lastUpdate
        ) = validation.getValidationStatus(reqHash);

        assertEq(validatorAddr, _validator);
        assertEq(agentId, _agentId);
        assertEq(response, 0);
        assertEq(responseHash, bytes32(0));
        assertEq(tag, bytes32(0));
        assertGt(lastUpdate, 0);
    }

    function test_validationRequest_emitsEvent() public {
        bytes32 reqHash = keccak256("request1");

        vm.prank(_agentOwner);
        vm.expectEmit(true, true, true, true);
        emit ValidationRegistry.ValidationRequest(_validator, _agentId, "ipfs://req", reqHash);
        validation.validationRequest(_validator, _agentId, "ipfs://req", reqHash);
    }

    function test_validationRequest_notAuthorized() public {
        bytes32 reqHash = keccak256("request1");

        vm.prank(_other);
        vm.expectRevert("Not authorized");
        validation.validationRequest(_validator, _agentId, "ipfs://req", reqHash);
    }

    function test_validationRequest_approvedOperator() public {
        address operator = makeAddr("operator");
        vm.prank(_agentOwner);
        identity.setApprovalForAll(operator, true);

        bytes32 reqHash = keccak256("request1");

        vm.prank(operator);
        validation.validationRequest(_validator, _agentId, "ipfs://req", reqHash);

        (address validatorAddr, , , , , ) = validation.getValidationStatus(reqHash);
        assertEq(validatorAddr, _validator);
    }

    function test_validationRequest_zeroValidator() public {
        vm.prank(_agentOwner);
        vm.expectRevert("bad validator");
        validation.validationRequest(address(0), _agentId, "ipfs://req", keccak256("r"));
    }

    function test_validationRequest_duplicateHash() public {
        bytes32 reqHash = keccak256("request1");

        vm.startPrank(_agentOwner);
        validation.validationRequest(_validator, _agentId, "ipfs://req", reqHash);

        vm.expectRevert("exists");
        validation.validationRequest(_validator, _agentId, "ipfs://req2", reqHash);
        vm.stopPrank();
    }

    // ─── validationResponse ───────────────────────────────────────────

    function test_validationResponse_success() public {
        bytes32 reqHash = keccak256("request1");
        vm.prank(_agentOwner);
        validation.validationRequest(_validator, _agentId, "ipfs://req", reqHash);

        bytes32 respHash = keccak256("resp1");
        vm.prank(_validator);
        validation.validationResponse(reqHash, 85, "ipfs://resp", respHash, bytes32("quality"));

        (
            ,
            ,
            uint8 response,
            bytes32 responseHash,
            bytes32 tag,
        ) = validation.getValidationStatus(reqHash);

        assertEq(response, 85);
        assertEq(responseHash, respHash);
        assertEq(tag, bytes32("quality"));
    }

    function test_validationResponse_emitsEvent() public {
        bytes32 reqHash = keccak256("request1");
        vm.prank(_agentOwner);
        validation.validationRequest(_validator, _agentId, "ipfs://req", reqHash);

        bytes32 respHash = keccak256("resp1");
        vm.prank(_validator);
        vm.expectEmit(true, true, true, true);
        emit ValidationRegistry.ValidationResponse(
            _validator, _agentId, reqHash, 85, "ipfs://resp", respHash, bytes32("quality")
        );
        validation.validationResponse(reqHash, 85, "ipfs://resp", respHash, bytes32("quality"));
    }

    function test_validationResponse_notValidator() public {
        bytes32 reqHash = keccak256("request1");
        vm.prank(_agentOwner);
        validation.validationRequest(_validator, _agentId, "ipfs://req", reqHash);

        vm.prank(_other);
        vm.expectRevert("not validator");
        validation.validationResponse(reqHash, 50, "uri", bytes32(0), bytes32(0));
    }

    function test_validationResponse_unknownRequest() public {
        vm.prank(_validator);
        vm.expectRevert("unknown");
        validation.validationResponse(keccak256("nope"), 50, "uri", bytes32(0), bytes32(0));
    }

    function test_validationResponse_scoreOver100() public {
        bytes32 reqHash = keccak256("request1");
        vm.prank(_agentOwner);
        validation.validationRequest(_validator, _agentId, "ipfs://req", reqHash);

        vm.prank(_validator);
        vm.expectRevert("resp>100");
        validation.validationResponse(reqHash, 101, "uri", bytes32(0), bytes32(0));
    }

    function test_validationResponse_canUpdateResponse() public {
        bytes32 reqHash = keccak256("request1");
        vm.prank(_agentOwner);
        validation.validationRequest(_validator, _agentId, "ipfs://req", reqHash);

        vm.startPrank(_validator);
        validation.validationResponse(reqHash, 50, "uri1", keccak256("r1"), bytes32("t1"));
        validation.validationResponse(reqHash, 90, "uri2", keccak256("r2"), bytes32("t2"));
        vm.stopPrank();

        (, , uint8 response, , bytes32 tag, ) = validation.getValidationStatus(reqHash);
        assertEq(response, 90);
        assertEq(tag, bytes32("t2"));
    }

    // ─── getSummary ───────────────────────────────────────────────────

    function test_getSummary_noFilter() public {
        // Create two validation requests with responses
        bytes32 req1 = keccak256("r1");
        bytes32 req2 = keccak256("r2");

        vm.startPrank(_agentOwner);
        validation.validationRequest(_validator, _agentId, "uri1", req1);
        validation.validationRequest(_validator, _agentId, "uri2", req2);
        vm.stopPrank();

        vm.startPrank(_validator);
        validation.validationResponse(req1, 80, "resp1", keccak256("resp1"), bytes32("tag"));
        validation.validationResponse(req2, 60, "resp2", keccak256("resp2"), bytes32("tag"));
        vm.stopPrank();

        address[] memory empty = new address[](0);
        (uint64 count, uint8 avg) = validation.getSummary(_agentId, empty, bytes32(0));
        assertEq(count, 2);
        assertEq(avg, 70);
    }

    function test_getSummary_withValidatorFilter() public {
        address validator2 = makeAddr("validator2");

        bytes32 req1 = keccak256("r1");
        bytes32 req2 = keccak256("r2");

        vm.startPrank(_agentOwner);
        validation.validationRequest(_validator, _agentId, "uri1", req1);
        validation.validationRequest(validator2, _agentId, "uri2", req2);
        vm.stopPrank();

        vm.prank(_validator);
        validation.validationResponse(req1, 80, "resp", keccak256("resp"), bytes32(0));
        vm.prank(validator2);
        validation.validationResponse(req2, 40, "resp", keccak256("resp"), bytes32(0));

        address[] memory filter = new address[](1);
        filter[0] = _validator;
        (uint64 count, uint8 avg) = validation.getSummary(_agentId, filter, bytes32(0));
        assertEq(count, 1);
        assertEq(avg, 80);
    }

    function test_getSummary_withTagFilter() public {
        bytes32 req1 = keccak256("r1");
        bytes32 req2 = keccak256("r2");

        vm.startPrank(_agentOwner);
        validation.validationRequest(_validator, _agentId, "uri1", req1);
        validation.validationRequest(_validator, _agentId, "uri2", req2);
        vm.stopPrank();

        vm.startPrank(_validator);
        validation.validationResponse(req1, 80, "resp1", keccak256("resp1"), bytes32("quality"));
        validation.validationResponse(req2, 60, "resp2", keccak256("resp2"), bytes32("speed"));
        vm.stopPrank();

        address[] memory empty = new address[](0);
        (uint64 count, uint8 avg) = validation.getSummary(_agentId, empty, bytes32("quality"));
        assertEq(count, 1);
        assertEq(avg, 80);
    }

    // ─── lookup helpers ───────────────────────────────────────────────

    function test_getAgentValidations() public {
        bytes32 req1 = keccak256("r1");
        bytes32 req2 = keccak256("r2");

        vm.startPrank(_agentOwner);
        validation.validationRequest(_validator, _agentId, "uri1", req1);
        validation.validationRequest(_validator, _agentId, "uri2", req2);
        vm.stopPrank();

        bytes32[] memory hashes = validation.getAgentValidations(_agentId);
        assertEq(hashes.length, 2);
        assertEq(hashes[0], req1);
        assertEq(hashes[1], req2);
    }

    function test_getValidatorRequests() public {
        bytes32 req1 = keccak256("r1");

        vm.prank(_agentOwner);
        validation.validationRequest(_validator, _agentId, "uri1", req1);

        bytes32[] memory hashes = validation.getValidatorRequests(_validator);
        assertEq(hashes.length, 1);
        assertEq(hashes[0], req1);
    }

    function test_getValidationStatus_unknown() public {
        vm.expectRevert("unknown");
        validation.getValidationStatus(keccak256("nope"));
    }
}
