/* eslint-disable */
const { expect } = require('chai');
const { ethers } = require('hardhat');
const { loadFixture, time } = require('@nomicfoundation/hardhat-network-helpers');

const SCHEMA_VERSION = 1;
const SOURCE_CHAIN_ID = 1001; // arbitrary id standing in for "Stellar Pubnet"
const REGISTRY_ID = ethers.id('pactum-registry-contract-id');
const SOURCE_ADDRESS = ethers.zeroPadValue(ethers.toBeHex(0xfeed), 32);
const MAX_BATCH_AGE = 24 * 60 * 60; // 24h, matches the default suggested in the design doc

const BATCH_TUPLE_TYPE =
  'tuple(uint8 version, bytes32 registryId, uint64 batchNonce, uint64 batchTimestamp, ' +
  'tuple(bytes32 stellarAddress, int64 score, uint32 fulfilledCount, uint32 lateCount, uint32 breachedCount, uint64 sourceLedgerSeq)[] entries)';

function encodeBatch(batch) {
  return ethers.AbiCoder.defaultAbiCoder().encode([BATCH_TUPLE_TYPE], [batch]);
}

function stellarAddr(n) {
  return ethers.zeroPadValue(ethers.toBeHex(n), 32);
}

function makeEntry(overrides = {}) {
  return {
    stellarAddress: stellarAddr(1),
    score: 42,
    fulfilledCount: 5,
    lateCount: 1,
    breachedCount: 0,
    sourceLedgerSeq: 100,
    ...overrides,
  };
}

async function makeBatch(overrides = {}) {
  return {
    version: SCHEMA_VERSION,
    registryId: REGISTRY_ID,
    batchNonce: 1,
    batchTimestamp: await time.latest(),
    entries: [makeEntry()],
    ...overrides,
  };
}

