// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IACP - ERC-8183 Agentic Commerce Protocol Interface
interface IACP {
    enum JobStatus { Open, Funded, Submitted, Completed, Rejected, Expired }

    event JobCreated(
        uint256 indexed jobId, address indexed client,
        address provider, address indexed evaluator,
        uint256 expiredAt, string description, address hook
    );
    event ProviderSet(uint256 indexed jobId, address indexed newProvider);
    event BudgetSet(uint256 indexed jobId, uint256 newBudget);
    event JobFunded(uint256 indexed jobId, uint256 amount);
    event JobSubmitted(uint256 indexed jobId, string deliverable);
    event JobCompleted(uint256 indexed jobId, address indexed evaluator, bytes32 reason);
    event JobRejected(uint256 indexed jobId, address indexed rejector, bytes32 reason);
    event JobExpired(uint256 indexed jobId);
    event PaymentReleased(uint256 indexed jobId, address indexed provider, uint256 amount);
    event Refunded(uint256 indexed jobId, address indexed client, uint256 amount);

    function createJob(
        address provider, address evaluator, uint256 expiredAt,
        string calldata description, address hook
    ) external returns (uint256 jobId);

    function setProvider(uint256 jobId, address provider, bytes calldata optParams) external;
    function setBudget(uint256 jobId, uint256 amount, bytes calldata optParams) external;
    function fund(uint256 jobId, uint256 expectedBudget, bytes calldata optParams) external;
    function submit(uint256 jobId, string calldata deliverable, bytes calldata optParams) external;
    function complete(uint256 jobId, bytes32 reason, bytes calldata optParams) external;
    function reject(uint256 jobId, bytes32 reason, bytes calldata optParams) external;
    function claimRefund(uint256 jobId) external;
}
