// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {IDIDRegistry} from "./IDIDRegistry.sol";
import {DIDGenerator} from "../erc8004/lib/DIDGenerator.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title InviteRegistrar
 * @notice Registers DIDs using signed invite codes.
 *
 * Flow:
 *   1. Provider requests invite code from Invite Service
 *   2. Invite Service signs: keccak256(provider, client, nonce, chainId, contractAddress)
 *   3. Client calls registerWithInvite(inviteCode) → DID registered + invite recorded
 *
 * The invite code signature is verified against the authorized signer (Invite Service).
 * Each invite code (by nonce) can only be used once.
 */
contract InviteRegistrar is Ownable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    IDIDRegistry public registry;
    address public inviteSigner; // Invite Service's signing address

    // nonce → used (prevent replay)
    mapping(uint256 => bool) public usedNonces;

    event InviteRegistered(
        uint128 indexed identifier,
        address indexed owner,
        address indexed inviter,
        uint256 nonce
    );

    event SignerUpdated(address oldSigner, address newSigner);

    constructor(address _registry, address _inviteSigner) Ownable(msg.sender) {
        registry = IDIDRegistry(_registry);
        inviteSigner = _inviteSigner;
    }

    /**
     * @notice Register a DID using a signed invite code
     * @param inviter The provider who generated the invite
     * @param nonce Unique nonce for this invite (prevents replay)
     * @param signature Invite Service's signature over (inviter, client, nonce, chainId, contractAddress)
     */
    function registerWithInvite(
        address inviter,
        uint256 nonce,
        bytes calldata signature
    ) external {
        require(!usedNonces[nonce], "Invite already used");

        // Verify signature: Invite Service signed (inviter, client, nonce, chainId, contractAddress)
        bytes32 messageHash = keccak256(
            abi.encodePacked(inviter, msg.sender, nonce, block.chainid, address(this))
        );
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        address recovered = ethSignedHash.recover(signature);
        require(recovered == inviteSigner, "Invalid invite signature");

        // Mark nonce as used
        usedNonces[nonce] = true;

        // Register DID
        uint128 identifier = DIDGenerator.generateUuidv4Uint128();
        registry.register(identifier, msg.sender);

        emit InviteRegistered(identifier, msg.sender, inviter, nonce);
    }

    /**
     * @notice Update the authorized invite signer
     * @param newSigner New signer address
     */
    function setSigner(address newSigner) external onlyOwner {
        emit SignerUpdated(inviteSigner, newSigner);
        inviteSigner = newSigner;
    }
}
