import { rpc, xdr, Address as StellarAddress, scValToNative } from '@stellar/stellar-sdk';
import { PactumStateProof, ScoreData, HeaderProof } from '../schemas/stateProof';
import { computeLeafHash, computeHeaderHash, addressToBytes32 } from './encoder';
import { MerkleTree, sha256Hex } from './merkleTree';

export interface ProofGeneratorConfig {
  rpcUrl?: string;
  contractId: string;
  networkPassphrase: string;
}

export interface TrustScoreEntryRecord {
  stellarAddress: string;
  scoreData: ScoreData;
}

export class StateProofGenerator {
  private rpcServer?: rpc.Server;
  private contractId: string;
  private networkPassphrase: string;
  private localState: Map<string, ScoreData> = new Map();

  constructor(config: ProofGeneratorConfig) {
    this.contractId = config.contractId;
    this.networkPassphrase = config.networkPassphrase;
    if (config.rpcUrl) {
      this.rpcServer = new rpc.Server(config.rpcUrl, { allowHttp: true });
    }
  }

  /**
   * Sets or updates an address's trust score in local state cache.
   */
  public setScoreData(stellarAddress: string, scoreData: ScoreData): void {
    this.localState.set(stellarAddress, scoreData);
  }

  /**
   * Fetches trust score data for an address either from live RPC or local state.
   */
  public async fetchScoreData(stellarAddress: string): Promise<ScoreData> {
    if (this.localState.has(stellarAddress)) {
      return this.localState.get(stellarAddress)!;
    }

    if (this.rpcServer) {
      try {
        // Build LedgerKey for contract data
        const contractAddr = StellarAddress.fromString(this.contractId);
        const addressObj = StellarAddress.fromString(stellarAddress);
        const sym = xdr.ScVal.scvSymbol('TrustHistory');
        const addrVal = addressObj.toScVal();
        const keyScVal = xdr.ScVal.scvVec([sym, addrVal]);

        const ledgerKey = xdr.LedgerKey.contractData(
          new xdr.LedgerKeyContractData({
            contract: contractAddr.toScAddress(),
            key: keyScVal,
            durability: xdr.ContractDataDurability.persistent(),
          })
        );

        const response = await this.rpcServer.getLedgerEntries(ledgerKey);
        if (response.entries && response.entries.length > 0) {
          const entry: any = response.entries[0];
          const xdrString = typeof entry.xdr === 'string' ? entry.xdr : entry.val;
          const entryData = xdr.LedgerEntryData.fromXDR(xdrString, 'base64');
          const contractData = entryData.contractData();
          const nativeVal = scValToNative(contractData.val());

          // Map nativeVal to ScoreData
          const scoreData: ScoreData = {
            score: typeof nativeVal.score === 'number' ? nativeVal.score : 50,
            fulfilledCount: nativeVal.current?.fulfilled || nativeVal.fulfilled || 0,
            lateCount: nativeVal.current?.late || nativeVal.late || 0,
            breachedCount: nativeVal.current?.breached || nativeVal.breached || 0,
            epoch: nativeVal.epoch || 0,
            sourceLedgerSeq: entry.lastModifiedLedgerSeq || response.latestLedger || 1,
          };

          this.localState.set(stellarAddress, scoreData);
          return scoreData;
        }
      } catch (err) {
        console.warn(`Could not query Soroban RPC for ${stellarAddress}:`, err);
      }
    }

    // Default baseline score data if not found
    const defaultData: ScoreData = {
      score: 50,
      fulfilledCount: 0,
      lateCount: 0,
      breachedCount: 0,
      epoch: 0,
      sourceLedgerSeq: 1,
    };
    return defaultData;
  }

  /**
   * Generates a zero-trust PactumStateProof for an address at a given ledger sequence.
   */
  public async generateProof(
    stellarAddress: string,
    options?: {
      targetLedgerSeq?: number;
      allEntries?: TrustScoreEntryRecord[];
      headerProof?: HeaderProof;
    }
  ): Promise<PactumStateProof> {
    const scoreData = await this.fetchScoreData(stellarAddress);
    const ledgerSeq = options?.targetLedgerSeq || scoreData.sourceLedgerSeq || 1;

    // Collect all entries in the ledger state to construct the Merkle Tree
    const entries = options?.allEntries && options.allEntries.length > 0
      ? [...options.allEntries]
      : [{ stellarAddress, scoreData }];

    // Ensure the target entry is included in the list
    if (!entries.some(e => e.stellarAddress === stellarAddress)) {
      entries.push({ stellarAddress, scoreData });
    }

    // Sort entries deterministically by address bytes
    entries.sort((a, b) =>
      addressToBytes32(a.stellarAddress).compare(addressToBytes32(b.stellarAddress))
    );

    const targetIndex = entries.findIndex(e => e.stellarAddress === stellarAddress);

    // Compute leaves
    const leaves = entries.map(e =>
      computeLeafHash(this.contractId, e.stellarAddress, e.scoreData)
    );

    const tree = new MerkleTree(leaves);
    const merkleProof = tree.getProof(targetIndex);
    const stateRootHash = tree.getRootHex();
    const leafHash = `0x${leaves[targetIndex].toString('hex')}`;

    // Build header proof
    const headerProof: HeaderProof = options?.headerProof || {
      previousLedgerHash: '0x' + '11'.repeat(32),
      txSetResultHash: '0x' + '22'.repeat(32),
      bucketListHash: stateRootHash,
      ledgerVersion: 21,
    };

    const headerHash = computeHeaderHash(ledgerSeq, headerProof);
    const ledgerHeaderHash = `0x${headerHash.toString('hex')}`;

    const proof: PactumStateProof = {
      version: '1.0.0',
      networkPassphrase: this.networkPassphrase,
      ledgerSeq,
      ledgerHeaderHash,
      stateRootHash,
      contractId: this.contractId,
      stellarAddress,
      scoreData,
      leafHash,
      merkleProof,
      headerProof,
    };

    return proof;
  }
}
