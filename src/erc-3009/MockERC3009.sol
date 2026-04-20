// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import { ERC20 } from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC3009
 * @dev ERC20 with EIP-3009 (TransferWithAuthorization) support for x402 payments.
 *      Based on the EIP-3009 spec: https://eips.ethereum.org/EIPS/eip-3009
 *
 *      This is a MOCK token for demo purposes. In production, use USDC or a
 *      real ERC-3009 compliant stablecoin.
 */
contract MockERC3009 is ERC20 {
    // EIP-712 domain separator typehash
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        keccak256(
            "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
        );

    // EIP-712 domain separator (immutable — depends on deployment address and chain)
    bytes32 public immutable DOMAIN_SEPARATOR;

    // Nonces for TransferWithAuthorization (from => nonce => used)
    mapping(address => mapping(bytes32 => bool)) private _authorizationStates;

    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
    event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce);

    constructor() ERC20("USD Coin", "USDC") {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("MockERC3009"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
        _mint(msg.sender, 10_000_000 * 10 ** 6); // 10M USDC (6 decimals)
    }

    /**
     * @dev Returns the current nonce for an authorizer.
     */
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool) {
        return _authorizationStates[authorizer][nonce];
    }

    /**
     * @dev TransferWithAuthorization - EIP-3009
     *      Allows a sender to authorize a third party to transfer tokens on their behalf.
     */
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(block.timestamp > validAfter, "TransferWithAuthorization: not yet valid");
        require(block.timestamp < validBefore, "TransferWithAuthorization: expired");
        require(!_authorizationStates[from][nonce], "TransferWithAuthorization: already used");

        bytes32 domainSeparator = DOMAIN_SEPARATOR;
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        address signer = ecrecover(digest, v, r, s);
        require(signer == from, "TransferWithAuthorization: invalid signature");
        require(signer != address(0), "TransferWithAuthorization: invalid signature");

        _authorizationStates[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);

        _transfer(from, to, value);
    }

    /**
     * @dev Cancel an authorization before it is used (not part of EIP-3009 spec, added for safety)
     */
    function cancelAuthorization(
        address authorizer,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(msg.sender == authorizer, "cancelAuthorization: not authorized");
        require(!_authorizationStates[authorizer][nonce], "cancelAuthorization: already used");

        bytes32 domainSeparator = DOMAIN_SEPARATOR;
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                authorizer,
                address(0),
                0,
                0,
                type(uint256).max,
                nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        address signer = ecrecover(digest, v, r, s);
        require(signer == authorizer, "cancelAuthorization: invalid signature");

        _authorizationStates[authorizer][nonce] = true;
        emit AuthorizationCanceled(authorizer, nonce);
    }
}
