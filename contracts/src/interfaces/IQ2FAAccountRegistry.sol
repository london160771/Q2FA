// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IQ2FAAccountRegistry {
    function onOwnerChanged(address previousOwner, address newOwner) external;
}
