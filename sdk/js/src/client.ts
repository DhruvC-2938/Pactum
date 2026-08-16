/**
 * PactumClient — the primary integration surface for the @pactum/sdk.
 *
 * All Soroban RPC plumbing (XDR encoding/decoding, transaction building,
 * simulation, assembly, signing, and submission) is handled internally so
 * that callers only need to provide typed parameters.
 *
 * Deployed contract address (testnet):
 * CBADTVTJ6IN332HIKZ7LWUYMYTLPZYCEBV3X2HS47VHR5UDBHQ3GAA7E
 */
import { Contract, Keypair, rpc, scValToNative } from '@stellar/stellar-sdk';
import { DEFAULT_CONTRACT_ID, resolveNetwork } from './networks.js';
import { invokeContract, queryContract, type TxOptions } from './transaction.js';
import {
  encodeAddress,
  encodeAddressVec,
  encodeBytes32,
  encodeCommitmentStatus,
  encodeU32,
  encodeU64,
  decodeCommitment,
  decodeReputation,
} from './xdr.js';
import type {
  AttestParams,
  Commitment,
  CommitmentStatus,
  CreateCommitmentParams,
  DisputeParams,
  PactumClientConfig,
  Reputation,
  ResolveDisputeParams,
} from './types.js';

export class PactumClient {
  private readonly opts: TxOptions;

  /**
   * Constructs a PactumClient connected to the specified network.
   *
   * @example
   * const client = new PactumClient({ network: 'testnet' });
   */
  constructor(config: PactumClientConfig) {
    const { rpcUrl, networkPassphrase } = resolveNetwork(
      config.network,
      config.rpcUrl,
      config.networkPassphrase,
    );

    const contractId = config.contractId ?? DEFAULT_CONTRACT_ID;

    this.opts = {
      rpcServer: new rpc.Server(rpcUrl, { allowHttp: false }),
      contract: new Contract(contractId),
      networkPassphrase,
    };
  }

  // ─── Write methods ──────────────────────────────────────────────────────────

  /**
   * Creates and registers a new commitment on-chain.
   *
   * @returns The unique commitment ID assigned by the contract.
   *
   * @example
   * const id = await client.createCommitment({
   *   issuer: 'G...',
   *   issuerSecret: 'S...',
   *   counterparty: 'G...',
   *   termsHash: 'abcd...', // 32-byte hex
   *   dueAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
   * });
   */
  async createCommitment(params: CreateCommitmentParams): Promise<bigint> {
    const attestors = params.attestors ?? [];
    const threshold = params.threshold ?? 0;

    // issuerSecret is required: derive the public key from it for getAccount.
    const keypair = Keypair.fromSecret(params.issuerSecret);
    if (keypair.publicKey() !== params.issuer) {
      throw new Error(
        'PactumClient.createCommitment: issuerSecret does not match issuer address.',
      );
    }

    const txHash = await invokeContract(
      this.opts,
      params.issuerSecret,
      'create_commitment',
      [
        encodeAddress(params.issuer),
        encodeAddress(params.counterparty),
        encodeBytes32(params.termsHash),
        encodeU64(params.dueAt),
        encodeAddressVec(attestors),
        encodeU32(threshold),
      ],
    );

    // The contract returns the new commitment ID. We resolve it by querying
    // the latest commitment via get_commitment with a best-effort scan.
    // Since Soroban doesn't return the return value of submitted (vs simulated)
    // transactions in the standard send flow, we extract the ID from the
    // transaction meta via pollTransaction's returnValue.
    //
    // The pollTransaction result for a successful tx contains a `returnValue`
    // on the `rpc.Api.GetSuccessfulTransactionResponse` type.
    const pollResult = await this.opts.rpcServer.getTransaction(txHash);
    if (
      pollResult.status === rpc.Api.GetTransactionStatus.SUCCESS &&
      'returnValue' in pollResult &&
      pollResult.returnValue != null
    ) {
      return BigInt(scValToNative(pollResult.returnValue));
    }

    throw new Error(
      `PactumClient.createCommitment: transaction succeeded (${txHash}) but return value could not be read.`,
    );
  }

