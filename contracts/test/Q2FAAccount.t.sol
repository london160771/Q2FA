// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Q2FAAccount} from "../src/Q2FAAccount.sol";

interface Vm {
    function etch(address target, bytes calldata code) external;
    function prank(address sender) external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData, address emitter) external;
    function warp(uint256 timestamp) external;
}

contract MockArcPQVerifier {
    bytes private expectedKey;
    bytes private expectedMessage;
    bytes private expectedSignature;
    bool private expectedResult;
    bool private shouldRevert;

    function configure(bytes calldata key, bytes calldata message, bytes calldata signature, bool result) external {
        expectedKey = key;
        expectedMessage = message;
        expectedSignature = signature;
        expectedResult = result;
        shouldRevert = false;
    }

    function configureRevert() external {
        shouldRevert = true;
    }

    function verifySlhDsaSha2128s(
        bytes calldata key,
        bytes calldata message,
        bytes calldata signature
    ) external view returns (bool) {
        if (shouldRevert) revert("mock verifier unavailable");
        return expectedResult
            && keccak256(key) == keccak256(expectedKey)
            && keccak256(message) == keccak256(expectedMessage)
            && keccak256(signature) == keccak256(expectedSignature);
    }
}

contract MockArcUSDC {
    mapping(address => uint256) private balances;
    bool private transferFailure;
    address private reentryTarget;
    bytes private reentryData;
    bool public reentryAttempted;
    bool public reentrySucceeded;

    function mint(address recipient, uint256 amount) external {
        balances[recipient] += amount;
    }

    function setTransferFailure(bool shouldFail) external {
        transferFailure = shouldFail;
    }

    function setReentry(address target, bytes calldata data) external {
        reentryTarget = target;
        reentryData = data;
        reentryAttempted = false;
        reentrySucceeded = false;
    }

    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        if (transferFailure || balances[msg.sender] < amount) return false;

        if (reentryTarget != address(0)) {
            reentryAttempted = true;
            (reentrySucceeded,) = reentryTarget.call(reentryData);
        }

        balances[msg.sender] -= amount;
        balances[recipient] += amount;
        return true;
    }
}

