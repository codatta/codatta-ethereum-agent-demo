// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IdentityRegistry} from "../src/erc8004/IdentityRegistry.sol";
import {ReputationRegistry} from "../src/erc8004/ReputationRegistry.sol";

contract ReputationRegistryTest is Test {
    IdentityRegistry public identity;
    ReputationRegistry public reputation;

    address internal _agentOwner;
    uint256 internal _agentOwnerKey;

    address internal _client;
    uint256 internal _clientKey;

    address internal _client2;

    uint256 internal _agentId;

    function setUp() public {
        (_agentOwner, _agentOwnerKey) = makeAddrAndKey("agentOwner");
        (_client, _clientKey) = makeAddrAndKey("client");
        _client2 = makeAddr("client2");

        identity = new IdentityRegistry();
        reputation = new ReputationRegistry(address(identity));

        // Register an agent owned by _agentOwner
        vm.prank(_agentOwner);
        _agentId = identity.register("ipfs://agent");
    }

    function _buildFeedbackAuth(
        uint256 agentId,
        address clientAddress,
        uint64 indexLimit,
        uint256 expiry
    ) internal view returns (bytes memory) {
        ReputationRegistry.FeedbackAuth memory auth = ReputationRegistry.FeedbackAuth({
            agentId: agentId,
            clientAddress: clientAddress,
            indexLimit: indexLimit,
            expiry: expiry,
            chainId: block.chainid,
            identityRegistry: address(identity),
            signerAddress: _agentOwner
        });

        // Encode struct fields (7 * 32 = 224 bytes)
        bytes memory encoded = abi.encode(
            auth.agentId,
            auth.clientAddress,
            auth.indexLimit,
            auth.expiry,
            auth.chainId,
            auth.identityRegistry,
            auth.signerAddress
        );

        // Sign the message
        bytes32 messageHash = keccak256(encoded);
        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(_agentOwnerKey, ethSignedHash);

        // feedbackAuth = encoded struct (224 bytes) + signature (65 bytes) = 289 bytes
        return abi.encodePacked(encoded, r, s, v);
    }

    // ─── constructor ──────────────────────────────────────────────────

    function test_constructor_zeroAddress() public {
        vm.expectRevert("bad identity");
        new ReputationRegistry(address(0));
    }

    function test_getIdentityRegistry() public view {
        assertEq(reputation.getIdentityRegistry(), address(identity));
    }

    // ─── giveFeedback ─────────────────────────────────────────────────

    function test_giveFeedback_success() public {
        bytes memory auth = _buildFeedbackAuth(_agentId, _client, 1, block.timestamp + 1 hours);

        vm.prank(_client);
        reputation.giveFeedback(
            _agentId,
            85,
            bytes32("quality"),
            bytes32("speed"),
            "ipfs://feedback1",
            keccak256("feedback1"),
            auth
        );

        (uint8 score, bytes32 tag1, bytes32 tag2, bool isRevoked) = reputation.readFeedback(_agentId, _client, 1);
        assertEq(score, 85);
        assertEq(tag1, bytes32("quality"));
        assertEq(tag2, bytes32("speed"));
        assertFalse(isRevoked);
        assertEq(reputation.getLastIndex(_agentId, _client), 1);
    }

    function test_giveFeedback_scoreOver100() public {
        bytes memory auth = _buildFeedbackAuth(_agentId, _client, 1, block.timestamp + 1 hours);

        vm.prank(_client);
        vm.expectRevert("score>100");
        reputation.giveFeedback(
            _agentId, 101, bytes32(0), bytes32(0), "", bytes32(0), auth
        );
    }

    function test_giveFeedback_nonExistentAgent() public {
        uint256 fakeAgentId = 99999;
        bytes memory auth = _buildFeedbackAuth(fakeAgentId, _client, 1, block.timestamp + 1 hours);

        vm.prank(_client);
        vm.expectRevert("Agent does not exist");
        reputation.giveFeedback(
            fakeAgentId, 50, bytes32(0), bytes32(0), "", bytes32(0), auth
        );
    }

    function test_giveFeedback_selfFeedbackFromOwner() public {
        bytes memory auth = _buildFeedbackAuth(_agentId, _agentOwner, 1, block.timestamp + 1 hours);

        vm.prank(_agentOwner);
        vm.expectRevert("Self-feedback not allowed");
        reputation.giveFeedback(
            _agentId, 50, bytes32(0), bytes32(0), "", bytes32(0), auth
        );
    }

    function test_giveFeedback_selfFeedbackFromApprovedOperator() public {
        address operator = makeAddr("operator");
        vm.prank(_agentOwner);
        identity.setApprovalForAll(operator, true);

        bytes memory auth = _buildFeedbackAuth(_agentId, operator, 1, block.timestamp + 1 hours);

        vm.prank(operator);
        vm.expectRevert("Self-feedback not allowed");
        reputation.giveFeedback(
            _agentId, 50, bytes32(0), bytes32(0), "", bytes32(0), auth
        );
    }

    function test_giveFeedback_expiredAuth() public {
        bytes memory auth = _buildFeedbackAuth(_agentId, _client, 1, block.timestamp - 1);

        vm.prank(_client);
        vm.expectRevert("Auth expired");
        reputation.giveFeedback(
            _agentId, 50, bytes32(0), bytes32(0), "", bytes32(0), auth
        );
    }

    function test_giveFeedback_multipleFeedbacks() public {
        bytes memory auth1 = _buildFeedbackAuth(_agentId, _client, 1, block.timestamp + 1 hours);
        vm.prank(_client);
        reputation.giveFeedback(
            _agentId, 80, bytes32("q"), bytes32(0), "uri1", keccak256("f1"), auth1
        );

        bytes memory auth2 = _buildFeedbackAuth(_agentId, _client, 2, block.timestamp + 1 hours);
        vm.prank(_client);
        reputation.giveFeedback(
            _agentId, 90, bytes32("q"), bytes32(0), "uri2", keccak256("f2"), auth2
        );

        assertEq(reputation.getLastIndex(_agentId, _client), 2);
    }

    function test_giveFeedback_tracksClients() public {
        bytes memory auth = _buildFeedbackAuth(_agentId, _client, 1, block.timestamp + 1 hours);
        vm.prank(_client);
        reputation.giveFeedback(
            _agentId, 80, bytes32(0), bytes32(0), "", bytes32(0), auth
        );

        address[] memory clients = reputation.getClients(_agentId);
        assertEq(clients.length, 1);
        assertEq(clients[0], _client);
    }

    // ─── revokeFeedback ───────────────────────────────────────────────

    function test_revokeFeedback_success() public {
        bytes memory auth = _buildFeedbackAuth(_agentId, _client, 1, block.timestamp + 1 hours);
        vm.prank(_client);
        reputation.giveFeedback(
            _agentId, 80, bytes32(0), bytes32(0), "", bytes32(0), auth
        );

        vm.prank(_client);
        reputation.revokeFeedback(_agentId, 1);

        (, , , bool isRevoked) = reputation.readFeedback(_agentId, _client, 1);
        assertTrue(isRevoked);
    }

    function test_revokeFeedback_indexZero() public {
        vm.prank(_client);
        vm.expectRevert("index must be > 0");
        reputation.revokeFeedback(_agentId, 0);
    }

    function test_revokeFeedback_outOfBounds() public {
        vm.prank(_client);
        vm.expectRevert("index out of bounds");
        reputation.revokeFeedback(_agentId, 1);
    }

    function test_revokeFeedback_alreadyRevoked() public {
        bytes memory auth = _buildFeedbackAuth(_agentId, _client, 1, block.timestamp + 1 hours);
        vm.prank(_client);
        reputation.giveFeedback(
            _agentId, 80, bytes32(0), bytes32(0), "", bytes32(0), auth
        );

        vm.startPrank(_client);
        reputation.revokeFeedback(_agentId, 1);
        vm.expectRevert("Already revoked");
        reputation.revokeFeedback(_agentId, 1);
        vm.stopPrank();
    }

    // ─── appendResponse ───────────────────────────────────────────────

    function test_appendResponse_success() public {
        bytes memory auth = _buildFeedbackAuth(_agentId, _client, 1, block.timestamp + 1 hours);
        vm.prank(_client);
        reputation.giveFeedback(
            _agentId, 80, bytes32(0), bytes32(0), "", bytes32(0), auth
        );

        address responder = makeAddr("responder");
        vm.prank(responder);
        reputation.appendResponse(
            _agentId, _client, 1, "ipfs://response", keccak256("resp")
        );

        // Verify response count
        address[] memory responders = new address[](1);
        responders[0] = responder;
        uint64 count = reputation.getResponseCount(_agentId, _client, 1, responders);
        assertEq(count, 1);
    }

    function test_appendResponse_emptyUri() public {
        bytes memory auth = _buildFeedbackAuth(_agentId, _client, 1, block.timestamp + 1 hours);
        vm.prank(_client);
        reputation.giveFeedback(
            _agentId, 80, bytes32(0), bytes32(0), "", bytes32(0), auth
        );

        vm.prank(makeAddr("responder"));
        vm.expectRevert("Empty URI");
        reputation.appendResponse(_agentId, _client, 1, "", bytes32(0));
    }

    function test_appendResponse_indexOutOfBounds() public {
        vm.prank(makeAddr("responder"));
        vm.expectRevert("index out of bounds");
        reputation.appendResponse(_agentId, _client, 1, "uri", bytes32(0));
    }

    function test_appendResponse_multipleFromSameResponder() public {
        bytes memory auth = _buildFeedbackAuth(_agentId, _client, 1, block.timestamp + 1 hours);
        vm.prank(_client);
        reputation.giveFeedback(
            _agentId, 80, bytes32(0), bytes32(0), "", bytes32(0), auth
        );

        address responder = makeAddr("responder");
        vm.startPrank(responder);
        reputation.appendResponse(_agentId, _client, 1, "uri1", keccak256("r1"));
        reputation.appendResponse(_agentId, _client, 1, "uri2", keccak256("r2"));
        vm.stopPrank();

        address[] memory responders = new address[](1);
        responders[0] = responder;
        uint64 count = reputation.getResponseCount(_agentId, _client, 1, responders);
        assertEq(count, 2);
    }

    // ─── getSummary ───────────────────────────────────────────────────

    function test_getSummary_noFilter() public {
        // Two feedbacks from _client
        bytes memory auth1 = _buildFeedbackAuth(_agentId, _client, 1, block.timestamp + 1 hours);
        vm.prank(_client);
        reputation.giveFeedback(
            _agentId, 80, bytes32("q"), bytes32(0), "u1", keccak256("f1"), auth1
        );

        bytes memory auth2 = _buildFeedbackAuth(_agentId, _client, 2, block.timestamp + 1 hours);
        vm.prank(_client);
        reputation.giveFeedback(
            _agentId, 60, bytes32("q"), bytes32(0), "u2", keccak256("f2"), auth2
        );

        address[] memory empty = new address[](0);
        (uint64 count, uint8 avg) = reputation.getSummary(_agentId, empty, bytes32(0), bytes32(0));
        assertEq(count, 2);
        assertEq(avg, 70); // (80 + 60) / 2
    }

    function test_getSummary_withTagFilter() public {
        bytes memory auth1 = _buildFeedbackAuth(_agentId, _client, 1, block.timestamp + 1 hours);
        vm.prank(_client);
        reputation.giveFeedback(
            _agentId, 80, bytes32("quality"), bytes32(0), "u1", keccak256("f1"), auth1
        );

        bytes memory auth2 = _buildFeedbackAuth(_agentId, _client, 2, block.timestamp + 1 hours);
        vm.prank(_client);
        reputation.giveFeedback(
            _agentId, 60, bytes32("speed"), bytes32(0), "u2", keccak256("f2"), auth2
        );

        address[] memory empty = new address[](0);
        (uint64 count, uint8 avg) = reputation.getSummary(_agentId, empty, bytes32("quality"), bytes32(0));
        assertEq(count, 1);
        assertEq(avg, 80);
    }

    function test_getSummary_excludesRevoked() public {
        bytes memory auth1 = _buildFeedbackAuth(_agentId, _client, 1, block.timestamp + 1 hours);
        vm.prank(_client);
        reputation.giveFeedback(
            _agentId, 80, bytes32(0), bytes32(0), "u1", keccak256("f1"), auth1
        );

        bytes memory auth2 = _buildFeedbackAuth(_agentId, _client, 2, block.timestamp + 1 hours);
        vm.prank(_client);
        reputation.giveFeedback(
            _agentId, 40, bytes32(0), bytes32(0), "u2", keccak256("f2"), auth2
        );

        // Revoke the second feedback
        vm.prank(_client);
        reputation.revokeFeedback(_agentId, 2);

        address[] memory empty = new address[](0);
        (uint64 count, uint8 avg) = reputation.getSummary(_agentId, empty, bytes32(0), bytes32(0));
        assertEq(count, 1);
        assertEq(avg, 80);
    }

    // ─── readAllFeedback ──────────────────────────────────────────────

    function test_readAllFeedback_excludeRevoked() public {
        bytes memory auth1 = _buildFeedbackAuth(_agentId, _client, 1, block.timestamp + 1 hours);
        vm.prank(_client);
        reputation.giveFeedback(
            _agentId, 80, bytes32("q"), bytes32("s"), "u1", keccak256("f1"), auth1
        );

        bytes memory auth2 = _buildFeedbackAuth(_agentId, _client, 2, block.timestamp + 1 hours);
        vm.prank(_client);
        reputation.giveFeedback(
            _agentId, 40, bytes32("q"), bytes32("s"), "u2", keccak256("f2"), auth2
        );

        vm.prank(_client);
        reputation.revokeFeedback(_agentId, 2);

        address[] memory empty = new address[](0);
        (
            address[] memory clients,
            uint8[] memory scores,
            , ,
        ) = reputation.readAllFeedback(_agentId, empty, bytes32(0), bytes32(0), false);

        assertEq(clients.length, 1);
        assertEq(scores[0], 80);
    }

    function test_readAllFeedback_includeRevoked() public {
        bytes memory auth1 = _buildFeedbackAuth(_agentId, _client, 1, block.timestamp + 1 hours);
        vm.prank(_client);
        reputation.giveFeedback(
            _agentId, 80, bytes32(0), bytes32(0), "u1", keccak256("f1"), auth1
        );

        vm.prank(_client);
        reputation.revokeFeedback(_agentId, 1);

        address[] memory empty = new address[](0);
        (
            address[] memory clients,
            , , ,
            bool[] memory revokedStatuses
        ) = reputation.readAllFeedback(_agentId, empty, bytes32(0), bytes32(0), true);

        assertEq(clients.length, 1);
        assertTrue(revokedStatuses[0]);
    }

    // ─── getResponseCount ─────────────────────────────────────────────

    function test_getResponseCount_allClientsAllFeedback() public {
        bytes memory auth = _buildFeedbackAuth(_agentId, _client, 1, block.timestamp + 1 hours);
        vm.prank(_client);
        reputation.giveFeedback(
            _agentId, 80, bytes32(0), bytes32(0), "", bytes32(0), auth
        );

        address responder = makeAddr("responder");
        vm.prank(responder);
        reputation.appendResponse(_agentId, _client, 1, "uri", keccak256("r"));

        // Count across all clients (clientAddress = 0)
        address[] memory empty = new address[](0);
        uint64 count = reputation.getResponseCount(_agentId, address(0), 0, empty);
        assertEq(count, 1);
    }

    function test_getResponseCount_specificClient() public {
        bytes memory auth = _buildFeedbackAuth(_agentId, _client, 1, block.timestamp + 1 hours);
        vm.prank(_client);
        reputation.giveFeedback(
            _agentId, 80, bytes32(0), bytes32(0), "", bytes32(0), auth
        );

        address responder = makeAddr("responder");
        vm.prank(responder);
        reputation.appendResponse(_agentId, _client, 1, "uri", keccak256("r"));

        // Count for specific client, all feedback (feedbackIndex = 0)
        address[] memory empty = new address[](0);
        uint64 count = reputation.getResponseCount(_agentId, _client, 0, empty);
        assertEq(count, 1);
    }

    // ─── getScore ─────────────────────────────────────────────────────

    function test_getScore() public {
        bytes memory auth = _buildFeedbackAuth(_agentId, _client, 1, block.timestamp + 1 hours);
        vm.prank(_client);
        reputation.giveFeedback(
            _agentId, 85, bytes32(0), bytes32(0), "", bytes32(0), auth
        );

        assertEq(reputation.getScore(_agentId), 85);
    }
}
