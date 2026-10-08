import { parseAbiItem, type Abi } from "viem";

export const q2faAccountAbi = [
  { type: "error", name: "NotOwner", inputs: [] },
  { type: "error", name: "AuthorizationExpired", inputs: [] },
  { type: "error", name: "InvalidPQSignature", inputs: [] },
  { type: "error", name: "PQVerifierUnavailable", inputs: [] },
  { type: "error", name: "InvalidPQSignatureLength", inputs: [{ name: "actualLength", type: "uint256" }] },
  { type: "error", name: "ZeroRecipient", inputs: [] },
  { type: "error", name: "ZeroAmount", inputs: [] },
  { type: "error", name: "USDCTransferFailed", inputs: [] },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "guardianKey", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "nonce", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "authorizationPayload",
    stateMutability: "view",
    inputs: [
      { name: "action", type: "uint8" },
      { name: "subject", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ type: "bytes" }],
  },
  {
    type: "function",
    name: "changeGuardian",
    stateMutability: "nonpayable",
    inputs: [
      { name: "newGuardianKey", type: "bytes32" },
      { name: "deadline", type: "uint256" },
      { name: "pqSignature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "pqSignature", type: "bytes" },
    ],
    outputs: [],
  },
] as const satisfies Abi;

export const withdrawalEvent = parseAbiItem("event Withdrawal(address indexed recipient, uint256 amount, uint256 indexed nonce)");
export const ownerChangedEvent = parseAbiItem("event OwnerChanged(address indexed previousOwner, address indexed newOwner, uint256 indexed nonce)");
export const guardianChangedEvent = parseAbiItem("event GuardianChanged(bytes32 previousKey, bytes32 newKey, uint256 indexed nonce)");
export const usdcTransferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

export const arcUsdcAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [{ name: "recipient", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
] as const satisfies Abi;
