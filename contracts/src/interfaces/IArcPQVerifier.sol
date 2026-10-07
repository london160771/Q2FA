// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IArcPQVerifier {
    function verifySlhDsaSha2128s(
        bytes calldata verifyingKey,
        bytes calldata message,
        bytes calldata signature
    ) external returns (bool isValid);
}
