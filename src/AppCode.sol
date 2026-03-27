// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ERC-8021 AppCode
/// @notice Codatta's AppCode for ERC-8021 transaction tracking
/// @dev AppCode is an application-defined identifier. The protocol uses it
///      to look up the beneficiary address and route revenue share.
///      We do NOT impose internal encoding — it is just an opaque ID.
contract AppCodeTracker {
    /// @notice Emitted when an AppCode is attached to a transaction
    event AppCodeUsed(
        address indexed sender,
        uint64 indexed appCode,
        bytes32 indexed transactionId,
        bytes32 evidence
    );

    /// @notice Track a transaction with AppCode
    /// @param appCode The application-defined AppCode identifier
    /// @param transactionId Unique transaction identifier
    /// @param evidence Additional evidence/data hash
    function track(uint64 appCode, bytes32 transactionId, bytes32 evidence) external {
        emit AppCodeUsed(msg.sender, appCode, transactionId, evidence);
    }
}