contract Q2FAAccountTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant OWNER = address(0xA11CE);
    address private constant ATTACKER = address(0xB0B);
    address private constant RECIPIENT = address(0xCAFE);
    bytes32 private constant GUARDIAN = keccak256("current development guardian");
    bytes32 private constant NEW_GUARDIAN = keccak256("new development guardian");

    Q2FAAccount private account;
    MockArcPQVerifier private verifier;
    MockArcUSDC private usdc;

    function setUp() public {
        account = new Q2FAAccount(OWNER, GUARDIAN, address(0));

        MockArcPQVerifier verifierCode = new MockArcPQVerifier();
        vm.etch(account.PQ_VERIFIER(), address(verifierCode).code);
        verifier = MockArcPQVerifier(account.PQ_VERIFIER());

        MockArcUSDC usdcCode = new MockArcUSDC();
        vm.etch(account.USDC(), address(usdcCode).code);
        usdc = MockArcUSDC(account.USDC());
        usdc.mint(address(account), 1_000);
    }

    function testOwnerAndValidGuardianCanWithdraw() public {
        bytes memory signature = _signature();
        _expect(Q2FAAccount.Action.Withdraw, _addressSubject(RECIPIENT), 125, 0, 1_000, signature, true);

        vm.expectEmit(true, false, true, true, address(account));
        emit Q2FAAccount.Withdrawal(RECIPIENT, 125, 0);
        vm.prank(OWNER);
        account.withdraw(RECIPIENT, 125, 1_000, signature);

        require(usdc.balanceOf(RECIPIENT) == 125, "recipient balance");
        require(usdc.balanceOf(address(account)) == 875, "account balance");
        require(account.nonce() == 1, "nonce consumed");
    }

    function testOwnerAloneCannotWithdraw() public {
        vm.expectRevert(abi.encodeWithSelector(Q2FAAccount.InvalidPQSignatureLength.selector, 0));
        vm.prank(OWNER);
        account.withdraw(RECIPIENT, 1, 1_000, new bytes(0));
        require(account.nonce() == 0, "nonce changed on missing factor");
    }

    function testValidGuardianSignatureFromNonOwnerFails() public {
        bytes memory signature = _signature();
        _expect(Q2FAAccount.Action.Withdraw, _addressSubject(RECIPIENT), 1, 0, 1_000, signature, true);

        vm.expectRevert(Q2FAAccount.NotOwner.selector);
        vm.prank(ATTACKER);
        account.withdraw(RECIPIENT, 1, 1_000, signature);
        require(account.nonce() == 0, "nonce changed for non-owner");
    }

    function testChangedRecipientFails() public {
        bytes memory signature = _signature();
        _expect(Q2FAAccount.Action.Withdraw, _addressSubject(RECIPIENT), 1, 0, 1_000, signature, true);

        vm.expectRevert(Q2FAAccount.InvalidPQSignature.selector);
        vm.prank(OWNER);
        account.withdraw(address(0xD00D), 1, 1_000, signature);
        require(account.nonce() == 0, "nonce changed after recipient tampering");
    }

    function testChangedAmountFails() public {
        bytes memory signature = _signature();
        _expect(Q2FAAccount.Action.Withdraw, _addressSubject(RECIPIENT), 1, 0, 1_000, signature, true);

        vm.expectRevert(Q2FAAccount.InvalidPQSignature.selector);
        vm.prank(OWNER);
        account.withdraw(RECIPIENT, 2, 1_000, signature);
        require(account.nonce() == 0, "nonce changed after amount tampering");
    }

    function testChangedDeadlineFails() public {
        bytes memory signature = _signature();
        _expect(Q2FAAccount.Action.Withdraw, _addressSubject(RECIPIENT), 1, 0, 1_000, signature, true);

        vm.expectRevert(Q2FAAccount.InvalidPQSignature.selector);
        vm.prank(OWNER);
        account.withdraw(RECIPIENT, 1, 1_001, signature);
        require(account.nonce() == 0, "deadline tampering consumed nonce");
    }

    function testChangedActionFails() public {
        bytes memory signature = _signature();
        _expect(Q2FAAccount.Action.ChangeOwner, _addressSubject(RECIPIENT), 0, 0, 1_000, signature, true);

        vm.expectRevert(Q2FAAccount.InvalidPQSignature.selector);
        vm.prank(OWNER);
        account.withdraw(RECIPIENT, 1, 1_000, signature);
    }

    function testWrongAccountDomainFails() public {
        bytes memory signature = _signature();
        bytes memory wrongAccountMessage = _payload(
            block.chainid,
            address(0x1234),
            Q2FAAccount.Action.Withdraw,
            _addressSubject(RECIPIENT),
            1,
            0,
            1_000
        );
        verifier.configure(abi.encodePacked(GUARDIAN), wrongAccountMessage, signature, true);

        vm.expectRevert(Q2FAAccount.InvalidPQSignature.selector);
        vm.prank(OWNER);
        account.withdraw(RECIPIENT, 1, 1_000, signature);
    }

    function testSignatureForAnotherQ2FAAccountFails() public {
        bytes memory signature = _signature();
        _expect(Q2FAAccount.Action.Withdraw, _addressSubject(RECIPIENT), 1, 0, 1_000, signature, true);
        Q2FAAccount otherAccount = new Q2FAAccount(OWNER, GUARDIAN, address(0));

        vm.expectRevert(Q2FAAccount.InvalidPQSignature.selector);
        vm.prank(OWNER);
        otherAccount.withdraw(RECIPIENT, 1, 1_000, signature);
        require(account.nonce() == 0 && otherAccount.nonce() == 0, "cross-account authorization changed nonce");
    }

    function testWrongChainDomainFails() public {
        bytes memory signature = _signature();
        bytes memory wrongChainMessage = _payload(
            block.chainid + 1,
            address(account),
            Q2FAAccount.Action.Withdraw,
            _addressSubject(RECIPIENT),
            1,
            0,
            1_000
        );
        verifier.configure(abi.encodePacked(GUARDIAN), wrongChainMessage, signature, true);

        vm.expectRevert(Q2FAAccount.InvalidPQSignature.selector);
        vm.prank(OWNER);
        account.withdraw(RECIPIENT, 1, 1_000, signature);
    }

    function testSuccessfulAuthorizationCannotBeReused() public {
        bytes memory signature = _signature();
        _expect(Q2FAAccount.Action.Withdraw, _addressSubject(RECIPIENT), 1, 0, 1_000, signature, true);

        vm.prank(OWNER);
        account.withdraw(RECIPIENT, 1, 1_000, signature);
        vm.expectRevert(Q2FAAccount.InvalidPQSignature.selector);
        vm.prank(OWNER);
        account.withdraw(RECIPIENT, 1, 1_000, signature);

        require(account.nonce() == 1, "replay consumed nonce");
        require(usdc.balanceOf(RECIPIENT) == 1, "replay transferred twice");
    }

    function testStaleNonceFails() public {
        bytes memory signature = _signature();
        _expect(Q2FAAccount.Action.Withdraw, _addressSubject(RECIPIENT), 1, 1, 1_000, signature, true);

        vm.expectRevert(Q2FAAccount.InvalidPQSignature.selector);
        vm.prank(OWNER);
        account.withdraw(RECIPIENT, 1, 1_000, signature);
        require(account.nonce() == 0, "stale nonce consumed");
    }

    function testExpiredAuthorizationFails() public {
        vm.warp(1_001);
        vm.expectRevert(Q2FAAccount.AuthorizationExpired.selector);
        vm.prank(OWNER);
        account.withdraw(RECIPIENT, 1, 1_000, _signature());
        require(account.nonce() == 0, "expired authorization consumed nonce");
    }

    function testOwnerChangeRequiresBothFactorsAndEmitsValues() public {
        address nextOwner = address(0x5151);
        bytes memory signature = _signature();
        _expect(Q2FAAccount.Action.ChangeOwner, _addressSubject(nextOwner), 0, 0, 1_000, signature, true);

        vm.expectEmit(true, true, true, true, address(account));
        emit Q2FAAccount.OwnerChanged(OWNER, nextOwner, 0);
        vm.prank(OWNER);
        account.changeOwner(nextOwner, 1_000, signature);

        require(account.owner() == nextOwner, "owner not changed");
        require(account.nonce() == 1, "owner-change nonce");
    }

    function testOwnerChangeWithoutGuardianFails() public {
        vm.expectRevert(abi.encodeWithSelector(Q2FAAccount.InvalidPQSignatureLength.selector, 0));
        vm.prank(OWNER);
        account.changeOwner(address(0x5151), 1_000, new bytes(0));
        require(account.owner() == OWNER && account.nonce() == 0, "owner changed without guardian");
    }

    function testValidGuardianWithoutOwnerCannotChangeOwner() public {
        bytes memory signature = _signature();
        address nextOwner = address(0x5151);
        _expect(Q2FAAccount.Action.ChangeOwner, _addressSubject(nextOwner), 0, 0, 1_000, signature, true);

        vm.expectRevert(Q2FAAccount.NotOwner.selector);
        vm.prank(ATTACKER);
        account.changeOwner(nextOwner, 1_000, signature);
        require(account.owner() == OWNER && account.nonce() == 0, "guardian-only owner change succeeded");
    }

    function testZeroOwnerRejected() public {
        vm.expectRevert(Q2FAAccount.ZeroOwner.selector);
        vm.prank(OWNER);
        account.changeOwner(address(0), 1_000, _signature());
        require(account.owner() == OWNER && account.nonce() == 0, "zero owner accepted");
    }

    function testGuardianChangeRequiresCurrentGuardianAndEmitsValues() public {
        bytes memory signature = _signature();
        _expect(Q2FAAccount.Action.ChangeGuardian, NEW_GUARDIAN, 0, 0, 1_000, signature, true);

        vm.expectEmit(false, false, true, true, address(account));
        emit Q2FAAccount.GuardianChanged(GUARDIAN, NEW_GUARDIAN, 0);
        vm.prank(OWNER);
        account.changeGuardian(NEW_GUARDIAN, 1_000, signature);

        require(account.guardianKey() == NEW_GUARDIAN, "guardian not changed");
        require(account.nonce() == 1, "guardian-change nonce");
    }

    function testOwnerAloneCannotChangeGuardian() public {
        vm.expectRevert(abi.encodeWithSelector(Q2FAAccount.InvalidPQSignatureLength.selector, 0));
        vm.prank(OWNER);
        account.changeGuardian(NEW_GUARDIAN, 1_000, new bytes(0));
        require(account.guardianKey() == GUARDIAN && account.nonce() == 0, "owner-only guardian change succeeded");
    }

    function testValidGuardianWithoutOwnerCannotChangeGuardian() public {
        bytes memory signature = _signature();
        _expect(Q2FAAccount.Action.ChangeGuardian, NEW_GUARDIAN, 0, 0, 1_000, signature, true);

        vm.expectRevert(Q2FAAccount.NotOwner.selector);
        vm.prank(ATTACKER);
        account.changeGuardian(NEW_GUARDIAN, 1_000, signature);
        require(account.guardianKey() == GUARDIAN && account.nonce() == 0, "guardian-only rotation succeeded");
    }

    function testGuardianChangeAuthorizationCannotBeReplayed() public {
        bytes memory signature = _signature();
        _expect(Q2FAAccount.Action.ChangeGuardian, NEW_GUARDIAN, 0, 0, 1_000, signature, true);

        vm.prank(OWNER);
        account.changeGuardian(NEW_GUARDIAN, 1_000, signature);
        vm.expectRevert(Q2FAAccount.InvalidPQSignature.selector);
        vm.prank(OWNER);
        account.changeGuardian(NEW_GUARDIAN, 1_000, signature);
        require(account.guardianKey() == NEW_GUARDIAN && account.nonce() == 1, "guardian replay changed state");
    }

    function testNewGuardianCannotInstallItself() public {
        bytes memory signature = _signature();
        verifier.configure(
            abi.encodePacked(NEW_GUARDIAN),
            _payload(block.chainid, address(account), Q2FAAccount.Action.ChangeGuardian, NEW_GUARDIAN, 0, 0, 1_000),
            signature,
            true
        );

        vm.expectRevert(Q2FAAccount.InvalidPQSignature.selector);
        vm.prank(OWNER);
        account.changeGuardian(NEW_GUARDIAN, 1_000, signature);
        require(account.guardianKey() == GUARDIAN && account.nonce() == 0, "unauthorized guardian installed");
    }

    function testZeroGuardianRejected() public {
        vm.expectRevert(Q2FAAccount.ZeroGuardian.selector);
        vm.prank(OWNER);
        account.changeGuardian(bytes32(0), 1_000, _signature());
        require(account.guardianKey() == GUARDIAN && account.nonce() == 0, "zero guardian accepted");
    }

    function testInvalidGuardianSignatureFails() public {
        bytes memory signature = _signature();
        _expect(Q2FAAccount.Action.Withdraw, _addressSubject(RECIPIENT), 1, 0, 1_000, signature, false);

        vm.expectRevert(Q2FAAccount.InvalidPQSignature.selector);
        vm.prank(OWNER);
        account.withdraw(RECIPIENT, 1, 1_000, signature);
        require(account.nonce() == 0, "invalid signature consumed nonce");
    }

    function testCorruptedSignatureFails() public {
        bytes memory signature = _signature();
        _expect(Q2FAAccount.Action.Withdraw, _addressSubject(RECIPIENT), 1, 0, 1_000, signature, true);
        signature[0] = 0x01;

        vm.expectRevert(Q2FAAccount.InvalidPQSignature.selector);
        vm.prank(OWNER);
        account.withdraw(RECIPIENT, 1, 1_000, signature);
        require(account.nonce() == 0, "corrupted signature consumed nonce");
    }

    function testWrongSignatureLengthFailsBeforeVerifier() public {
        vm.expectRevert(abi.encodeWithSelector(Q2FAAccount.InvalidPQSignatureLength.selector, 7_855));
        vm.prank(OWNER);
        account.withdraw(RECIPIENT, 1, 1_000, new bytes(7_855));
        require(account.nonce() == 0, "malformed signature consumed nonce");
    }

    function testVerifierRevertIsHandled() public {
        verifier.configureRevert();
        vm.expectRevert(Q2FAAccount.PQVerifierUnavailable.selector);
        vm.prank(OWNER);
        account.withdraw(RECIPIENT, 1, 1_000, _signature());
        require(account.nonce() == 0, "verifier failure consumed nonce");
    }

    function testNonceRollsBackIfUSDCTransferFails() public {
        bytes memory signature = _signature();
        _expect(Q2FAAccount.Action.Withdraw, _addressSubject(RECIPIENT), 1, 0, 1_000, signature, true);
        usdc.setTransferFailure(true);

        vm.expectRevert(Q2FAAccount.USDCTransferFailed.selector);
        vm.prank(OWNER);
        account.withdraw(RECIPIENT, 1, 1_000, signature);

        require(account.nonce() == 0, "failed withdrawal consumed nonce");
        require(usdc.balanceOf(address(account)) == 1_000, "failed withdrawal moved funds");
    }

    function testERC20DepositNeedsNoPQAuthorization() public {
        usdc.mint(address(this), 7);
        require(usdc.transfer(address(account), 7), "deposit transfer failed");
        require(usdc.balanceOf(address(account)) == 1_007, "deposit not credited");
        require(account.nonce() == 0, "deposit changed protected nonce");
    }

    function testUSDCCallbackCannotReenterProtectedWithdrawal() public {
        bytes memory signature = _signature();
        _expect(Q2FAAccount.Action.Withdraw, _addressSubject(RECIPIENT), 1, 0, 1_000, signature, true);
        bytes memory reentryCall = abi.encodeCall(account.withdraw, (RECIPIENT, 1, 1_000, signature));
        usdc.setReentry(address(account), reentryCall);

        vm.prank(OWNER);
        account.withdraw(RECIPIENT, 1, 1_000, signature);

        require(usdc.reentryAttempted(), "token callback was not attempted");
        require(!usdc.reentrySucceeded(), "token callback reentered account");
        require(account.nonce() == 1, "reentry changed nonce");
        require(usdc.balanceOf(RECIPIENT) == 1, "reentry moved extra funds");
    }

    function testAuthorizationPayloadIsFixedAbiEncoding() public view {
        bytes memory payload = account.authorizationPayload(
            Q2FAAccount.Action.Withdraw,
            _addressSubject(RECIPIENT),
            7,
            1_000
        );
        bytes memory expected = abi.encode(
            bytes32("Q2FA_AUTH_V1"),
            block.chainid,
            address(account),
            uint8(Q2FAAccount.Action.Withdraw),
            _addressSubject(RECIPIENT),
            uint256(7),
            uint256(0),
            uint256(1_000)
        );
        require(payload.length == 256, "authorization message size");
        require(keccak256(payload) == keccak256(expected), "authorization ABI mismatch");
    }

    function testConstructorRejectsZeroOwnerAndGuardian() public {
        vm.expectRevert(Q2FAAccount.ZeroOwner.selector);
        new Q2FAAccount(address(0), GUARDIAN, address(0));

        vm.expectRevert(Q2FAAccount.ZeroGuardian.selector);
        new Q2FAAccount(OWNER, bytes32(0), address(0));
    }

    function _expect(
        Q2FAAccount.Action action,
        bytes32 subject,
        uint256 amount,
        uint256 expectedNonce,
        uint256 deadline,
        bytes memory signature,
        bool result
    ) private {
        verifier.configure(
            abi.encodePacked(GUARDIAN),
            _payload(block.chainid, address(account), action, subject, amount, expectedNonce, deadline),
            signature,
            result
        );
    }

    function _payload(
        uint256 chainId,
        address accountAddress,
        Q2FAAccount.Action action,
        bytes32 subject,
        uint256 amount,
        uint256 actionNonce,
        uint256 deadline
    ) private pure returns (bytes memory) {
        return abi.encode(
            bytes32("Q2FA_AUTH_V1"),
            chainId,
            accountAddress,
            uint8(action),
            subject,
            amount,
            actionNonce,
            deadline
        );
    }

    function _addressSubject(address subject) private pure returns (bytes32) {
        return bytes32(uint256(uint160(subject)));
    }

    function _signature() private pure returns (bytes memory) {
        return new bytes(7_856);
    }
}
