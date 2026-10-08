import { getAddress, isAddress, type Address } from "viem";

const configuredFactory = import.meta.env?.VITE_Q2FA_FACTORY_ADDRESS?.trim();

/** Deliberately unset until the factory deployment receives separate approval. */
export const q2faFactoryAddress: Address | undefined =
  configuredFactory && isAddress(configuredFactory, { strict: false }) ? getAddress(configuredFactory) : undefined;
