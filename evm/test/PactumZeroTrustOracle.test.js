const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const SCHEMA_VERSION = 1;
const SOURCE_CHAIN_ID = 1001;
const REGISTRY_ID = ethers.id("pactum-registry-contract-id");
const SOURCE_ADDRESS = ethers.zeroPadValue(ethers.toBeHex(0xfeed), 32);
const MAX_BATCH_AGE = 24 * 60 * 60; // 24h
const CHALLENGE_PERIOD = 3600; // 1 hour
const MIN_RELAYER_BOND = ethers.parseEther("0.2");
const MIN_CHALLENGER_BOND = ethers.parseEther("0.1");

const BATCH_TUPLE_TYPE =
  "tuple(uint8 version, bytes32 registryId, uint64 batchNonce, uint64 batchTimestamp, " +
  "tuple(bytes32 stellarAddress, int64 score, uint32 fulfilledCount, uint32 lateCount, uint32 breachedCount, uint64 sourceLedgerSeq)[] entries)";

function encodeBatch(batch) {
  return ethers.AbiCoder.defaultAbiCoder().encode([BATCH_TUPLE_TYPE], [batch]);
}

function stellarAddr(n) {
  return ethers.zeroPadValue(ethers.toBeHex(n), 32);
}

function makeEntry(overrides = {}) {
  return {
    stellarAddress: stellarAddr(1),
    score: 85,
    fulfilledCount: 12,
    lateCount: 1,
    breachedCount: 0,
    sourceLedgerSeq: 1000,
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

describe("PactumZeroTrustOracle", function () {
  async function deployFixture() {
    const [owner, relayer, challenger, other] = await ethers.getSigners();

    const Endpoint = await ethers.getContractFactory("MockMessagingEndpoint");
    const endpoint = await Endpoint.deploy();

    const Oracle = await ethers.getContractFactory("PactumZeroTrustOracle");
    const oracle = await Oracle.deploy(
      owner.address,
      await endpoint.getAddress(),
      REGISTRY_ID,
      MAX_BATCH_AGE,
      CHALLENGE_PERIOD,
      MIN_RELAYER_BOND,
      MIN_CHALLENGER_BOND
    );

    await oracle.connect(owner).setTrustedRemote(SOURCE_CHAIN_ID, SOURCE_ADDRESS);

    // Fund relayer bond
    await oracle.connect(relayer).depositRelayerBond({ value: ethers.parseEther("1.0") });

    return { owner, relayer, challenger, other, endpoint, oracle };
  }

  describe("Proposal and Challenge Period", function () {
    it("enters Proposed state with challenge window upon receiving batch", async function () {
      const { relayer, oracle } = await loadFixture(deployFixture);
      const batch = await makeBatch({ batchNonce: 1 });
      const payload = encodeBatch(batch);

      const tx = await oracle.connect(relayer).proposeBatch(payload);
      await expect(tx)
        .to.emit(oracle, "BatchProposed")
        .withArgs(REGISTRY_ID, 1n, relayer.address, 1n, (await time.latest()) + CHALLENGE_PERIOD);

      const proposal = await oracle.getBatchProposal(1n);
      expect(proposal.batchNonce).to.equal(1n);
      expect(proposal.status).to.equal(1); // BatchStatus.Proposed
      expect(proposal.relayer).to.equal(relayer.address);

      // Score must NOT be active before finalization
      const score = await oracle.getTrustScore(stellarAddr(1));
      expect(score.updatedAt).to.equal(0n);
    });

    it("reverts if finalizing before the challenge period expires", async function () {
      const { relayer, oracle } = await loadFixture(deployFixture);
      const batch = await makeBatch({ batchNonce: 1 });
      await oracle.connect(relayer).proposeBatch(encodeBatch(batch));

      // Attempt to finalize immediately
      await expect(oracle.finalizeBatch(1n)).to.be.revertedWithCustomError(
        oracle,
        "ChallengePeriodNotExpired"
      );
    });

    it("finalizes successfully after challenge period expires without challenge", async function () {
      const { relayer, oracle } = await loadFixture(deployFixture);
      const batch = await makeBatch({ batchNonce: 1 });
      await oracle.connect(relayer).proposeBatch(encodeBatch(batch));

      // Advance time beyond challenge period
      await time.increase(CHALLENGE_PERIOD + 10);

      await expect(oracle.finalizeBatch(1n))
        .to.emit(oracle, "BatchFinalized")
        .withArgs(REGISTRY_ID, 1n, 1n)
        .and.to.emit(oracle, "TrustScoreBatchUpdated")
        .withArgs(REGISTRY_ID, 1n, 1n);

      const score = await oracle.getTrustScore(stellarAddr(1));
      expect(score.score).to.equal(85n);
      expect(score.fulfilledCount).to.equal(12n);
      expect(score.updatedAt).to.be.greaterThan(0n);
    });
  });

  describe("Bonded Fraud Proofs and Slashing", function () {
    it("rejects challenges with insufficient bond", async function () {
      const { relayer, challenger, oracle } = await loadFixture(deployFixture);
      const batch = await makeBatch({ batchNonce: 1 });
      await oracle.connect(relayer).proposeBatch(encodeBatch(batch));

      const fraudProof = ethers.hexlify(ethers.toUtf8Bytes("invalid-ledger-sequence-proof"));
      await expect(
        oracle.connect(challenger).challengeBatch(1n, fraudProof, "Invalid ledger sequence", {
          value: ethers.parseEther("0.01"), // Less than MIN_CHALLENGER_BOND (0.1)
        })
      ).to.be.revertedWithCustomError(oracle, "InsufficientBond");
    });

    it("transitions to Challenged status when valid bond is provided", async function () {
      const { relayer, challenger, oracle } = await loadFixture(deployFixture);
      const batch = await makeBatch({ batchNonce: 1 });
      await oracle.connect(relayer).proposeBatch(encodeBatch(batch));

      const fraudProof = ethers.hexlify(ethers.toUtf8Bytes("fraud-proof-payload"));
      await expect(
        oracle.connect(challenger).challengeBatch(1n, fraudProof, "Forged reputation score", {
          value: MIN_CHALLENGER_BOND,
        })
      )
        .to.emit(oracle, "BatchChallenged")
        .withArgs(1n, challenger.address, MIN_CHALLENGER_BOND, "Forged reputation score", fraudProof);

      const proposal = await oracle.getBatchProposal(1n);
      expect(proposal.status).to.equal(2); // BatchStatus.Challenged

      // Challenged batch cannot be finalized directly
      await time.increase(CHALLENGE_PERIOD + 10);
      await expect(oracle.finalizeBatch(1n)).to.be.revertedWithCustomError(
        oracle,
        "InvalidBatchStatus"
      );
    });

    it("slashes malicious relayer and rewards challenger when fraud is confirmed", async function () {
      const { owner, relayer, challenger, oracle } = await loadFixture(deployFixture);
      const batch = await makeBatch({ batchNonce: 1 });
      await oracle.connect(relayer).proposeBatch(encodeBatch(batch));

      const fraudProof = ethers.hexlify(ethers.toUtf8Bytes("conclusive-fraud-proof"));
      await oracle.connect(challenger).challengeBatch(1n, fraudProof, "Reorged source block", {
        value: MIN_CHALLENGER_BOND,
      });

      const challengerBalBefore = await ethers.provider.getBalance(challenger.address);

      // Adjudicator confirms fraud
      await expect(oracle.connect(owner).adjudicateChallenge(1n, true))
        .to.emit(oracle, "RelayerSlashed")
        .withArgs(relayer.address, MIN_RELAYER_BOND, challenger.address)
        .and.to.emit(oracle, "BatchReverted")
        .withArgs(REGISTRY_ID, 1n, "Reorged source block")
        .and.to.emit(oracle, "ChallengeResolved")
        .withArgs(1n, false, challenger.address, (MIN_RELAYER_BOND * 7000n) / 10000n);

      const challengerBalAfter = await ethers.provider.getBalance(challenger.address);
      expect(challengerBalAfter).to.be.greaterThan(challengerBalBefore);

      // Oracle state remains uncorrupted
      const score = await oracle.getTrustScore(stellarAddr(1));
      expect(score.updatedAt).to.equal(0n);
    });
  });

  describe("Automated Fault Recovery & Overriding Proofs", function () {
    it("allows relayer to submit overriding cryptographic proof to resolve frivolous challenge", async function () {
      const { relayer, challenger, oracle } = await loadFixture(deployFixture);
      const batch = await makeBatch({ batchNonce: 1 });
      const payload = encodeBatch(batch);
      await oracle.connect(relayer).proposeBatch(payload);

      // Frivolous challenge
      const fraudProof = ethers.hexlify(ethers.toUtf8Bytes("frivolous-claim"));
      await oracle.connect(challenger).challengeBatch(1n, fraudProof, "Unsubstantiated claim", {
        value: MIN_CHALLENGER_BOND,
      });

      const relayerBalBefore = await ethers.provider.getBalance(relayer.address);

      // Relayer provides cryptographic overriding proof
      const overrideProof = ethers.hexlify(ethers.toUtf8Bytes("soroban-cryptographic-state-attestation"));
      await expect(
        oracle.connect(relayer).resolveChallengeWithOverride(1n, overrideProof, payload)
      )
        .to.emit(oracle, "ChallengerSlashed")
        .withArgs(challenger.address, MIN_CHALLENGER_BOND, relayer.address)
        .and.to.emit(oracle, "ChallengeResolved")
        .withArgs(1n, true, relayer.address, (MIN_CHALLENGER_BOND * 7000n) / 10000n)
        .and.to.emit(oracle, "BatchFinalized")
        .withArgs(REGISTRY_ID, 1n, 1n);

      const relayerBalAfter = await ethers.provider.getBalance(relayer.address);
      expect(relayerBalAfter).to.be.greaterThan(relayerBalBefore);

      // State is finalized
      const score = await oracle.getTrustScore(stellarAddr(1));
      expect(score.score).to.equal(85n);
    });

    it("supports reorg fault recovery by applying corrected payload with override proof", async function () {
      const { relayer, challenger, oracle } = await loadFixture(deployFixture);
      const batch = await makeBatch({ batchNonce: 1, entries: [makeEntry({ score: 50 })] });
      await oracle.connect(relayer).proposeBatch(encodeBatch(batch));

      // Challenged due to reorg
      await oracle.connect(challenger).challengeBatch(1n, "0x1234", "Chain reorg detected", {
        value: MIN_CHALLENGER_BOND,
      });

      // Relayer submits corrected post-reorg batch
      const correctedBatch = await makeBatch({
        batchNonce: 1,
        entries: [makeEntry({ score: 92, sourceLedgerSeq: 1050 })],
      });
      const correctedPayload = encodeBatch(correctedBatch);
      const overrideProof = ethers.hexlify(ethers.toUtf8Bytes("post-reorg-canonical-proof"));

      await oracle.connect(relayer).resolveChallengeWithOverride(1n, overrideProof, correctedPayload);

      const score = await oracle.getTrustScore(stellarAddr(1));
      expect(score.score).to.equal(92n);
      expect(score.sourceLedgerSeq).to.equal(1050n);
    });
  });

  describe("Stake & Edge Case Handling", function () {
    it("allows unbonded stake withdrawal when no active proposals are locked", async function () {
      const { relayer, oracle } = await loadFixture(deployFixture);
      const stakeBefore = await oracle.getRelayerStake(relayer.address);
      expect(stakeBefore.bondedAmount).to.equal(ethers.parseEther("1.0"));

      await expect(oracle.connect(relayer).withdrawRelayerBond(ethers.parseEther("0.5")))
        .to.emit(oracle, "RelayerBondWithdrawn")
        .withArgs(relayer.address, ethers.parseEther("0.5"));

      const stakeAfter = await oracle.getRelayerStake(relayer.address);
      expect(stakeAfter.bondedAmount).to.equal(ethers.parseEther("0.5"));
    });

    it("prevents withdrawing locked stake while proposals are in flight", async function () {
      const { relayer, oracle } = await loadFixture(deployFixture);
      const batch = await makeBatch({ batchNonce: 1 });
      await oracle.connect(relayer).proposeBatch(encodeBatch(batch));

      // Attempt to withdraw all 1.0 ETH when 0.2 ETH is locked
      await expect(
        oracle.connect(relayer).withdrawRelayerBond(ethers.parseEther("1.0"))
      ).to.be.revertedWithCustomError(oracle, "InsufficientUnlockedStake");
    });
  });
});
