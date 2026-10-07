// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IArcUSDC {
    function transfer(address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}
