// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Demo escrow. The verifier and arbiter are trusted roles; use only with demo tokens.
contract BountyEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status { Open, Taken, Submitted, Approved, Disputed, Paid, Refunded }

    struct Bounty {
        address poster;
        address worker;
        uint256 amount;
        string criteria;
        uint64 deadline;
        string submissionURI;
        bytes32 submissionHash;
        bytes32 reasonHash;
        uint64 approvedAt;
        Status status;
    }

    IERC20 public immutable token;
    address public immutable verifier;
    address public immutable arbiter;
    uint64 public immutable challengeWindow;
    uint256 public bountyCount;
    mapping(uint256 => Bounty) private bounties;

    event BountyCreated(uint256 indexed id, address indexed poster, uint256 amount, uint64 deadline);
    event Accepted(uint256 indexed id, address indexed worker);
    event Submitted(uint256 indexed id, string uri, bytes32 contentHash);
    event Verified(uint256 indexed id, bool pass, bytes32 reasonHash);
    event Disputed(uint256 indexed id);
    event Resolved(uint256 indexed id, bool toWorker);
    event Paid(uint256 indexed id, address indexed worker, uint256 amount);
    event Refunded(uint256 indexed id, address indexed poster, uint256 amount);

    error Unauthorized();
    error InvalidState();
    error InvalidInput();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error ChallengeOpen();
    error ChallengeClosed();

    constructor(address token_, address verifier_, address arbiter_, uint64 challengeWindow_) {
        if (token_ == address(0) || verifier_ == address(0) || arbiter_ == address(0) || challengeWindow_ == 0) revert InvalidInput();
        token = IERC20(token_);
        verifier = verifier_;
        arbiter = arbiter_;
        challengeWindow = challengeWindow_;
    }

    function getBounty(uint256 id) external view returns (Bounty memory) {
        if (id >= bountyCount) revert InvalidInput();
        return bounties[id];
    }

    function createBounty(uint256 amount, string calldata criteria, uint64 deadline) external nonReentrant returns (uint256 id) {
        if (amount == 0 || bytes(criteria).length == 0 || bytes(criteria).length > 2048 || deadline <= block.timestamp) revert InvalidInput();
        id = bountyCount++;
        Bounty storage b = bounties[id];
        b.poster = msg.sender;
        b.amount = amount;
        b.criteria = criteria;
        b.deadline = deadline;
        b.status = Status.Open;
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit BountyCreated(id, msg.sender, amount, deadline);
    }

    function accept(uint256 id) external {
        Bounty storage b = _bounty(id);
        if (b.status != Status.Open) revert InvalidState();
        if (block.timestamp >= b.deadline) revert DeadlinePassed();
        if (msg.sender == b.poster) revert Unauthorized();
        b.worker = msg.sender;
        b.status = Status.Taken;
        emit Accepted(id, msg.sender);
    }

    function submit(uint256 id, string calldata uri, bytes32 contentHash) external {
        Bounty storage b = _bounty(id);
        if (b.status != Status.Taken) revert InvalidState();
        if (msg.sender != b.worker) revert Unauthorized();
        if (block.timestamp >= b.deadline) revert DeadlinePassed();
        if (bytes(uri).length == 0 || bytes(uri).length > 512 || contentHash == bytes32(0)) revert InvalidInput();
        b.submissionURI = uri;
        b.submissionHash = contentHash;
        b.reasonHash = bytes32(0);
        b.status = Status.Submitted;
        emit Submitted(id, uri, contentHash);
    }

    function verify(uint256 id, bool pass, bytes32 reasonHash) external {
        if (msg.sender != verifier) revert Unauthorized();
        Bounty storage b = _bounty(id);
        if (b.status != Status.Submitted) revert InvalidState();
        if (reasonHash == bytes32(0)) revert InvalidInput();
        b.reasonHash = reasonHash;
        if (pass) {
            b.status = Status.Approved;
            b.approvedAt = uint64(block.timestamp);
        } else {
            b.status = Status.Taken;
        }
        emit Verified(id, pass, reasonHash);
    }

    function dispute(uint256 id) external {
        Bounty storage b = _bounty(id);
        if (msg.sender != b.poster) revert Unauthorized();
        if (b.status != Status.Approved) revert InvalidState();
        if (block.timestamp >= uint256(b.approvedAt) + challengeWindow) revert ChallengeClosed();
        b.status = Status.Disputed;
        emit Disputed(id);
    }

    function resolve(uint256 id, bool toWorker) external nonReentrant {
        if (msg.sender != arbiter) revert Unauthorized();
        Bounty storage b = _bounty(id);
        if (b.status != Status.Disputed) revert InvalidState();
        if (toWorker) {
            b.status = Status.Paid;
            token.safeTransfer(b.worker, b.amount);
            emit Paid(id, b.worker, b.amount);
        } else {
            b.status = Status.Refunded;
            token.safeTransfer(b.poster, b.amount);
            emit Refunded(id, b.poster, b.amount);
        }
        emit Resolved(id, toWorker);
    }

    function claim(uint256 id) external nonReentrant {
        Bounty storage b = _bounty(id);
        if (b.status != Status.Approved) revert InvalidState();
        if (block.timestamp < uint256(b.approvedAt) + challengeWindow) revert ChallengeOpen();
        b.status = Status.Paid;
        token.safeTransfer(b.worker, b.amount);
        emit Paid(id, b.worker, b.amount);
    }

    function refund(uint256 id) external nonReentrant {
        Bounty storage b = _bounty(id);
        if (msg.sender != b.poster) revert Unauthorized();
        if (b.status != Status.Open && b.status != Status.Taken) revert InvalidState();
        if (block.timestamp < b.deadline) revert DeadlineNotPassed();
        b.status = Status.Refunded;
        token.safeTransfer(b.poster, b.amount);
        emit Refunded(id, b.poster, b.amount);
    }

    function _bounty(uint256 id) internal view returns (Bounty storage b) {
        if (id >= bountyCount) revert InvalidInput();
        return bounties[id];
    }
}
