// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IACPHook - ERC-8183 Hook Interface
/// @notice Allows custom logic before/after ACP contract actions
interface IACPHook {
    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external;
    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external;
}
