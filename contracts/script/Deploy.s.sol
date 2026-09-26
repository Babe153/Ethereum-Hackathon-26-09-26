// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MockUSDT} from "../src/MockUSDT.sol";
import {BountyEscrow} from "../src/BountyEscrow.sol";

contract Deploy is Script {
    function run() external {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address verifier = vm.envAddress("VERIFIER_ADDRESS");
        address arbiter = vm.envAddress("ARBITER_ADDRESS");
        vm.startBroadcast(key);
        MockUSDT token = new MockUSDT();
        BountyEscrow escrow = new BountyEscrow(address(token), verifier, arbiter, 60);
        vm.stopBroadcast();
        console2.log("TOKEN_ADDRESS", address(token));
        console2.log("ESCROW_ADDRESS", address(escrow));
    }
}
