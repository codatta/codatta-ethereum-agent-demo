// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {IdentityRegistry} from "../src/erc8004/IdentityRegistry.sol";
import {ReputationRegistry} from "../src/erc8004/ReputationRegistry.sol";
import {ValidationRegistry} from "../src/erc8004/ValidationRegistry.sol";
import {ACPContract} from "../src/erc8183/ACPContract.sol";
import {IACP} from "../src/erc8183/IACP.sol";
import {CodattaJobHook} from "../src/erc8183/CodattaJobHook.sol";
import {MockERC20} from "../src/mock/MockERC20.sol";

contract DemoIntegrationTest is Test {
    // Contracts
    IdentityRegistry identityRegistry;
    ReputationRegistry reputationRegistry;
    ValidationRegistry validationRegistry;
    ACPContract acp;
    CodattaJobHook hook;
    MockERC20 token;

    // Roles
    uint256 deployerKey = 0xA11CE;
    uint256 clientKey = 0xB0B;
    uint256 evaluatorKey = 0xC0C;
    address deployer = vm.addr(deployerKey);
    address client = vm.addr(clientKey);
    address evaluator = vm.addr(evaluatorKey);
    address treasury = makeAddr("treasury");

    uint256 agentId;
    uint256 jobId;
    uint256 constant JOB_BUDGET = 1000 ether;

    function setUp() public {
        // Deploy all contracts as deployer
        vm.startPrank(deployer);

        identityRegistry = new IdentityRegistry();
        reputationRegistry = new ReputationRegistry(address(identityRegistry));
        validationRegistry = new ValidationRegistry(address(identityRegistry));
        token = new MockERC20("Codatta Token", "XNY");

        // ACP: 2.5% platform fee, 5% evaluator fee
        acp = new ACPContract(address(token), treasury, 250, 500);
        hook = new CodattaJobHook(address(acp));

        vm.stopPrank();

        // Mint tokens to client for funding jobs
        token.mint(client, 10000 ether);
    }

    function test_fullDemoFlow() public {
        // ========================================
        // Step 1: Register Agent in ERC-8004
        // ========================================
        console.log("=== Step 1: Register Agent ===");

        vm.startPrank(deployer);
        agentId = identityRegistry.register(
            "https://codatta.io/agents/demo-annotator"
        );
        console.log("Agent registered, agentId:", agentId);

        // Set Codatta DID metadata
        uint128 codattaDid = 0x12345678abcdef0012345678abcdef00;
        identityRegistry.setMetadata(agentId, "codatta:did", abi.encode(codattaDid));

        // Set capabilities
        identityRegistry.setMetadata(
            agentId,
            "codatta:capabilities",
            abi.encode("annotator,validator")
        );
        vm.stopPrank();

        // Verify registration
        assertEq(identityRegistry.ownerOf(agentId), deployer);
        console.log("Agent owner:", deployer);

        // ========================================
        // Step 2: Create Job (ERC-8183)
        // ========================================
        console.log("\n=== Step 2: Create Job ===");

        vm.startPrank(client);
        jobId = acp.createJob(
            deployer,           // provider = agent owner
            evaluator,          // evaluator
            block.timestamp + 1 days,
            "Annotate 100 images for object detection",
            address(hook)       // Codatta hook
        );
        console.log("Job created, jobId:", jobId);
        vm.stopPrank();

        // ========================================
        // Step 3: Fund Job
        // ========================================
        console.log("\n=== Step 3: Fund Job ===");

        vm.startPrank(client);
        acp.setBudget(jobId, JOB_BUDGET, "");
        token.approve(address(acp), JOB_BUDGET);
        acp.fund(jobId, JOB_BUDGET, "");
        vm.stopPrank();

        console.log("Job funded:", JOB_BUDGET / 1e18, "XNY");

        // ========================================
        // Step 4: Submit Work (Agent executes)
        // ========================================
        console.log("\n=== Step 4: Submit Work ===");

        vm.startPrank(deployer);
        acp.submit(jobId, "ipfs://QmMockDeliverable12345", "");
        vm.stopPrank();

        console.log("Work submitted: ipfs://QmMockDeliverable12345");

        // ========================================
        // Step 5: Evaluate & Settle
        // ========================================
        console.log("\n=== Step 5: Evaluate & Settle ===");

        uint256 providerBalBefore = token.balanceOf(deployer);
        uint256 evaluatorBalBefore = token.balanceOf(evaluator);
        uint256 treasuryBalBefore = token.balanceOf(treasury);

        vm.startPrank(evaluator);
        acp.complete(jobId, keccak256("quality-pass"), "");
        vm.stopPrank();

        uint256 expectedPlatformFee = JOB_BUDGET * 250 / 10000;  // 2.5%
        uint256 expectedEvaluatorFee = JOB_BUDGET * 500 / 10000; // 5%
        uint256 expectedProviderPay = JOB_BUDGET - expectedPlatformFee - expectedEvaluatorFee;

        assertEq(token.balanceOf(treasury) - treasuryBalBefore, expectedPlatformFee);
        assertEq(token.balanceOf(evaluator) - evaluatorBalBefore, expectedEvaluatorFee);
        assertEq(token.balanceOf(deployer) - providerBalBefore, expectedProviderPay);

        console.log("Provider received:", expectedProviderPay / 1e18, "XNY");
        console.log("Evaluator received:", expectedEvaluatorFee / 1e18, "XNY");
        console.log("Treasury received:", expectedPlatformFee / 1e18, "XNY");

        // ========================================
        // Step 6: Validation (ERC-8004)
        // ========================================
        console.log("\n=== Step 6: Validation ===");

        bytes32 requestHash = keccak256(abi.encode(jobId, "ipfs://QmMockDeliverable12345"));

        vm.startPrank(deployer);
        validationRegistry.validationRequest(
            evaluator,
            agentId,
            "ipfs://QmMockValidationRequest",
            requestHash
        );
        vm.stopPrank();
        console.log("Validation requested");

        vm.startPrank(evaluator);
        validationRegistry.validationResponse(
            requestHash,
            85,  // score
            "ipfs://QmMockValidationReport",
            keccak256("validation-evidence"),
            bytes32("annotation")
        );
        vm.stopPrank();
        console.log("Validation response: score=85");

        // Verify validation
        (,, uint8 response,,,) = validationRegistry.getValidationStatus(requestHash);
        assertEq(response, 85);

        // ========================================
        // Step 7: Reputation (ERC-8004)
        // ========================================
        console.log("\n=== Step 7: Reputation ===");

        // Build feedbackAuth: deployer (agent owner) signs authorization for client
        bytes memory feedbackAuth = _buildFeedbackAuth(
            agentId,
            client,
            10,                     // indexLimit
            block.timestamp + 1 hours,
            block.chainid,
            address(identityRegistry),
            deployer
        );

        vm.startPrank(client);
        reputationRegistry.giveFeedback(
            agentId,
            90,                     // score
            bytes32("annotation"),  // tag1
            bytes32("quality"),     // tag2
            "ipfs://QmMockFeedbackReport",
            keccak256("feedback-evidence"),
            feedbackAuth
        );
        vm.stopPrank();
        console.log("Feedback given: score=90");

        // Verify reputation
        uint256 score = reputationRegistry.getScore(agentId);
        assertEq(score, 90);

        // ========================================
        // Summary
        // ========================================
        console.log("\n=== Demo Complete ===");
        console.log("Agent ID:", agentId);
        console.log("Codatta DID: 0x12345678abcdef0012345678abcdef00");
        console.log("Reputation Score:", score);
        console.log("Validation Score:", response);
        console.log("Job Status: Completed");
        console.log("Total Earned:", (token.balanceOf(deployer) - providerBalBefore) / 1e18, "XNY");
    }

    // --- Helper: Build feedbackAuth bytes ---

    function _buildFeedbackAuth(
        uint256 _agentId,
        address _clientAddress,
        uint64 _indexLimit,
        uint256 _expiry,
        uint256 _chainId,
        address _identityRegistry,
        address _signerAddress
    ) internal view returns (bytes memory) {
        // 224 bytes ABI-encoded struct
        bytes memory encoded = abi.encode(
            _agentId,
            _clientAddress,
            _indexLimit,
            _expiry,
            _chainId,
            _identityRegistry,
            _signerAddress
        );

        // Sign with deployer's private key
        bytes32 messageHash = keccak256(encoded);
        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(deployerKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Concatenate: 224 bytes struct + 65 bytes signature = 289 bytes
        return abi.encodePacked(encoded, signature);
    }
}
