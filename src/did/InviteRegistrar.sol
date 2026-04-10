// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {IDIDRegistry} from "./IDIDRegistry.sol";
import {DIDGenerator} from "../erc8004/lib/DIDGenerator.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title InviteRegistrar
 * @notice Registers DIDs using signed invite codes. Supports both self-registration
 *         and proxy registration (Provider registers on behalf of Client).
 *
 * Self-registration flow:
 *   1. Client calls registerWithInvite(inviter, nonce, signature)
 *   2. DID owner = msg.sender
 *
 * Proxy registration flow:
 *   1. Provider calls registerFor(owner, inviter, nonce, signature)
 *   2. DID owner = specified owner address (e.g., Client's owner wallet)
 *   3. Provider pays gas, Client doesn't need ETH
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
     * @notice Register a DID using a signed invite code (self-registration)
     * @param inviter The provider who generated the invite
     * @param nonce Unique nonce for this invite (prevents replay)
     * @param signature Invite Service's signature over (inviter, owner, nonce, chainId, contractAddress)
     */
    function registerWithInvite(
        address inviter,
        uint256 nonce,
        bytes calldata signature
    ) external {
        _register(msg.sender, inviter, nonce, signature);
    }

    /**
     * @notice Register a DID on behalf of another address (proxy registration)
     * @dev Allows Provider to register DID for a Client who has no ETH.
     *      The signature must be over the actual owner address, not msg.sender.
     * @param owner The address that will own the DID
     * @param inviter The provider who generated the invite
     * @param nonce Unique nonce for this invite (prevents replay)
     * @param signature Invite Service's signature over (inviter, owner, nonce, chainId, contractAddress)
     */
    function registerFor(
        address owner,
        address inviter,
        uint256 nonce,
        bytes calldata signature
    ) external {
        require(owner != address(0), "Invalid owner");
        _register(owner, inviter, nonce, signature);
    }

    function _register(
        address owner,
        address inviter,
        uint256 nonce,
        bytes calldata signature
    ) internal {
        require(!usedNonces[nonce], "Invite already used");

        // Verify signature: Invite Service signed (inviter, owner, nonce, chainId, contractAddress)
        bytes32 messageHash = keccak256(
            abi.encodePacked(inviter, owner, nonce, block.chainid, address(this))
        );
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        address recovered = ethSignedHash.recover(signature);
        require(recovered == inviteSigner, "Invalid invite signature");

        // Mark nonce as used
        usedNonces[nonce] = true;

        // Register DID with specified owner
        uint128 identifier = DIDGenerator.generateUuidv4Uint128();
        registry.register(identifier, owner);

        emit InviteRegistered(identifier, owner, inviter, nonce);
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
