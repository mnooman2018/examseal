import * as sharedNs from "examseal-shared";
import {
  type Address,
  type Chain,
  type Hash,
  type LocalAccount,
  type PublicClient,
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
} from "viem";
import { UserError } from "./env";

// examseal-shared is TypeScript source without "type": "module", so Node's ESM loader
// sees it as CommonJS and only exposes a default export. Accept either shape.
const shared = ((sharedNs as unknown as { default?: typeof sharedNs }).default ?? sharedNs) as typeof sharedNs;

export const registryAbi = shared.deployments.testnet.ExamSealRegistry.abi;
export const TESTNET_REGISTRY = getAddress(shared.deployments.testnet.ExamSealRegistry.address);
export const TESTNET = shared.MST_TESTNET;

export const mstTestnet = defineChain({
  id: TESTNET.id,
  name: TESTNET.name,
  nativeCurrency: { name: "MST", symbol: "MST", decimals: 18 },
  rpcUrls: { default: { http: [TESTNET.rpcUrl] } },
  blockExplorers: { default: { name: "MSTScan", url: TESTNET.explorerUrl } },
  testnet: true,
});

export type Conn = {
  chain: Chain;
  publicClient: PublicClient;
  registry: Address;
  isTestnet: boolean;
  explorerTx: (hash: string) => string;
};

/**
 * Connect to MST Testnet (default) or, for local tests only, another RPC + registry.
 * Server-side scripts call the RPC directly; only browsers need the CORS proxy (§2).
 */
export async function connect(opts: { rpc?: string; contract?: string } = {}): Promise<Conn> {
  let chain: Chain = mstTestnet;
  const url = opts.rpc ?? TESTNET.rpcUrl;
  if (opts.rpc) {
    const probe = createPublicClient({ transport: http(url) });
    const id = await probe.getChainId();
    chain = id === TESTNET.id ? mstTestnet : defineChain({ id, name: `local-${id}`, nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [url] } } });
  }
  const publicClient = createPublicClient({ chain, transport: http(url, { retryCount: 3, timeout: 30_000 }) }) as PublicClient;
  const actualId = await publicClient.getChainId();
  if (actualId !== chain.id) throw new UserError(`RPC reports chain ${actualId}, expected ${chain.id}`);

  const registry = getAddress(opts.contract ?? TESTNET_REGISTRY);
  const code = await publicClient.getCode({ address: registry });
  if (!code || code === "0x") throw new UserError(`No contract code at ${registry} on chain ${chain.id}`);

  const isTestnet = chain.id === TESTNET.id;
  return {
    chain,
    publicClient,
    registry,
    isTestnet,
    explorerTx: (hash) => (isTestnet ? `${TESTNET.explorerUrl}/tx/${hash}` : hash),
  };
}

export function wallet(conn: Conn, account: LocalAccount) {
  return createWalletClient({ account, chain: conn.chain, transport: http(conn.chain.rpcUrls.default.http[0]) });
}

/** Wait for a receipt and fail loudly (with the explorer link) if the tx reverted. */
export async function confirm(conn: Conn, hash: Hash, what: string) {
  const receipt = await conn.publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new UserError(`${what} reverted: ${conn.explorerTx(hash)}`);
  return receipt;
}

export async function chainTime(conn: Conn): Promise<bigint> {
  return (await conn.publicClient.getBlock({ blockTag: "latest" })).timestamp;
}

/** JSON.stringify that writes bigint as a decimal string (§2: never stringify raw bigint). */
export function jsonStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n";
}
