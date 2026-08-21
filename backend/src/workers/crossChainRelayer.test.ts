import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CrossChainRelayer } from './crossChainRelayer';

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

    // Reorg: canonical ledger sequence rolled backward from 1050 to 1040
    assert.equal(relayer.detectSourceReorg(1050n, 1040n), true);

    // Monotonic progression: standard sequential advance
    assert.equal(relayer.detectSourceReorg(1050n, 1051n), false);
  });
});
