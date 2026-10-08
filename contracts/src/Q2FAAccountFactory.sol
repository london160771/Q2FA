// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Q2FAAccount} from "./Q2FAAccount.sol";

/// @title Q2FAAccountFactory
/// @notice Creates one Q2FA account per EVM owner and provides onchain discovery.
contract Q2FAAccountFactory {
    uint256 public constant ARC_MAINNET_CHAIN_ID = 5_042;
    mapping(address owner => address account) public accountOf;
    mapping(address account => uint256 blockNumber) public accountCreatedBlock;
    mapping(address account => address owner) private ownerOfAccount;

    error ZeroGuardian();
    error AccountAlreadyExists(address owner, address account);
    error UnregisteredAccount();
    error InvalidOwnerChange();
    error WrongChain(uint256 actualChainId);

    event AccountCreated(address indexed owner, address indexed account, bytes32 guardianKey);
    event AccountOwnerChanged(address indexed previousOwner, address indexed newOwner, address indexed account);

    function createAccount(bytes32 guardianKey) external returns (address account) {
        if (block.chainid != ARC_MAINNET_CHAIN_ID) revert WrongChain(block.chainid);
        if (guardianKey == bytes32(0)) revert ZeroGuardian();
        address existing = accountOf[msg.sender];
        if (existing != address(0)) revert AccountAlreadyExists(msg.sender, existing);

        account = address(new Q2FAAccount(msg.sender, guardianKey, address(this)));
        accountOf[msg.sender] = account;
        ownerOfAccount[account] = msg.sender;
        accountCreatedBlock[account] = block.number;
        emit AccountCreated(msg.sender, account, guardianKey);
    }

    /// @dev Called atomically by a registered account after its two-factor owner change.
    function onOwnerChanged(address previousOwner, address newOwner) external {
        if (newOwner == address(0) || previousOwner == newOwner) revert InvalidOwnerChange();
        if (ownerOfAccount[msg.sender] != previousOwner || accountOf[previousOwner] != msg.sender) {
            revert UnregisteredAccount();
        }
        address existing = accountOf[newOwner];
        if (existing != address(0)) revert AccountAlreadyExists(newOwner, existing);

        delete accountOf[previousOwner];
        accountOf[newOwner] = msg.sender;
        ownerOfAccount[msg.sender] = newOwner;
        emit AccountOwnerChanged(previousOwner, newOwner, msg.sender);
    }
}