describe('PactumTrustOracle', function () {
  async function deployFixture() {
    const [owner, other] = await ethers.getSigners();

    const Endpoint = await ethers.getContractFactory('MockMessagingEndpoint');
    const endpoint = await Endpoint.deploy();

    const Oracle = await ethers.getContractFactory('PactumTrustOracle');
    const oracle = await Oracle.deploy(
      owner.address,
      await endpoint.getAddress(),
      REGISTRY_ID,
      MAX_BATCH_AGE,
    );

    await oracle.connect(owner).setTrustedRemote(SOURCE_CHAIN_ID, SOURCE_ADDRESS);

    return { owner, other, endpoint, oracle };
  }

  async function deliver(endpoint, oracle, batch, opts = {}) {
    const payload = encodeBatch(batch);
    return endpoint.deliver(
      await oracle.getAddress(),
      opts.sourceChainId ?? SOURCE_CHAIN_ID,
      opts.sourceAddress ?? SOURCE_ADDRESS,
      payload,
    );
  }

  describe('happy path', function () {
    it('applies a valid batch and caches the trust score', async function () {
      const { endpoint, oracle } = await loadFixture(deployFixture);
      const batch = await makeBatch();

      await expect(deliver(endpoint, oracle, batch))
        .to.emit(oracle, 'TrustScoreBatchUpdated')
        .withArgs(REGISTRY_ID, 1n, 1n);

      const stored = await oracle.getTrustScore(stellarAddr(1));
      expect(stored.score).to.equal(42n);
      expect(stored.fulfilledCount).to.equal(5n);
      expect(stored.lateCount).to.equal(1n);
      expect(stored.breachedCount).to.equal(0n);
      expect(stored.sourceLedgerSeq).to.equal(100n);
      expect(stored.updatedAt).to.be.greaterThan(0n);

      expect(await oracle.isStale(stellarAddr(1), MAX_BATCH_AGE)).to.equal(false);
    });

    it('applies multiple entries in one batch', async function () {
      const { endpoint, oracle } = await loadFixture(deployFixture);
      const batch = await makeBatch({
        entries: [
          makeEntry({ stellarAddress: stellarAddr(1), score: 10 }),
          makeEntry({ stellarAddress: stellarAddr(2), score: -5 }),
          makeEntry({ stellarAddress: stellarAddr(3), score: 0 }),
        ],
      });

      await deliver(endpoint, oracle, batch);

      expect((await oracle.getTrustScore(stellarAddr(1))).score).to.equal(10n);
      expect((await oracle.getTrustScore(stellarAddr(2))).score).to.equal(-5n);
      expect((await oracle.getTrustScore(stellarAddr(3))).score).to.equal(0n);
    });

    it('only emits per-entry events when emitDetailedEvents is enabled', async function () {
      const { owner, endpoint, oracle } = await loadFixture(deployFixture);
      const batch = await makeBatch();

      await expect(deliver(endpoint, oracle, batch)).to.not.emit(oracle, 'TrustScoreUpdated');

      await oracle.connect(owner).setEmitDetailedEvents(true);
      const batch2 = await makeBatch({
        batchNonce: 2,
        entries: [makeEntry({ sourceLedgerSeq: 101 })],
      });
      await expect(deliver(endpoint, oracle, batch2))
        .to.emit(oracle, 'TrustScoreUpdated')
        .withArgs(stellarAddr(1), 42n, 101n);
    });
  });

  describe('layer 1: transport authenticity', function () {
    it('rejects calls that do not come from the configured messaging endpoint', async function () {
      const { other, oracle } = await loadFixture(deployFixture);
      const batch = await makeBatch();
      const payload = encodeBatch(batch);

      await expect(oracle.connect(other).receiveMessage(SOURCE_CHAIN_ID, SOURCE_ADDRESS, payload))
        .to.be.revertedWithCustomError(oracle, 'NotMessagingEndpoint')
        .withArgs(other.address);
    });

    it('rejects an unregistered source chain id', async function () {
      const { endpoint, oracle } = await loadFixture(deployFixture);
      const batch = await makeBatch();

      await expect(
        deliver(endpoint, oracle, batch, { sourceChainId: 9999 }),
      ).to.be.revertedWithCustomError(oracle, 'UntrustedRemote');
    });

    it("rejects a source address that doesn't match the trusted remote", async function () {
      const { endpoint, oracle } = await loadFixture(deployFixture);
      const batch = await makeBatch();
      const forgedSource = stellarAddr(666);

      await expect(
        deliver(endpoint, oracle, batch, { sourceAddress: forgedSource }),
      ).to.be.revertedWithCustomError(oracle, 'UntrustedRemote');
    });
  });

  describe('layer 2: application-level integrity', function () {
    it('rejects an unsupported schema version', async function () {
      const { endpoint, oracle } = await loadFixture(deployFixture);
      const batch = await makeBatch({ version: 2 });

      await expect(deliver(endpoint, oracle, batch))
        .to.be.revertedWithCustomError(oracle, 'UnsupportedVersion')
        .withArgs(2);
    });

    it('rejects a batch declaring an unknown registry id', async function () {
      const { endpoint, oracle } = await loadFixture(deployFixture);
      const foreignRegistry = ethers.id('some-other-registry');
      const batch = await makeBatch({ registryId: foreignRegistry });

      await expect(deliver(endpoint, oracle, batch))
        .to.be.revertedWithCustomError(oracle, 'UnknownRegistry')
        .withArgs(foreignRegistry);
    });

    it('rejects a batch larger than MAX_BATCH_SIZE', async function () {
      const { endpoint, oracle } = await loadFixture(deployFixture);
      const max = await oracle.MAX_BATCH_SIZE();
      const tooMany = Number(max) + 1;
      const entries = Array.from({ length: tooMany }, (_, i) =>
        makeEntry({ stellarAddress: stellarAddr(i + 1), sourceLedgerSeq: i + 1 }),
      );
      const batch = await makeBatch({ entries });

      await expect(deliver(endpoint, oracle, batch)).to.be.revertedWithCustomError(
        oracle,
        'BatchTooLarge',
      );
    });

    it('rejects a replayed batch (same nonce)', async function () {
      const { endpoint, oracle } = await loadFixture(deployFixture);
      const batch = await makeBatch();
      await deliver(endpoint, oracle, batch);

      await expect(deliver(endpoint, oracle, batch)).to.be.revertedWithCustomError(
        oracle,
        'NonceNotIncreasing',
      );
    });

    it('rejects a batch with a lower nonce than the last applied one', async function () {
      const { endpoint, oracle } = await loadFixture(deployFixture);
      await deliver(endpoint, oracle, await makeBatch({ batchNonce: 5 }));

      await expect(
        deliver(endpoint, oracle, await makeBatch({ batchNonce: 3 })),
      ).to.be.revertedWithCustomError(oracle, 'NonceNotIncreasing');
    });

    it('rejects a batch older than maxBatchAge', async function () {
      const { endpoint, oracle } = await loadFixture(deployFixture);
      const staleTimestamp = (await time.latest()) - MAX_BATCH_AGE - 3600;
      const batch = await makeBatch({ batchTimestamp: staleTimestamp });

      await expect(deliver(endpoint, oracle, batch)).to.be.revertedWithCustomError(
        oracle,
        'BatchTooStale',
      );
    });

    it('accepts a batch that is old but still within the staleness window', async function () {
      const { endpoint, oracle } = await loadFixture(deployFixture);
      // A few seconds of headroom below the boundary, since submitting the transaction
      // itself advances block.timestamp by at least one second.
      const nearBoundaryTimestamp = (await time.latest()) - (MAX_BATCH_AGE - 5);
      const batch = await makeBatch({ batchTimestamp: nearBoundaryTimestamp });

      await expect(deliver(endpoint, oracle, batch)).to.not.be.reverted;
    });

    it('rejects an out-of-order sourceLedgerSeq for the same address across batches', async function () {
      const { endpoint, oracle } = await loadFixture(deployFixture);
      await deliver(
        endpoint,
        oracle,
        await makeBatch({ batchNonce: 1, entries: [makeEntry({ sourceLedgerSeq: 100 })] }),
      );

      await expect(
        deliver(
          endpoint,
          oracle,
          await makeBatch({ batchNonce: 2, entries: [makeEntry({ sourceLedgerSeq: 50 })] }),
        ),
      ).to.be.revertedWithCustomError(oracle, 'LedgerSeqNotIncreasing');
    });

    it("does not let an older batch's ledger seq clobber a newer one already applied, even for a different address in the same later batch", async function () {
      const { endpoint, oracle } = await loadFixture(deployFixture);
      await deliver(
        endpoint,
        oracle,
        await makeBatch({
          batchNonce: 1,
          entries: [makeEntry({ stellarAddress: stellarAddr(1), sourceLedgerSeq: 100 })],
        }),
      );

      // batch 2 has a valid (higher) nonce, and correctly advances address 2, but tries to
      // regress address 1 - only address 1's entry must be rejected.
      await expect(
        deliver(
          endpoint,
          oracle,
          await makeBatch({
            batchNonce: 2,
            entries: [
              makeEntry({ stellarAddress: stellarAddr(1), sourceLedgerSeq: 99 }),
              makeEntry({ stellarAddress: stellarAddr(2), sourceLedgerSeq: 1 }),
            ],
          }),
        ),
      ).to.be.revertedWithCustomError(oracle, 'LedgerSeqNotIncreasing');

      // and because the whole call reverted, address 2 must not have been applied either.
      expect((await oracle.getTrustScore(stellarAddr(2))).updatedAt).to.equal(0n);
    });
  });

  describe('staleness reads', function () {
    it('treats an address with no history as stale', async function () {
      const { oracle } = await loadFixture(deployFixture);
      expect(await oracle.isStale(stellarAddr(1), MAX_BATCH_AGE)).to.equal(true);
    });

    it('becomes stale once maxAge has elapsed since the last update', async function () {
      const { endpoint, oracle } = await loadFixture(deployFixture);
      await deliver(endpoint, oracle, await makeBatch());

      expect(await oracle.isStale(stellarAddr(1), 1000)).to.equal(false);
      await time.increase(1001);
      expect(await oracle.isStale(stellarAddr(1), 1000)).to.equal(true);
    });
  });

  describe('owner configuration', function () {
    it('restricts configuration setters to the owner', async function () {
      const { other, oracle } = await loadFixture(deployFixture);

      await expect(oracle.connect(other).setMessagingEndpoint(other.address)).to.be.reverted;
      await expect(oracle.connect(other).setTrustedRemote(1, stellarAddr(1))).to.be.reverted;
      await expect(oracle.connect(other).setRegistryId(stellarAddr(1))).to.be.reverted;
      await expect(oracle.connect(other).setMaxBatchAge(1)).to.be.reverted;
      await expect(oracle.connect(other).setEmitDetailedEvents(true)).to.be.reverted;
    });

    it('lets the owner rotate the messaging endpoint and registry id', async function () {
      const { owner, oracle } = await loadFixture(deployFixture);
      const newEndpoint = ethers.Wallet.createRandom().address;
      const newRegistry = ethers.id('new-registry');

      await expect(oracle.connect(owner).setMessagingEndpoint(newEndpoint))
        .to.emit(oracle, 'MessagingEndpointUpdated')
        .withArgs(newEndpoint);
      expect(await oracle.messagingEndpoint()).to.equal(newEndpoint);

      await expect(oracle.connect(owner).setRegistryId(newRegistry))
        .to.emit(oracle, 'RegistryIdUpdated')
        .withArgs(newRegistry);
      expect(await oracle.registryId()).to.equal(newRegistry);
    });
  });
});
