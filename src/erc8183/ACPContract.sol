// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IACP} from "./IACP.sol";
import {IACPHook} from "./IACPHook.sol";

/// @title ACPContract - ERC-8183 Agentic Commerce Protocol
/// @notice Escrow-based job marketplace: Client creates jobs, Provider executes, Evaluator verifies
contract ACPContract is IACP {
    using SafeERC20 for IERC20;

    struct Job {
        address client;
        address provider;
        address evaluator;
        uint256 expiredAt;
        string description;
        address hook;
        uint256 budget;
        JobStatus status;
        string deliverable;
    }

    IERC20 public immutable paymentToken;
    address public treasury;
    uint16 public platformFeeBps;
    uint16 public evaluatorFeeBps;

    mapping(uint256 => Job) public jobs;
    uint256 public nextJobId = 1;

    constructor(
        address _paymentToken,
        address _treasury,
        uint16 _platformFeeBps,
        uint16 _evaluatorFeeBps
    ) {
        require(_paymentToken != address(0), "bad token");
        require(_treasury != address(0), "bad treasury");
        require(_platformFeeBps + _evaluatorFeeBps <= 10000, "fees too high");
        paymentToken = IERC20(_paymentToken);
        treasury = _treasury;
        platformFeeBps = _platformFeeBps;
        evaluatorFeeBps = _evaluatorFeeBps;
    }

    // --- Modifiers ---

    modifier onlyClient(uint256 jobId) {
        require(msg.sender == jobs[jobId].client, "not client");
        _;
    }

    modifier onlyProvider(uint256 jobId) {
        require(msg.sender == jobs[jobId].provider, "not provider");
        _;
    }

    modifier onlyEvaluator(uint256 jobId) {
        require(msg.sender == jobs[jobId].evaluator, "not evaluator");
        _;
    }

    modifier inStatus(uint256 jobId, JobStatus expected) {
        require(jobs[jobId].status == expected, "wrong status");
        _;
    }

    // --- Core Functions ---

    function createJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        address hook
    ) external returns (uint256 jobId) {
        require(evaluator != address(0), "no evaluator");
        require(expiredAt > block.timestamp, "expired");

        jobId = nextJobId++;
        jobs[jobId] = Job({
            client: msg.sender,
            provider: provider,
            evaluator: evaluator,
            expiredAt: expiredAt,
            description: description,
            hook: hook,
            budget: 0,
            status: JobStatus.Open,
            deliverable: ""
        });

        emit JobCreated(jobId, msg.sender, provider, evaluator, expiredAt, description, hook);
    }

    function setProvider(uint256 jobId, address provider, bytes calldata optParams)
        external onlyClient(jobId) inStatus(jobId, JobStatus.Open)
    {
        _callHookBefore(jobId, IACP.setProvider.selector, optParams);
        jobs[jobId].provider = provider;
        emit ProviderSet(jobId, provider);
        _callHookAfter(jobId, IACP.setProvider.selector, optParams);
    }

    function setBudget(uint256 jobId, uint256 amount, bytes calldata optParams)
        external inStatus(jobId, JobStatus.Open)
    {
        require(
            msg.sender == jobs[jobId].client || msg.sender == jobs[jobId].provider,
            "not client or provider"
        );
        _callHookBefore(jobId, IACP.setBudget.selector, optParams);
        jobs[jobId].budget = amount;
        emit BudgetSet(jobId, amount);
        _callHookAfter(jobId, IACP.setBudget.selector, optParams);
    }

    function fund(uint256 jobId, uint256 expectedBudget, bytes calldata optParams)
        external onlyClient(jobId) inStatus(jobId, JobStatus.Open)
    {
        Job storage job = jobs[jobId];
        require(job.provider != address(0), "no provider");
        require(job.budget > 0, "no budget");
        require(job.budget == expectedBudget, "budget mismatch");

        _callHookBefore(jobId, IACP.fund.selector, optParams);

        paymentToken.safeTransferFrom(msg.sender, address(this), job.budget);
        job.status = JobStatus.Funded;

        emit JobFunded(jobId, job.budget);
        _callHookAfter(jobId, IACP.fund.selector, optParams);
    }

    function submit(uint256 jobId, string calldata deliverable, bytes calldata optParams)
        external onlyProvider(jobId) inStatus(jobId, JobStatus.Funded)
    {
        _callHookBefore(jobId, IACP.submit.selector, optParams);

        jobs[jobId].deliverable = deliverable;
        jobs[jobId].status = JobStatus.Submitted;

        emit JobSubmitted(jobId, deliverable);
        _callHookAfter(jobId, IACP.submit.selector, optParams);
    }

    function complete(uint256 jobId, bytes32 reason, bytes calldata optParams)
        external onlyEvaluator(jobId) inStatus(jobId, JobStatus.Submitted)
    {
        _callHookBefore(jobId, IACP.complete.selector, optParams);

        Job storage job = jobs[jobId];
        job.status = JobStatus.Completed;

        // Distribute funds
        uint256 platformFee = job.budget * platformFeeBps / 10000;
        uint256 evaluatorFee = job.budget * evaluatorFeeBps / 10000;
        uint256 providerPayment = job.budget - platformFee - evaluatorFee;

        if (platformFee > 0) {
            paymentToken.safeTransfer(treasury, platformFee);
        }
        if (evaluatorFee > 0) {
            paymentToken.safeTransfer(job.evaluator, evaluatorFee);
        }
        paymentToken.safeTransfer(job.provider, providerPayment);

        emit JobCompleted(jobId, msg.sender, reason);
        emit PaymentReleased(jobId, job.provider, providerPayment);
        _callHookAfter(jobId, IACP.complete.selector, optParams);
    }

    function reject(uint256 jobId, bytes32 reason, bytes calldata optParams) external {
        Job storage job = jobs[jobId];

        if (job.status == JobStatus.Open) {
            require(msg.sender == job.client, "not client");
        } else if (job.status == JobStatus.Funded || job.status == JobStatus.Submitted) {
            require(msg.sender == job.evaluator, "not evaluator");
        } else {
            revert("wrong status");
        }

        _callHookBefore(jobId, IACP.reject.selector, optParams);

        job.status = JobStatus.Rejected;

        // Refund if funded
        if (job.budget > 0) {
            uint256 refundAmount = job.budget;
            // Only refund if tokens were actually transferred (status was Funded or Submitted)
            if (job.status == JobStatus.Rejected) {
                paymentToken.safeTransfer(job.client, refundAmount);
                emit Refunded(jobId, job.client, refundAmount);
            }
        }

        emit JobRejected(jobId, msg.sender, reason);
        _callHookAfter(jobId, IACP.reject.selector, optParams);
    }

    /// @notice Claim refund after job expiry. NOT hookable per ERC-8183 spec.
    function claimRefund(uint256 jobId) external {
        Job storage job = jobs[jobId];
        require(block.timestamp >= job.expiredAt, "not expired");
        require(
            job.status == JobStatus.Open ||
            job.status == JobStatus.Funded ||
            job.status == JobStatus.Submitted,
            "terminal status"
        );

        job.status = JobStatus.Expired;

        // Refund if funded
        if (job.status == JobStatus.Expired && job.budget > 0) {
            paymentToken.safeTransfer(job.client, job.budget);
            emit Refunded(jobId, job.client, job.budget);
        }

        emit JobExpired(jobId);
    }

    // --- View Functions ---

    function getJob(uint256 jobId) external view returns (
        address client, address provider, address evaluator,
        uint256 expiredAt, uint256 budget, JobStatus status,
        string memory description, string memory deliverable
    ) {
        Job storage job = jobs[jobId];
        return (job.client, job.provider, job.evaluator,
                job.expiredAt, job.budget, job.status,
                job.description, job.deliverable);
    }

    // --- Internal ---

    function _callHookBefore(uint256 jobId, bytes4 selector, bytes calldata data) internal {
        address hook = jobs[jobId].hook;
        if (hook != address(0)) {
            IACPHook(hook).beforeAction(jobId, selector, data);
        }
    }

    function _callHookAfter(uint256 jobId, bytes4 selector, bytes calldata data) internal {
        address hook = jobs[jobId].hook;
        if (hook != address(0)) {
            IACPHook(hook).afterAction(jobId, selector, data);
        }
    }
}
