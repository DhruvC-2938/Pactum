import {
  Account,
  Contract,
  rpc,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  xdr,
  Address,
  Keypair,
  nativeToScVal,
  scValToNative,
} from '@stellar/stellar-sdk';
import type { Reputation } from './api';
import { signTransaction } from '@stellar/freighter-api';
import { signTransactionWithLedger } from './wallet-adapters/ledger-adapter';
import type { WalletProvider } from './wallet';
import { SorobanRpcPool } from './sorobanRpcPool';

/**
 * Default pool of Soroban RPC endpoints, ordered by preference.
 *
 * Every endpoint in a pool must be on the **same Stellar network** so that a
 * transaction prepared or submitted through any of them is valid on all of
 * them. Operators can override/extend the pool at build time with the
 * `VITE_SOROBAN_RPC_URLS` env var (comma-separated list) — the legacy single
 * `VITE_SOROBAN_RPC_URL` is still honoured as a one-node pool.
 */
export const DEFAULT_SOROBAN_RPC_URLS: string[] = ['https://soroban-testnet.stellar.org'];

/** @deprecated Use {@link DEFAULT_SOROBAN_RPC_URLS} / {@link resolveSorobanRpcUrls}. */
export const DEFAULT_SOROBAN_RPC_URL = DEFAULT_SOROBAN_RPC_URLS[0];
export const DEFAULT_CONTRACT_ID = 'CBADTVTJ6IN332HIKZ7LWUYMYTLPZYCEBV3X2HS47VHR5UDBHQ3GAA7E';
export const DEFAULT_NETWORK_PASSPHRASE = Networks.TESTNET;

/**
 * Resolves the ordered list of Soroban RPC endpoints the caller wants, in
 * priority order:
 *
 * 1. Explicit `rpcUrls` array (most specific),
 * 2. explicit legacy single `rpcUrl`,
 * 3. `VITE_SOROBAN_RPC_URLS` (comma-separated) from the environment,
 * 4. legacy `VITE_SOROBAN_RPC_URL` from the environment,
 * 5. {@link DEFAULT_SOROBAN_RPC_URLS}.
 *
 * Duplicate/empty entries are removed.
 */
export function resolveSorobanRpcUrls(rpcUrls?: string[], rpcUrl?: string): string[] {
  if (rpcUrls && rpcUrls.length > 0) {
    return dedupeRpcUrls(rpcUrls);
  }
  if (rpcUrl && rpcUrl.trim()) {
    return [rpcUrl.trim()];
  }
  const envList = import.meta.env.VITE_SOROBAN_RPC_URLS;
  if (typeof envList === 'string' && envList.trim()) {
    return dedupeRpcUrls(
      envList
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean),
    );
  }
  const envSingle = import.meta.env.VITE_SOROBAN_RPC_URL;
  if (typeof envSingle === 'string' && envSingle.trim()) {
    return [envSingle.trim()];
  }
  return [...DEFAULT_SOROBAN_RPC_URLS];
}

function dedupeRpcUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of urls) {
    const url = raw?.trim();
    if (!url) continue;
    const normalized = url.replace(/\/+$/, '').toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(url);
    }
  }
  return result;
}

/**
 * Builds a pool wired up with sensible production defaults. When a node fails
 * with a retryable error (429 / 5xx / network), the pool automatically rotates
 * to the next-best node and surfaces a user-facing status update.
 */
function createSorobanRpcPool(
  urls: string[],
  onStatusUpdate?: (statusMessage: string) => void,
): SorobanRpcPool {
  return new SorobanRpcPool(urls, {
    allowHttp: true,
    timeout: 15_000,
    onFallback: ({ url, error, attempt, remaining }) => {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `[SorobanRpcPool] RPC node ${url} failed (${reason}); retrying on another node ` +
          `(attempt ${attempt}/${attempt + remaining}).`,
      );
      onStatusUpdate?.(`RPC node unavailable (${reason}). Retrying on a backup node...`);
    },
  });
}

export interface CreateCommitmentParams {
  issuerAddress: string;
  counterpartyAddress: string;
  termsHashHex: string;
  dueAtSeconds: number;
  /**
   * Ordered list of Soroban RPC endpoints (connection pool). When omitted,
   * `VITE_SOROBAN_RPC_URLS` / `VITE_SOROBAN_RPC_URL` / defaults are used.
   */
  rpcUrls?: string[];
  /** @deprecated Use {@link CreateCommitmentParams.rpcUrls}. */
  rpcUrl?: string;
  contractId?: string;
  networkPassphrase?: string;
  onStatusUpdate?: (statusMessage: string) => void;
  walletProvider?: WalletProvider;
}

export interface CreateCommitmentResult {
  hash: string;
  commitmentId?: number | bigint;
  status: 'SUCCESS';
}

export interface TrustedLedgerAnchor {
  hash: string;
  sequence: number;
}

