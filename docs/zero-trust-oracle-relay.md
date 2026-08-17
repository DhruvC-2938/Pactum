# Zero-Trust Oracle Relay for Off-Chain Integrations

## Overview

Protocols integrating with Pactum from off-chain or non-Soroban environments (e.g., Ethereum EVM, Arbitrum, centralized exchanges, Web2 APIs) need to verify a user's Pactum trust score at a specific ledger height without trusting an intermediary relayer.

The **Zero-Trust Oracle Relay** achieves this by generating cryptographic Merkle state proofs (`PactumStateProof`) for contract data entries directly against known Stellar network block / ledger header hashes.

```
┌────────────────────────┐      ┌────────────────────────┐      ┌─────────────────────────┐
│ Stellar Soroban RPC    │ ───> │  Node.js Relayer       │ ───> │ EVM / Client Verifier   │
│ (Contract Data Entries)│      │  (Merkle State Proof)  │      │ (Cryptographic Check)   │
└────────────────────────┘      └────────────────────────┘      └─────────────────────────┘
                                                                             │
                                                                 Verified against known
                                                                 Stellar block header hash
                                                                 without trusting relayer!
```

---

## 1. Standard JSON Schema (`PactumStateProof`)

Location: `backend/src/schemas/pactum-state-proof.schema.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PactumStateProof",
  "type": "object",
  "required": [
    "version",
    "networkPassphrase",
    "ledgerSeq",
    "ledgerHeaderHash",
    "stateRootHash",
    "contractId",
    "stellarAddress",
    "scoreData",
    "leafHash",
    "merkleProof",
    "headerProof"
  ],
  "properties": {
    "version": { "type": "string", "enum": ["1.0.0"] },
    "networkPassphrase": { "type": "string" },
    "ledgerSeq": { "type": "integer", "minimum": 1 },
    "ledgerHeaderHash": { "type": "string", "pattern": "^0x[0-9a-fA-F]{64}$" },
    "stateRootHash": { "type": "string", "pattern": "^0x[0-9a-fA-F]{64}$" },
    "contractId": { "type": "string" },
    "stellarAddress": { "type": "string" },
    "scoreData": {
      "type": "object",
      "required": ["score", "fulfilledCount", "lateCount", "breachedCount", "epoch", "sourceLedgerSeq"],
      "properties": {
        "score": { "type": "integer", "minimum": 0, "maximum": 100 },
        "fulfilledCount": { "type": "integer", "minimum": 0 },
        "lateCount": { "type": "integer", "minimum": 0 },
        "breachedCount": { "type": "integer", "minimum": 0 },
        "epoch": { "type": "integer", "minimum": 0 },
        "sourceLedgerSeq": { "type": "integer", "minimum": 1 }
      }
    },
    "leafHash": { "type": "string", "pattern": "^0x[0-9a-fA-F]{64}$" },
    "merkleProof": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["sibling", "isRight"],
        "properties": {
          "sibling": { "type": "string", "pattern": "^0x[0-9a-fA-F]{64}$" },
          "isRight": { "type": "boolean" }
        }
      }
    },
    "headerProof": {
      "type": "object",
      "required": ["previousLedgerHash", "txSetResultHash", "bucketListHash", "ledgerVersion"],
      "properties": {
        "previousLedgerHash": { "type": "string", "pattern": "^0x[0-9a-fA-F]{64}$" },
        "txSetResultHash": { "type": "string", "pattern": "^0x[0-9a-fA-F]{64}$" },
        "bucketListHash": { "type": "string", "pattern": "^0x[0-9a-fA-F]{64}$" },
        "ledgerVersion": { "type": "integer", "minimum": 0 }
      }
    }
  }
}
```

---

## 2. Verification Protocol

Verification proceeds in 5 deterministic steps:

1. **Leaf Hash Verification**:
   ```
   leafHash = SHA-256(contractId || stellarAddress || score || fulfilledCount || lateCount || breachedCount || epoch || sourceLedgerSeq)
   ```
2. **Merkle Proof Verification**:
   ```
   Traverse audit path from leafHash to computedRoot. Assert computedRoot == stateRootHash.
   ```
3. **BucketList Hash Consistency**:
   ```
   Assert stateRootHash == headerProof.bucketListHash.
   ```
4. **Block Header Hash Verification**:
   ```
   headerHash = SHA-256(ledgerSeq || previousLedgerHash || txSetResultHash || bucketListHash || ledgerVersion)
   Assert headerHash == ledgerHeaderHash.
   ```
5. **Trusted Block Header Hash Comparison**:
   ```
   Assert ledgerHeaderHash == trustedLedgerHeaderHash.
   ```

---

## 3. Usage Examples

### TypeScript (`@pactum/sdk`)

```typescript
import { verifyPactumStateProof, type PactumStateProof } from '@pactum/sdk';

const result = verifyPactumStateProof(proof, trustedBlockHeaderHash);
if (result.valid) {
  console.log(`Verified Trust Score: ${result.score}`);
} else {
  console.error(`Verification Failed: ${result.error}`);
}
```

### Solidity (`PactumZeroTrustOracle.sol`)

```solidity
import { IPactumZeroTrustOracle } from "./interfaces/IPactumZeroTrustOracle.sol";
import { PactumStateProofVerifier } from "./libraries/PactumStateProofVerifier.sol";

// Call submitStateProof from any untrusted account:
oracle.submitStateProof(proof);

// Query verified trust score:
IPactumZeroTrustOracle.TrustScoreRecord memory record = oracle.getVerifiedTrustScore(stellarAddress);
```

### Relayer Service API

Query proof by address:
```http
GET /api/v1/proofs/trust-score/:address?ledgerSeq=12050
```
