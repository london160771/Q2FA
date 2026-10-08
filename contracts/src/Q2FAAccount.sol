// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IArcPQVerifier} from "./interfaces/IArcPQVerifier.sol";
import {IArcUSDC} from "./interfaces/IArcUSDC.sol";
import {IQ2FAAccountRegistry} from "./interfaces/IQ2FAAccountRegistry.sol";

/// @title Q2FAAccount
/// @notice Arc Mainnet account requiring its EVM owner and SLH-DSA guardian for each protected action.
contract Q2FAAccount {
    address public constant PQ_VERIFIER = 0x1800000000000000000000000000000000000004;
    address public constant USDC = 0x3600000000000000000000000000000000000000;

    bytes32 public constant AUTHORIZATION_SCHEMA = bytes32("Q2FA_AUTH_V1");
    uint256 public constant PQ_PUBLIC_KEY_BYTES = 32;
    uint256 public constant PQ_SIGNATURE_BYTES = 7_856;

    enum Action {
        Withdraw,
        ChangeOwner,
        ChangeGuardian
    }

    address public owner;
    bytes32 public guardianKey;
    uint256 public nonce;
    address public immutable registry;

    error NotOwner();
    error AuthorizationExpired();
    error ZeroOwner();
    error ZeroGuardian();
    error ZeroRecipient();
    error ZeroAmount();
    error InvalidPQSignatureLength(uint256 actualLength);
    error InvalidPQSignature();
    error PQVerifierUnavailable();
    error USDCTransferFailed();

    event Withdrawal(address indexed recipient, uint256 amount, uint256 indexed nonce);
    event OwnerChanged(address indexed previousOwner, address indexed newOwner, uint256 indexed nonce);
    event GuardianChanged(bytes32 previousKey, bytes32 newKey, uint256 indexed nonce);

    constructor(address initialOwner, bytes32 initialGuardianKey, address accountRegistry) {
        if (initialOwner == address(0)) revert ZeroOwner();
        if (initialGuardianKey == bytes32(0)) revert ZeroGuardian();
        owner = initialOwner;
        guardianKey = initialGuardianKey;
        registry = accountRegistry;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @notice Returns the exact bytes to sign for the current nonce and supplied action fields.
    function authorizationPayload(
        Action action,
        bytes32 subject,
        uint256 amount,
        uint256 deadline
    ) external view returns (bytes memory) {
        return _encodeAuthorizationPayload(action, subject, amount, nonce, deadline);
    }

    /// @notice Withdraws the account's Arc USDC after both owner and PQ guardian approval.
    function withdraw(
        address recipient,
        uint256 amount,
        uint256 deadline,
        bytes calldata pqSignature
    ) external onlyOwner {
        if (recipient == address(0)) revert ZeroRecipient();
        if (amount == 0) revert ZeroAmount();

        uint256 usedNonce = _authorize(
            Action.Withdraw,
            bytes32(uint256(uint160(recipient))),
            amount,
            deadline,
            pqSignature
        );

        if (!IArcUSDC(USDC).transfer(recipient, amount)) revert USDCTransferFailed();
        emit Withdrawal(recipient, amount, usedNonce);
    }

    /// @notice Changes the EVM owner after approval by the current owner and current PQ guardian.
    function changeOwner(
        address newOwner,
        uint256 deadline,
        bytes calldata pqSignature
    ) external onlyOwner {
        if (newOwner == address(0)) revert ZeroOwner();

        uint256 usedNonce = _authorize(
            Action.ChangeOwner,
            bytes32(uint256(uint160(newOwner))),
            0,
            deadline,
            pqSignature
        );

        address previousOwner = owner;
        owner = newOwner;
        if (registry != address(0)) {
            IQ2FAAccountRegistry(registry).onOwnerChanged(previousOwner, newOwner);
        }
        emit OwnerChanged(previousOwner, newOwner, usedNonce);
    }

    /// @notice Changes the PQ guardian after approval by the current owner and current guardian.
    function changeGuardian(
        bytes32 newGuardianKey,
        uint256 deadline,
        bytes calldata pqSignature
    ) external onlyOwner {
        if (newGuardianKey == bytes32(0)) revert ZeroGuardian();

        uint256 usedNonce = _authorize(
            Action.ChangeGuardian,
            newGuardianKey,
            0,
            deadline,
            pqSignature
        );

        bytes32 previousKey = guardianKey;
        guardianKey = newGuardianKey;
        emit GuardianChanged(previousKey, newGuardianKey, usedNonce);
    }

    function _authorize(
        Action action,
        bytes32 subject,
        uint256 amount,
        uint256 deadline,
        bytes calldata pqSignature
    ) private returns (uint256 usedNonce) {
        if (deadline < block.timestamp) revert AuthorizationExpired();
        if (pqSignature.length != PQ_SIGNATURE_BYTES) {
            revert InvalidPQSignatureLength(pqSignature.length);
        }

        usedNonce = nonce;
        bytes memory message = _encodeAuthorizationPayload(action, subject, amount, usedNonce, deadline);

        bool valid;
        try IArcPQVerifier(PQ_VERIFIER).verifySlhDsaSha2128s(
            abi.encodePacked(guardianKey),
            message,
            pqSignature
        ) returns (bool isValid) {
            valid = isValid;
        } catch {
            revert PQVerifierUnavailable();
        }
        if (!valid) revert InvalidPQSignature();

        // Effects precede the USDC call; a later transfer failure reverts the nonce change as well.
        nonce = usedNonce + 1;
    }

    function _encodeAuthorizationPayload(
        Action action,
        bytes32 subject,
        uint256 amount,
        uint256 actionNonce,
        uint256 deadline
    ) private view returns (bytes memory) {
        return abi.encode(
            AUTHORIZATION_SCHEMA,
            block.chainid,
            address(this),
            uint8(action),
            subject,
            amount,
            actionNonce,
            deadline
        );
    }
}
