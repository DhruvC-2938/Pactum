import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CrossChainRelayer, TrustScoreEntry } from '../src/workers/crossChainRelayer';

describe('CrossChainRelayer', () => {
  const dummyRegistryId = '0x1111111111111111111111111111111111111111111111111111111111111111';

  it('correctly identifies source chain reorganization', () => {
    const mockSorobanClient = {} as any;
    const mockOracleContract = {} as any;
    const mockSigner = {} as any;

    const relayer = new CrossChainRelayer(
      mockSorobanClient,
      mockOracleContract,
      mockSigner,
      {
        registryId: dummyRegistryId,
        oracleContractAddress: '0x0000000000000000000000000000000000000001',
        sourceChainId: 1001,
      }
    );

    // Reorg: canonical ledger sequence went backwards from 1050 to 1040
    assert.equal(relayer.detectSourceReorg(1050n, 1040n), true);

    // Monotonic progression: normal state
    assert.equal(relayer.detectSourceReorg(1050n, 1051n), false);
  });

  it('encodes batch into expected ABI wire format', () => {
    const mockSorobanClient = {} as any;
    const mockOracleContract = {} as any;
    const mockSigner = {} as any;

    const relayer = new CrossChainRelayer(
      mockSorobanClient,
      mockOracleContract,
      mockSigner,
      {
        registryId: dummyRegistryId,
        oracleContractAddress: '0x0000000000000000000000000000000000000001',
        sourceChainId: 1001,
      }
    );

    const entry: TrustScoreEntry = {
      stellarAddress: '0x0000000000000000000000000000000000000000000000000000000000000001',
      score: 95n,
      fulfilledCount: 10,
      lateCount: 0,
      breachedCount: 0,
      sourceLedgerSeq: 5000n,
    };

    const encoded = relayer.encodeBatch({
      version: 1,
      registryId: dummyRegistryId,
      batchNonce: 1n,
      batchTimestamp: 1700000000n,
      entries: [entry],
    });

    assert.ok(encoded.startsWith('0x'));
    assert.ok(encoded.length > 64);
  });
});
