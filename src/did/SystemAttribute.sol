// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

library SystemAttribute {
    string constant RESERVE_ID = "id";
    string constant RESERVE_OWNER = "owner";
    string constant RESERVE_CONTROLLER = "controller";

    string constant ARRAY_ATTRIBUTE_CONTEXT = "@context";
    string constant ARRAY_ATTRIBUTE_VERIFICATION_METHOD = "verificationMethod";
    string constant ARRAY_ATTRIBUTE_ALSO_KNOW_AS = "alsoKnownAs";
    string constant ARRAY_ATTRIBUTE_AUTHENTICATION = "authentication";
    string constant ARRAY_ATTRIBUTE_ASSERTION_METHOD = "assertionMethod";
    string constant ARRAY_ATTRIBUTE_KEY_AGREEMENT = "keyAgreement";
    string constant ARRAY_ATTRIBUTE_CAPABILITY_INVOCATION = "capabilityInvocation";
    string constant ARRAY_ATTRIBUTE_CAPABILITY_DELEGATION = "capabilityDelegation";
    string constant ARRAY_ATTRIBUTE_SERVICE = "service";
}
