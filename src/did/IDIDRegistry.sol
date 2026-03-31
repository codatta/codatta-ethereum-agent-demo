// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

interface IDIDRegistry {
    struct KvAttribute {
        string name;
        bytes value;
    }

    struct ArrayAttribute {
        string name;
        ArrayAttributeItem[] values;
    }

    struct ArrayAttributeItem {
        bytes value;
        bool revoked;
    }

    function register(uint128 identifier, address owner) external;
    function transferOwner(uint128 identifier, address to) external;
    function addItemToAttribute(uint128 identifier, uint128 operator, string calldata name, bytes calldata value)
        external;
    function getDidDocument(uint128 identifier)
        external
        view
        returns (
            uint128 id,
            address owner,
            uint128[] memory controller,
            KvAttribute[] memory kvAttributes,
            ArrayAttribute[] memory arrayAttributes
        );
}
