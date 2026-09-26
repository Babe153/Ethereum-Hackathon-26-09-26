// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {BountyEscrow} from "../src/BountyEscrow.sol";

/// @notice Deploy a new escrow against the existing test token.
/// Existing bounties remain in the previous escrow.
contract DeployEscrowOnly is Script {
    function run() external {
        address token = vm.envAddress("TOKEN_ADDRESS");
        address verifier = vm.envAddress("VERIFIER_ADDRESS");
        address arbiter = vm.envAddress("ARBITER_ADDRESS");
        require(token.code.length > 0, "TOKEN_ADDRESS has no code");

        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        BountyEscrow escrow = new BountyEscrow(token, verifier, arbiter, 60);
        vm.stopBroadcast();

        console2.log("TOKEN_ADDRESS", token);
        console2.log("ESCROW_ADDRESS", address(escrow));
    }
}