  /**
   * Attests to the outcome of a commitment.
   *
   * @returns The transaction hash.
   *
   * @example
   * await client.attest({
   *   caller: 'G...',
   *   callerSecret: 'S...',
   *   id: 1n,
   *   outcome: CommitmentStatus.Fulfilled,
   * });
   */
  async attest(params: AttestParams): Promise<string> {
    return invokeContract(this.opts, params.callerSecret, 'attest', [
      encodeAddress(params.caller),
      encodeU64(params.id),
      encodeCommitmentStatus(params.outcome),
    ]);
  }

  /**
   * Raises a dispute on an attested commitment within the 7-day dispute window.
   *
   * @returns The transaction hash.
   *
   * @example
   * await client.dispute({ caller: 'G...', callerSecret: 'S...', id: 1n });
   */
  async dispute(params: DisputeParams): Promise<string> {
    return invokeContract(this.opts, params.callerSecret, 'dispute', [
      encodeAddress(params.caller),
      encodeU64(params.id),
    ]);
  }

  /**
   * Resolves a disputed commitment to a final outcome (arbitrator only).
   *
   * @returns The transaction hash.
   *
   * @example
   * await client.resolveDispute({
   *   arbitrator: 'G...',
   *   arbitratorSecret: 'S...',
   *   id: 1n,
   *   finalOutcome: CommitmentStatus.Breached,
   * });
   */
  async resolveDispute(params: ResolveDisputeParams): Promise<string> {
    return invokeContract(
      this.opts,
      params.arbitratorSecret,
      'resolve_dispute',
      [
        encodeAddress(params.arbitrator),
        encodeU64(params.id),
        encodeCommitmentStatus(params.finalOutcome),
      ],
    );
  }

  // ─── Read methods ───────────────────────────────────────────────────────────

  /**
   * Retrieves a commitment by its unique ID.
   *
   * Uses a read-only simulation so no signing is required.
   *
   * @example
   * const commitment = await client.getCommitment(1n);
   */
  async getCommitment(id: bigint): Promise<Commitment> {
    // Use a well-known Stellar account (the contract itself) as a read-only
    // stub. Any valid public key works here since the tx is never submitted.
    const stubPublicKey = this.opts.contract.address().toString();
    const val = await queryContract(this.opts, stubPublicKey, 'get_commitment', [
      encodeU64(id),
    ]);
    return decodeCommitment(val);
  }

  /**
   * Returns true if the commitment is still Pending and its due date has passed.
   *
   * @example
   * const overdue = await client.isOverdue(1n);
   */
  async isOverdue(id: bigint): Promise<boolean> {
    const stubPublicKey = this.opts.contract.address().toString();
    const val = await queryContract(this.opts, stubPublicKey, 'is_overdue', [
      encodeU64(id),
    ]);
    return Boolean(scValToNative(val));
  }

  /**
   * Retrieves the aggregate reputation for a given address.
   *
   * @example
   * const rep = await client.getReputation('G...');
   */
  async getReputation(address: string): Promise<Reputation> {
    const stubPublicKey = this.opts.contract.address().toString();
    const val = await queryContract(
      this.opts,
      stubPublicKey,
      'get_reputation',
      [encodeAddress(address)],
    );
    return decodeReputation(val);
  }

  /**
   * Retrieves the designated arbitrator address from the contract.
   *
   * @example
   * const arb = await client.getArbitrator();
   */
  async getArbitrator(): Promise<string> {
    const stubPublicKey = this.opts.contract.address().toString();
    const val = await queryContract(
      this.opts,
      stubPublicKey,
      'get_arbitrator',
      [],
    );
    return String(scValToNative(val));
  }

  // ─── Type re-exports for convenience ────────────────────────────────────────

  /** CommitmentStatus enum values, accessible as PactumClient.Status. */
  static readonly Status = {
    Pending: 0 as CommitmentStatus,
    Fulfilled: 1 as CommitmentStatus,
    Late: 2 as CommitmentStatus,
    Breached: 3 as CommitmentStatus,
    Disputed: 4 as CommitmentStatus,
  } as const;
}
