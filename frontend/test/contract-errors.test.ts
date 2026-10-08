import assert from "node:assert/strict";
import test from "node:test";
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  keccak256,
  toBytes,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { q2faAccountAbi } from "../src/contracts.js";
import { describeViemError, extractContractErrorName } from "../src/contract-errors.js";

const abi = q2faAccountAbi as Abi;
const account = "0xc27bd794db0e7d2cf636fbd7872d05e92cc295d2" as Address;
const owner = "0x90e3a58694e953f5eC4018fF7dd57BE036f11FcE" as Address;
const invalidSignatureData = keccak256(toBytes("InvalidPQSignature()")).slice(0, 10) as Hex;

test("recognizes a decoded viem custom error on an intermediate cause", () => {
  const reverted = new ContractFunctionRevertedError({
    abi,
    data: invalidSignatureData,
    functionName: "withdraw",
    cause: new Error("JSON-RPC execution reverted"),
  });
  const simulationError = new ContractFunctionExecutionError(reverted, {
    abi,
    args: [],
    contractAddress: account,
    functionName: "withdraw",
    sender: owner,
  });

  assert.equal(reverted.data?.errorName, "InvalidPQSignature");
  assert.equal(extractContractErrorName(simulationError, abi), "InvalidPQSignature");
  assert.equal(simulationError.walk().message, "JSON-RPC execution reverted");
});

test("decodes raw nested revert bytes and reports a bounded diagnostic", () => {
  const error = Object.assign(new Error("simulation failed"), {
    cause: Object.assign(new Error("rpc reverted"), { data: invalidSignatureData }),
  });
  assert.equal(extractContractErrorName(error, abi), "InvalidPQSignature");
  assert.deepEqual(decodeErrorResult({ abi, data: invalidSignatureData }).errorName, "InvalidPQSignature");

  const diagnostic = describeViemError(error, abi);
  assert.equal(diagnostic.chain[1]?.revertData, invalidSignatureData);
  assert.equal(diagnostic.chain[1]?.errorName, "InvalidPQSignature");
  assert.equal(JSON.stringify(diagnostic).includes("simulation failed"), false);
});
