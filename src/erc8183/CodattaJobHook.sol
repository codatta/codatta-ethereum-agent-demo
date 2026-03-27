// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IACPHook} from "./IACPHook.sol";
import {IACP} from "./IACP.sol";

/// @title CodattaJobHook - Bridges ERC-8183 job events for off-chain agent
/// @notice Emits events on job completion/rejection for the TypeScript agent to
///         trigger ERC-8004 validation and reputation writes.
contract CodattaJobHook is IACPHook {
    address public immutable acpContract;

    event CodattaJobCompleted(uint256 indexed jobId);
    event CodattaJobRejected(uint256 indexed jobId);

    constructor(address _acpContract) {
        require(_acpContract != address(0), "bad acp");
        acpContract = _acpContract;
    }

    function beforeAction(uint256, bytes4, bytes calldata) external view {
        require(msg.sender == acpContract, "only ACP");
    }

    function afterAction(uint256 jobId, bytes4 selector, bytes calldata) external {
        require(msg.sender == acpContract, "only ACP");

        if (selector == IACP.complete.selector) {
            emit CodattaJobCompleted(jobId);
        } else if (selector == IACP.reject.selector) {
            emit CodattaJobRejected(jobId);
        }
    }
}
