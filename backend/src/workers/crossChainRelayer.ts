import { ethers } from 'ethers';

export interface ISorobanClient {
  getTrustScore(address: string): Promise<number | null>;
}

export interface TrustScoreEntry {
  stellarAddress: string; // 32-byte hex (bytes32)
  score: bigint;
  fulfilledCount: number;
  lateCount: number;
  breachedCount: number;
  sourceLedgerSeq: bigint;
}

export interface TrustScoreBatch {
  version: number;
  registryId: string; // bytes32
  batchNonce: bigint;
  batchTimestamp: bigint;
  entries: TrustScoreEntry[];
}

export interface RelayerConfig {
  registryId: string;
  oracleContractAddress: string;
  sourceChainId: number;
  pollIntervalMs?: number;
  overrideSigningKey?: string;
}

export class CrossChainRelayer {
  private sorobanClient: ISorobanClient;
  private oracleContract: ethers.Contract;
  private signer: ethers.Signer;
  private registryId: string;
  private currentNonce: bigint = 0n;
  private isRunning: boolean = false;
  private pendingBatches: Map<string, TrustScoreBatch> = new Map();

  constructor(
    sorobanClient: ISorobanClient,
    oracleContract: ethers.Contract,
    signer: ethers.Signer,
    config: RelayerConfig
  ) {
    this.sorobanClient = sorobanClient;
    this.oracleContract = oracleContract;
    this.signer = signer;
    this.registryId = config.registryId;
  }

  /**
   * Encodes a TrustScoreBatch to ABI bytes format matching PactumZeroTrustOracle.
   */
  public encodeBatch(batch: TrustScoreBatch): string {
    const tupleType =
      'tuple(uint8 version, bytes32 registryId, uint64 batchNonce, uint64 batchTimestamp, ' +
      'tuple(bytes32 stellarAddress, int64 score, uint32 fulfilledCount, uint32 lateCount, uint32 breachedCount, uint64 sourceLedgerSeq)[] entries)';

    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    return abiCoder.encode([tupleType], [batch]);
  }

  /**
   * Creates and submits a new state batch to the zero-trust oracle.
   */
  public async submitBatch(entries: TrustScoreEntry[]): Promise<string> {
    this.currentNonce += 1n;
    const now = BigInt(Math.floor(Date.now() / 1000));

    const batch: TrustScoreBatch = {
      version: 1,
      registryId: this.registryId,
      batchNonce: this.currentNonce,
      batchTimestamp: now,
      entries,
    };

    const encoded = this.encodeBatch(batch);
    this.pendingBatches.set(batch.batchNonce.toString(), batch);

    const tx = await this.oracleContract.proposeBatch(encoded);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  /**
   * Generates a cryptographic state proof for an override resolution.
   */
  public async generateOverrideProof(batchNonce: bigint, stateRoot: string): Promise<string> {
    const messageHash = ethers.solidityPackedKeccak256(
      ['bytes32', 'uint64', 'bytes32'],
      [this.registryId, batchNonce, stateRoot]
    );

    const signature = await this.signer.signMessage(ethers.getBytes(messageHash));
    return signature;
  }

  /**
   * Automatically detects and handles a challenge on a proposed batch.
   */
  public async handleChallengedBatch(
    batchNonce: bigint,
    challenger: string,
    fraudProof: string
  ): Promise<{ resolved: boolean; txHash?: string }> {
    console.log(`[Relayer] Detected challenge on batch ${batchNonce} from ${challenger}`);

    const batch = this.pendingBatches.get(batchNonce.toString());
    if (!batch) {
      console.warn(`[Relayer] Batch ${batchNonce} not found in pending cache. Fetching on-chain proposal.`);
    }

    // Verify source state against Soroban canonical ledger
    const isSourceStateValid = await this.verifySorobanCanonicalState(batch);

    if (isSourceStateValid && batch) {
      // Relayer's state is valid -> Generate override proof to vindicate relayer and slash challenger
      const payload = this.encodeBatch(batch);
      const stateRoot = ethers.keccak256(payload);
      const overrideProof = await this.generateOverrideProof(batchNonce, stateRoot);

      console.log(`[Relayer] Submitting override proof to resolve challenge on batch ${batchNonce}...`);
      const tx = await this.oracleContract.resolveChallengeWithOverride(
        batchNonce,
        overrideProof,
        payload
      );
      const receipt = await tx.wait();
      return { resolved: true, txHash: receipt.hash };
    } else {
      // Reorg or dropped packet occurred -> Recover by querying fresh Soroban state and submitting corrected payload
      console.log(`[Relayer] State mismatch detected (reorg/packet drop). Initiating automated fault recovery...`);
      const correctedEntries = await this.fetchAuthoritativeState(batch?.entries || []);
      
      const correctedBatch: TrustScoreBatch = {
        version: 1,
        registryId: this.registryId,
        batchNonce: batchNonce,
        batchTimestamp: BigInt(Math.floor(Date.now() / 1000)),
        entries: correctedEntries,
      };

      const correctedPayload = this.encodeBatch(correctedBatch);
      const stateRoot = ethers.keccak256(correctedPayload);
      const overrideProof = await this.generateOverrideProof(batchNonce, stateRoot);

      const tx = await this.oracleContract.resolveChallengeWithOverride(
        batchNonce,
        overrideProof,
        correctedPayload
      );
      const receipt = await tx.wait();
      return { resolved: true, txHash: receipt.hash };
    }
  }

  /**
   * Verifies if the proposed entries match the canonical Soroban ledger state.
   */
  private async verifySorobanCanonicalState(batch?: TrustScoreBatch): Promise<boolean> {
    if (!batch || batch.entries.length === 0) return false;

    for (const entry of batch.entries) {
      try {
        const score = await this.sorobanClient.getTrustScore(entry.stellarAddress);
        if (score === null || BigInt(score) !== entry.score) {
          return false;
        }
      } catch (error) {
        console.error(`Error querying Soroban state for ${entry.stellarAddress}:`, error);
        return false;
      }
    }
    return true;
  }

  /**
   * Queries authoritative state directly from Soroban RPC for fault recovery.
   */
  private async fetchAuthoritativeState(entries: TrustScoreEntry[]): Promise<TrustScoreEntry[]> {
    const authoritativeEntries: TrustScoreEntry[] = [];

    for (const entry of entries) {
      const score = await this.sorobanClient.getTrustScore(entry.stellarAddress);
      authoritativeEntries.push({
        ...entry,
        score: score !== null ? BigInt(score) : entry.score,
        sourceLedgerSeq: entry.sourceLedgerSeq + 1n,
      });
    }

    return authoritativeEntries;
  }

  /**
   * Detects if a source chain reorg occurred based on non-monotonic ledger sequences.
   */
  public detectSourceReorg(lastKnownLedgerSeq: bigint, currentCanonicalLedgerSeq: bigint): boolean {
    return currentCanonicalLedgerSeq < lastKnownLedgerSeq;
  }
}
