import { createRequire } from "node:module";
import { defineConfig } from "hardhat/config";

const require = createRequire(import.meta.url);

export default defineConfig({
  paths: {
    sources: "./src",
    tests: { solidity: "./test" },
    cache: "./cache",
    artifacts: "./artifacts",
  },
  solidity: {
    version: "0.8.37",
    path: require.resolve("solc/soljson.js"),
    settings: {
      evmVersion: "paris",
      optimizer: { enabled: true, runs: 200 },
    },
  },
  test: {
    solidity: { fuzz: { runs: 128 } },
  },
});
