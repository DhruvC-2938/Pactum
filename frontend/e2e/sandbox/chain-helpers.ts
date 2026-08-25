import {
  Contract,
  rpc,
  TransactionBuilder,
  scValToNative,
  nativeToScVal,
} from '@stellar/stellar-sdk';

const RPC_URL = process.env.SOROBAN_RPC_URL ?? 'http://localhost:8000/soroban/rpc';
const NETWORK_PASSPHRASE =
  process.env.SOROBAN_NETWORK_PASSPHRASE ?? 'Standalone Network ; February 2017';
const CONTRACT_ID = process.env.SOROBAN_CONTRACT_ID!;

const server = new rpc.Server(RPC_URL, { allowHttp: true });
const contract = new Contract(CONTRACT_ID);

/**
 * Reads a commitment directly from the deployed RegistryContract via
 * get_commitment(id), bypassing the backend/indexer entirely. Used to
 * assert the dashboard's rendered status matches on-chain ground truth,
 * not just that the indexer eventually reported *something* plausible.
 */
export async function getCommitmentOnChain(id: number, sourceAddress: string) {
  const account = await server.getAccount(sourceAddress);
  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call('get_commitment', nativeToScVal(id, { type: 'u64' })))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`get_commitment(${id}) simulation failed: ${sim.error}`);
  }
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
    throw new Error(`get_commitment(${id}) returned no result`);
  }

  const native = scValToNative(sim.result.retval) as { status: unknown; [key: string]: unknown };

  // CommitmentStatus (contracts/registry/src/commitments.rs) is a unit-variant
  // Soroban contracttype enum -- scValToNative decodes it as a single-element
  // array holding the variant name (e.g. ["Pending"]), not a plain string.
  const status = Array.isArray(native.status) ? native.status[0] : native.status;

  return { ...native, status } as { status: string; [key: string]: unknown };
}

/**
 * Polls get_commitment until its status matches `expectedStatus` or the
 * timeout elapses. The indexer/backend/dashboard path has its own latency
 * (INDEXER_POLL_INTERVAL_MS), so this is meant to run *after* a UI-visible
 * assertion already passed, purely as a ground-truth cross-check --
 * not as the primary wait mechanism.
 */
export async function waitForCommitmentStatusOnChain(
  id: number,
  expectedStatus: string,
  sourceAddress: string,
  timeoutMs = 15_000,
) {
  const start = Date.now();
  let last: string | undefined;
  while (Date.now() - start < timeoutMs) {
    const commitment = await getCommitmentOnChain(id, sourceAddress);
    last = commitment.status;
    if (commitment.status === expectedStatus) return commitment;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `Timed out waiting for commitment ${id} to reach status "${expectedStatus}" on-chain (last seen: "${last}")`,
  );
}
