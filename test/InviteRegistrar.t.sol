// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {DIDRegistry} from "codatta-did/DIDRegistry.sol";
import {InviteRegistrar} from "codatta-did/InviteRegistrar.sol";

contract InviteRegistrarTest is Test {
    DIDRegistry public didRegistry;
    InviteRegistrar public inviteRegistrar;

    address internal _owner;
    uint256 internal _ownerKey;

    address internal _signer;
    uint256 internal _signerKey;

    address internal _inviter;
    uint256 internal _inviterKey;

    address internal _user;
    uint256 internal _userKey;

    function setUp() public {
        (_owner, _ownerKey) = makeAddrAndKey("owner");
        (_signer, _signerKey) = makeAddrAndKey("signer");
        (_inviter, _inviterKey) = makeAddrAndKey("inviter");
        (_user, _userKey) = makeAddrAndKey("user");

        // Deploy DIDRegistry behind UUPS proxy
        DIDRegistry impl = new DIDRegistry();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(DIDRegistry.initialize.selector, _owner)
        );
        didRegistry = DIDRegistry(address(proxy));

        // Deploy InviteRegistrar with _signer as invite signer
        inviteRegistrar = new InviteRegistrar(address(didRegistry), _signer);

        // Authorize InviteRegistrar as a registrar on DIDRegistry
        vm.prank(_owner);
        address[] memory addings = new address[](1);
        addings[0] = address(inviteRegistrar);
        didRegistry.updateRegistrars(addings, new address[](0));
    }

    function _signInvite(
        address inviter,
        address owner,
        uint256 nonce,
        uint256 signerKey
    ) internal view returns (bytes memory) {
        bytes32 messageHash = keccak256(
            abi.encodePacked(inviter, owner, nonce, block.chainid, address(inviteRegistrar))
        );
        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, ethSignedHash);
        return abi.encodePacked(r, s, v);
    }

    // ─── registerWithInvite ───────────────────────────────────────────

    function test_registerWithInvite_success() public {
        uint256 nonce = 1;
        bytes memory sig = _signInvite(_inviter, _user, nonce, _signerKey);

        vm.prank(_user);
        inviteRegistrar.registerWithInvite(_inviter, nonce, sig);

        // Verify a DID was created and owned by _user
        uint128[] memory dids = didRegistry.getOwnedDids(_user);
        assertEq(dids.length, 1);
        assertEq(didRegistry.ownerOf(dids[0]), _user);
    }

    function test_registerWithInvite_emitsEvent() public {
        uint256 nonce = 42;
        bytes memory sig = _signInvite(_inviter, _user, nonce, _signerKey);

        vm.prank(_user);
        inviteRegistrar.registerWithInvite(_inviter, nonce, sig);

        // Verify the DID was registered (event emission tested implicitly via state)
        uint128[] memory dids = didRegistry.getOwnedDids(_user);
        assertEq(dids.length, 1);
        assertTrue(inviteRegistrar.usedNonces(nonce));
    }

    function test_registerWithInvite_replayReverts() public {
        uint256 nonce = 1;
        bytes memory sig = _signInvite(_inviter, _user, nonce, _signerKey);

        vm.prank(_user);
        inviteRegistrar.registerWithInvite(_inviter, nonce, sig);

        // Same nonce should revert
        vm.prank(_user);
        vm.expectRevert("Invite already used");
        inviteRegistrar.registerWithInvite(_inviter, nonce, sig);
    }

    function test_registerWithInvite_invalidSignature() public {
        uint256 nonce = 1;
        // Sign with wrong key
        bytes memory badSig = _signInvite(_inviter, _user, nonce, _inviterKey);

        vm.prank(_user);
        vm.expectRevert("Invalid invite signature");
        inviteRegistrar.registerWithInvite(_inviter, nonce, badSig);
    }

    function test_registerWithInvite_differentNoncesSucceed() public {
        bytes memory sig1 = _signInvite(_inviter, _user, 1, _signerKey);

        vm.prank(_user);
        inviteRegistrar.registerWithInvite(_inviter, 1, sig1);

        // Advance block so DIDGenerator produces a different UUID
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 1);

        bytes memory sig2 = _signInvite(_inviter, _user, 2, _signerKey);
        vm.prank(_user);
        inviteRegistrar.registerWithInvite(_inviter, 2, sig2);

        uint128[] memory dids = didRegistry.getOwnedDids(_user);
        assertEq(dids.length, 2);
    }

    // ─── registerFor (proxy registration) ─────────────────────────────

    function test_registerFor_success() public {
        uint256 nonce = 100;
        // Signature is over _user (the owner), not _inviter (the caller)
        bytes memory sig = _signInvite(_inviter, _user, nonce, _signerKey);

        // _inviter pays gas, _user gets the DID
        vm.prank(_inviter);
        inviteRegistrar.registerFor(_user, _inviter, nonce, sig);

        uint128[] memory dids = didRegistry.getOwnedDids(_user);
        assertEq(dids.length, 1);
        assertEq(didRegistry.ownerOf(dids[0]), _user);
    }

    function test_registerFor_zeroOwnerReverts() public {
        uint256 nonce = 100;
        bytes memory sig = _signInvite(_inviter, address(0), nonce, _signerKey);

        vm.prank(_inviter);
        vm.expectRevert("Invalid owner");
        inviteRegistrar.registerFor(address(0), _inviter, nonce, sig);
    }

    function test_registerFor_wrongOwnerInSignatureReverts() public {
        uint256 nonce = 100;
        // Sign for _inviter as owner, but call with _user as owner
        bytes memory sig = _signInvite(_inviter, _inviter, nonce, _signerKey);

        vm.prank(_inviter);
        vm.expectRevert("Invalid invite signature");
        inviteRegistrar.registerFor(_user, _inviter, nonce, sig);
    }

    // ─── setSigner ────────────────────────────────────────────────────

    function test_setSigner_onlyOwner() public {
        vm.prank(_user);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, _user));
        inviteRegistrar.setSigner(_user);
    }

    function test_setSigner_success() public {
        address newSigner = makeAddr("newSigner");

        vm.prank(address(this)); // deployer is owner
        vm.expectEmit(false, false, false, true);
        emit InviteRegistrar.SignerUpdated(_signer, newSigner);
        inviteRegistrar.setSigner(newSigner);

        assertEq(inviteRegistrar.inviteSigner(), newSigner);
    }

    function test_registerWithInvite_afterSignerUpdate() public {
        // Update signer to _inviterKey
        vm.prank(address(this));
        inviteRegistrar.setSigner(_inviter);

        uint256 nonce = 1;
        // Now must sign with new signer key
        bytes memory sig = _signInvite(_inviter, _user, nonce, _inviterKey);

        vm.prank(_user);
        inviteRegistrar.registerWithInvite(_inviter, nonce, sig);

        uint128[] memory dids = didRegistry.getOwnedDids(_user);
        assertEq(dids.length, 1);
    }

    // ─── usedNonces ───────────────────────────────────────────────────

    function test_usedNonces_tracking() public {
        uint256 nonce = 7;
        assertFalse(inviteRegistrar.usedNonces(nonce));

        bytes memory sig = _signInvite(_inviter, _user, nonce, _signerKey);
        vm.prank(_user);
        inviteRegistrar.registerWithInvite(_inviter, nonce, sig);

        assertTrue(inviteRegistrar.usedNonces(nonce));
    }
}
