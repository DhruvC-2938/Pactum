import { StateProofGenerator, ProofGeneratorConfig, TrustScoreEntryRecord } from './stateProofGenerator';
import { PactumStateProof, ScoreData } from '../schemas/stateProof';

export interface RelayerServiceOptions extends ProofGeneratorConfig {
  pollIntervalMs?: number;
  autoStart?: boolean;
}

export class RelayerService {
  private generator: StateProofGenerator;
  private proofCache: Map<string, PactumStateProof> = new Map();
  private pollIntervalMs: number;
  private isRunning: boolean = false;
  private intervalTimer?: NodeJS.Timeout;

  constructor(options: RelayerServiceOptions) {
    this.generator = new StateProofGenerator({
      rpcUrl: options.rpcUrl,
      contractId: options.contractId,
      networkPassphrase: options.networkPassphrase,
    });
    this.pollIntervalMs = options.pollIntervalMs || 30000;
    if (options.autoStart) {
      this.start();
    }
  }

  public getGenerator(): StateProofGenerator {
    return this.generator;
  }

  /**
   * Registers or updates a score for an address in the relayer's tracked state.
   */
  public updateScore(stellarAddress: string, scoreData: ScoreData): void {
    this.generator.setScoreData(stellarAddress, scoreData);
    // Invalidate cached proof so next fetch generates fresh proof
    this.proofCache.delete(stellarAddress);
  }

  /**
   * Generates and returns a zero-trust state proof for the requested Stellar address.
   */
  public async getProofForAddress(
    stellarAddress: string,
    options?: {
      targetLedgerSeq?: number;
      allEntries?: TrustScoreEntryRecord[];
    }
  ): Promise<PactumStateProof> {
    const proof = await this.generator.generateProof(stellarAddress, options);
    this.proofCache.set(stellarAddress, proof);
    return proof;
  }

  /**
   * Starts the background relayer loop.
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[RelayerService] Started with poll interval ${this.pollIntervalMs}ms`);

    this.intervalTimer = setInterval(async () => {
      try {
        await this.syncTrackedAddresses();
      } catch (err) {
        console.error('[RelayerService] Error during sync:', err);
      }
    }, this.pollIntervalMs);
  }

  /**
   * Stops the background relayer service.
   */
  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = undefined;
    }
    console.log('[RelayerService] Stopped');
  }

  private async syncTrackedAddresses(): Promise<void> {
    // Background refresh for cached addresses
    for (const address of this.proofCache.keys()) {
      try {
        const freshProof = await this.generator.generateProof(address);
        this.proofCache.set(address, freshProof);
      } catch (err) {
        console.warn(`[RelayerService] Failed to refresh proof for ${address}:`, err);
      }
    }
  }
}
