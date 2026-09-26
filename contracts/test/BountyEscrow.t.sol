// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDT} from "../src/MockUSDT.sol";
import {BountyEscrow} from "../src/BountyEscrow.sol";

contract BountyEscrowTest is Test {
    MockUSDT token;
    BountyEscrow escrow;
    address poster = address(0xA1);
    address worker = address(0xB2);
    address verifier = address(0xC3);
    address arbiter = address(0xD4);
    uint256 constant AMOUNT = 100e6;

    function setUp() public {
        token = new MockUSDT();
        escrow = new BountyEscrow(address(token), verifier, arbiter, 60);
        token.mint(poster, 1000e6);
        vm.prank(poster);
        token.approve(address(escrow), type(uint256).max);
    }

    function create() internal returns (uint256 id) {
        vm.prank(poster);
        id = escrow.createBounty(AMOUNT, "Mention X and Y", uint64(block.timestamp + 3600));
    }

    function submitted() internal returns (uint256 id) {
        id = create();
        vm.prank(worker);
        escrow.accept(id);
        vm.prank(worker);
        escrow.submit(id, "http://localhost:8787/submissions/1", keccak256("result"));
    }

    function testHappyPath() public {
        uint256 id = submitted();
        assertEq(token.balanceOf(address(escrow)), AMOUNT);
        vm.prank(verifier);
        escrow.verify(id, true, keccak256("accepted"));
        vm.warp(block.timestamp + 60);
        escrow.claim(id);
        assertEq(token.balanceOf(worker), AMOUNT);
        assertEq(uint8(escrow.getBounty(id).status), uint8(BountyEscrow.Status.Paid));
    }

    function testRejectedThenResubmit() public {
        uint256 id = submitted();
        vm.prank(verifier);
        escrow.verify(id, false, keccak256("missing Y"));
        assertEq(uint8(escrow.getBounty(id).status), uint8(BountyEscrow.Status.Taken));
        vm.prank(worker);
        escrow.submit(id, "http://localhost:8787/submissions/2", keccak256("fixed"));
        vm.prank(verifier);
        escrow.verify(id, true, keccak256("accepted"));
        assertEq(uint8(escrow.getBounty(id).status), uint8(BountyEscrow.Status.Approved));
    }

    function testDisputeAndResolveRefund() public {
        uint256 id = submitted();
        vm.prank(verifier);
        escrow.verify(id, true, keccak256("accepted"));
        vm.prank(poster);
        escrow.dispute(id);
        vm.prank(arbiter);
        escrow.resolve(id, false);
        assertEq(token.balanceOf(poster), 1000e6);
        assertEq(uint8(escrow.getBounty(id).status), uint8(BountyEscrow.Status.Refunded));
    }

    function testCannotClaimEarly() public {
        uint256 id = submitted();
        vm.prank(verifier);
        escrow.verify(id, true, keccak256("accepted"));
        vm.expectRevert(BountyEscrow.ChallengeOpen.selector);
        escrow.claim(id);
    }

    function testOnlyVerifier() public {
        uint256 id = submitted();
        vm.expectRevert(BountyEscrow.Unauthorized.selector);
        escrow.verify(id, true, keccak256("accepted"));
    }

    function testTimeoutRefund() public {
        uint256 id = create();
        vm.warp(block.timestamp + 3600);
        vm.prank(poster);
        escrow.refund(id);
        assertEq(token.balanceOf(poster), 1000e6);
    }

    function testCannotRefundSubmitted() public {
        uint256 id = submitted();
        vm.warp(block.timestamp + 3600);
        vm.prank(poster);
        vm.expectRevert(BountyEscrow.InvalidState.selector);
        escrow.refund(id);
    }
}