export interface SorobanReadOptions {
  /**
   * Ordered list of Soroban RPC endpoints (connection pool). When omitted,
   * `VITE_SOROBAN_RPC_URLS` / `VITE_SOROBAN_RPC_URL` / defaults are used.
   */
  rpcUrls?: string[];
  /** @deprecated Use {@link SorobanReadOptions.rpcUrls}. */
  rpcUrl?: string;
}

export async function fetchLatestLedgerAnchor(
  options: SorobanReadOptions = {},
): Promise<TrustedLedgerAnchor> {
  const pool = createSorobanRpcPool(resolveSorobanRpcUrls(options.rpcUrls, options.rpcUrl));
  const ledger = await pool.getLatestLedger();

  if (!ledger.id || !ledger.sequence) {
    throw new Error('Soroban RPC returned an incomplete latest-ledger response');
  }

  return { hash: ledger.id, sequence: ledger.sequence };
}

export interface ReputationQueryOptions extends SorobanReadOptions {
  contractId?: string;
  networkPassphrase?: string;
}

export async function fetchReputationFromRpc(
  address: string,
  options: ReputationQueryOptions = {},
): Promise<Reputation> {
  const contractId =
    options.contractId || import.meta.env.VITE_PACTUM_CONTRACT_ID || DEFAULT_CONTRACT_ID;
  const networkPassphrase =
    options.networkPassphrase ||
    import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE ||
    DEFAULT_NETWORK_PASSPHRASE;
  const pool = createSorobanRpcPool(resolveSorobanRpcUrls(options.rpcUrls, options.rpcUrl));
  const contract = new Contract(contractId);
  const source = new Account(Keypair.random().publicKey(), '0');
  const transaction = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(contract.call('get_reputation', nativeToScVal(address, { type: 'address' })))
    .setTimeout(30)
    .build();

  const simulation = await pool.simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Direct Soroban query failed: ${simulation.error}`);
  }
  if (!simulation.result) {
    throw new Error('Direct Soroban query returned no reputation value');
  }

  const value = scValToNative(simulation.result.retval) as Record<string, number | bigint>;
  const fulfilled = Number(value.fulfilled_count ?? value.fulfilledCount ?? 0);
  const late = Number(value.late_count ?? value.lateCount ?? 0);
  const breached = Number(value.breached_count ?? value.breachedCount ?? 0);

  return {
    address,
    fulfilled,
    late,
    breached,
    total: fulfilled + late + breached,
  };
}

/**
 * Converts a 64-character hex string (32 bytes SHA-256) into a Uint8Array
 */
export function hexToBytes(hexStr: string): Uint8Array {
  const cleanHex = hexStr.replace(/^0x/i, '');
  if (cleanHex.length !== 64) {
    throw new Error(
      `Invalid terms hash hex length: expected 64 hex characters (32 bytes), got ${cleanHex.length}`,
    );
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(cleanHex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Helper to auto-fund a new unfunded Testnet account via Stellar Friendbot
 */
export async function fundTestnetAccount(address: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://friendbot.stellar.org/?addr=${encodeURIComponent(address)}`,
    );
    return response.ok;
  } catch (e) {
    console.warn(`[Friendbot] Could not auto-fund ${address}:`, e);
    return false;
  }
}

/**
 * Builds, simulates, signs via Freighter, and submits a `create_commitment` Soroban transaction.
 *
 * Every RPC interaction goes through a {@link SorobanRpcPool}: if the active
 * node rate-limits (HTTP 429), returns a 5xx, or drops the connection, the
 * request is transparently retried on the next-healthiest node.
 */
