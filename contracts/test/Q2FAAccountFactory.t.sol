// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Q2FAAccount} from "../src/Q2FAAccount.sol";
import {Q2FAAccountFactory} from "../src/Q2FAAccountFactory.sol";

interface FactoryVm {
    function etch(address target, bytes calldata code) external;
    function prank(address sender) external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
    function chainId(uint256 newChainId) external;
}

contract AcceptingPQVerifier {
    function verifySlhDsaSha2128s(bytes calldata, bytes calldata, bytes calldata) external pure returns (bool) {
        return true;
    }
}

contract Q2FAAccountFactoryTest {
    FactoryVm private constant vm = FactoryVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant PQ_VERIFIER = 0x1800000000000000000000000000000000000004;
    address private constant OWNER_A = address(0xA11CE);
    address private constant OWNER_B = address(0xB0B);
    bytes32 private constant GUARDIAN_A = keccak256("guardian A");
    bytes32 private constant GUARDIAN_B = keccak256("guardian B");

    Q2FAAccountFactory private factory;

    function setUp() public {
        vm.chainId(5_042);
        factory = new Q2FAAccountFactory();
    }

    function testCreatesAccountForCallerAndRecordsDeploymentBlock() public {
        uint256 createdAt = block.number;
        vm.prank(OWNER_A);
        address accountAddress = factory.createAccount(GUARDIAN_A);

        Q2FAAccount account = Q2FAAccount(accountAddress);
        require(account.owner() == OWNER_A, "owner was not msg.sender");
        require(account.guardianKey() == GUARDIAN_A, "guardian mismatch");
        require(account.registry() == address(factory), "registry mismatch");
        require(factory.accountOf(OWNER_A) == accountAddress, "account was not registered");
        require(factory.accountOf(OWNER_B) == address(0), "another owner was registered");
        require(factory.accountCreatedBlock(accountAddress) == createdAt, "creation block mismatch");
    }

    function testDuplicateAccountCreationIsRejected() public {
        vm.prank(OWNER_A);
        address first = factory.createAccount(GUARDIAN_A);

        vm.expectRevert(abi.encodeWithSelector(Q2FAAccountFactory.AccountAlreadyExists.selector, OWNER_A, first));
        vm.prank(OWNER_A);
        factory.createAccount(GUARDIAN_B);
        require(factory.accountOf(OWNER_A) == first, "duplicate changed the registry");
    }

    function testEachOwnerHasAnIndependentGuardian() public {
        address accountA = _create(OWNER_A, GUARDIAN_A);
        address accountB = _create(OWNER_B, GUARDIAN_B);
        require(Q2FAAccount(accountA).guardianKey() == GUARDIAN_A, "owner A guardian mismatch");
        require(Q2FAAccount(accountB).guardianKey() == GUARDIAN_B, "owner B guardian mismatch");
        require(accountA != accountB, "owners share one account");
    }

    function testZeroGuardianIsRejected() public {
        vm.expectRevert(Q2FAAccountFactory.ZeroGuardian.selector);
        vm.prank(OWNER_A);
        factory.createAccount(bytes32(0));
        require(factory.accountOf(OWNER_A) == address(0), "zero guardian created an account");
    }

    function testAccountCreationRejectsNonArcChain() public {
        vm.chainId(1);
        vm.expectRevert(abi.encodeWithSelector(Q2FAAccountFactory.WrongChain.selector, 1));
        vm.prank(OWNER_A);
        factory.createAccount(GUARDIAN_A);
        require(factory.accountOf(OWNER_A) == address(0), "wrong chain created an account");
    }

    function testOnlyRegisteredAccountCanUpdateOwnerRegistry() public {
        vm.expectRevert(Q2FAAccountFactory.UnregisteredAccount.selector);
        vm.prank(OWNER_A);
        factory.onOwnerChanged(OWNER_A, OWNER_B);
        require(factory.accountOf(OWNER_A) == address(0), "unregistered caller changed mapping");
    }

    function testTwoFactorOwnerChangeMovesAccountDiscovery() public {
        address accountAddress = _create(OWNER_A, GUARDIAN_A);
        _installAcceptingVerifier();

        vm.prank(OWNER_A);
        Q2FAAccount(accountAddress).changeOwner(OWNER_B, type(uint256).max, new bytes(7_856));

        require(Q2FAAccount(accountAddress).owner() == OWNER_B, "account owner not changed");
        require(factory.accountOf(OWNER_A) == address(0), "old owner still discovers account");
        require(factory.accountOf(OWNER_B) == accountAddress, "new owner cannot discover account");
        require(factory.accountCreatedBlock(accountAddress) != 0, "creation block was lost");
    }

    function testOwnerChangeCannotReplaceAnExistingOwnerAccount() public {
        address accountA = _create(OWNER_A, GUARDIAN_A);
        address accountB = _create(OWNER_B, GUARDIAN_B);
        _installAcceptingVerifier();

        vm.expectRevert(abi.encodeWithSelector(Q2FAAccountFactory.AccountAlreadyExists.selector, OWNER_B, accountB));
        vm.prank(OWNER_A);
        Q2FAAccount(accountA).changeOwner(OWNER_B, type(uint256).max, new bytes(7_856));

        require(Q2FAAccount(accountA).owner() == OWNER_A, "failed owner change mutated account");
        require(Q2FAAccount(accountA).nonce() == 0, "failed owner change consumed nonce");
        require(factory.accountOf(OWNER_A) == accountA, "failed owner change damaged old mapping");
        require(factory.accountOf(OWNER_B) == accountB, "existing owner mapping changed");
    }

    function _create(address owner, bytes32 guardian) private returns (address account) {
        vm.prank(owner);
        account = factory.createAccount(guardian);
    }

    function _installAcceptingVerifier() private {
        AcceptingPQVerifier verifier = new AcceptingPQVerifier();
        vm.etch(PQ_VERIFIER, address(verifier).code);
    }
}