export async function submitCreateCommitment({
  issuerAddress,
  counterpartyAddress,
  termsHashHex,
  dueAtSeconds,
  rpcUrls,
  rpcUrl,
  contractId = import.meta.env.VITE_PACTUM_CONTRACT_ID || DEFAULT_CONTRACT_ID,
  networkPassphrase = import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE || DEFAULT_NETWORK_PASSPHRASE,
  onStatusUpdate,
  walletProvider = 'freighter',
}: CreateCommitmentParams): Promise<CreateCommitmentResult> {
  // 1. Parameter Validation
  if (!issuerAddress || !issuerAddress.startsWith('G')) {
    throw new Error('Connected wallet issuer address must be a valid Stellar public key (G...)');
  }
  if (!counterpartyAddress || !counterpartyAddress.startsWith('G')) {
    throw new Error('Counterparty address must be a valid Stellar public key (G...)');
  }
  if (issuerAddress.trim().toUpperCase() === counterpartyAddress.trim().toUpperCase()) {
    throw new Error('Issuer and Counterparty addresses cannot be identical.');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (dueAtSeconds <= nowSeconds) {
    throw new Error(
      `Due date must be in the future. Selected timestamp (${dueAtSeconds}) is not > current timestamp (${nowSeconds}).`,
    );
  }

  onStatusUpdate?.('Initializing Soroban RPC connection pool...');
  const pool = createSorobanRpcPool(resolveSorobanRpcUrls(rpcUrls, rpcUrl), onStatusUpdate);

  // 2. Convert Arguments to ScVal
  onStatusUpdate?.('Encoding contract parameters...');
  const issuerScVal = Address.fromString(issuerAddress).toScVal();
  const counterpartyScVal = Address.fromString(counterpartyAddress).toScVal();
  const termsHashBytes = hexToBytes(termsHashHex);
  const termsHashScVal = xdr.ScVal.scvBytes(termsHashBytes);
  const dueAtScVal = xdr.ScVal.scvU64(xdr.Uint64.fromString(dueAtSeconds.toString()));

  // 3. Build Transaction Envelope
  onStatusUpdate?.('Fetching sequence number for issuer account...');
  let account: any = null;
  try {
    account = await pool.getAccount(issuerAddress);
  } catch (err: any) {
    const errStr = String(err?.message || err).toLowerCase();
    if (errStr.includes('not found') || errStr.includes('404') || errStr.includes('account')) {
      onStatusUpdate?.('Issuer account unfunded on Testnet. Auto-funding via Stellar Friendbot...');
      const funded = await fundTestnetAccount(issuerAddress);
      if (funded) {
        onStatusUpdate?.('Account funded! Re-fetching sequence number...');
        await new Promise((resolve) => setTimeout(resolve, 1500));
        try {
          account = await pool.getAccount(issuerAddress);
        } catch (e2) {
          console.warn('Re-fetch account error:', e2);
        }
      }
    }

    if (!account) {
      throw new Error(
        `Connected account (${issuerAddress.substring(0, 8)}...) is not funded on Stellar Testnet yet. Please fund it with Testnet XLM in your Freighter extension or via Stellar Friendbot.`,
      );
    }
  }

  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      contract.call(
        'create_commitment',
        issuerScVal,
        counterpartyScVal,
        termsHashScVal,
        dueAtScVal,
      ),
    )
    .setTimeout(60)
    .build();

  // 4. Simulate & Prepare Transaction Envelope (Soroban footprint & fees)
  onStatusUpdate?.('Simulating transaction on Soroban RPC...');
  const preparedTx = await pool.prepareTransaction(tx);

  const unsignedXdr = preparedTx.toXDR();

  // 5. Prompt the connected wallet for a signature
  let signedXdr = '';

  if (walletProvider === 'ledger') {
    onStatusUpdate?.('Awaiting signature on Ledger device (confirm on-screen)...');
    signedXdr = await signTransactionWithLedger(unsignedXdr, networkPassphrase);
  } else {
    onStatusUpdate?.('Awaiting signature in Freighter wallet...');
    const signResult = await signTransaction(unsignedXdr, {
      networkPassphrase,
      address: issuerAddress,
    });

    if (typeof signResult === 'string') {
      signedXdr = signResult;
    } else if (signResult && typeof signResult === 'object') {
      if ((signResult as any).error) {
        throw new Error(`Freighter signing rejected: ${(signResult as any).error}`);
      }
      signedXdr = (signResult as any).signedTxXdr || (signResult as any).signedXdr || '';
    }
  }

  if (!signedXdr) {
    throw new Error('Transaction signing was cancelled or denied.');
  }

  // 6. Submit Signed Transaction Envelope to RPC
  onStatusUpdate?.('Submitting transaction to Stellar Testnet...');
  const signedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  const sendResult = await pool.sendTransaction(signedTx);

  if (sendResult.status === 'ERROR' || sendResult.errorResult) {
    throw new Error(`RPC submission error: ${sendResult.errorResult || sendResult.status}`);
  }

  const txHash = sendResult.hash;
  onStatusUpdate?.(`Transaction submitted! Confirming hash ${txHash.substring(0, 10)}...`);

  // 7. Poll RPC for Final On-Chain Ledger Status
  let txStatus: rpc.Api.GetTransactionStatus = rpc.Api.GetTransactionStatus.NOT_FOUND;
  let txResult: rpc.Api.GetTransactionResponse | null = null;
  let attempts = 0;

  while (attempts < 25) {
    attempts++;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    txResult = await pool.getTransaction(txHash);
    txStatus = txResult.status;

    if (txStatus === rpc.Api.GetTransactionStatus.SUCCESS) {
      break;
    } else if (txStatus === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Transaction execution failed on Stellar Testnet. Hash: ${txHash}`);
    }
  }

  if (txStatus !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Transaction confirmation timed out. Hash: ${txHash}`);
  }

  let commitmentId: number | bigint | undefined = undefined;
  const successTx = txResult as any;
  if (successTx && successTx.returnValue) {
    try {
      const nativeVal = scValToNative(successTx.returnValue);
      if (typeof nativeVal === 'number' || typeof nativeVal === 'bigint') {
        commitmentId = nativeVal;
      }
    } catch (e) {
      console.warn('Could not parse commitmentId from retval:', e);
    }
  }

  onStatusUpdate?.('Transaction confirmed successfully on-chain!');

  return {
    hash: txHash,
    commitmentId,
    status: 'SUCCESS',
  };
}
