import { StrKey } from '@stellar/stellar-sdk';
import { sha256 } from './merkleTree';
import { HeaderProof, ScoreData } from '../schemas/stateProof';

/**
 * Converts a Stellar account (G...), contract (C...), or hex string to a 32-byte Buffer.
 */
export function addressToBytes32(address: string): Buffer {
  const clean = address.trim();
  if (clean.startsWith('0x')) {
    const raw = clean.slice(2).padStart(64, '0');
    return Buffer.from(raw, 'hex');
  }

  if (clean.startsWith('G')) {
    try {
      return Buffer.from(StrKey.decodeEd25519PublicKey(clean));
    } catch {
      // Fallback
    }
  }

  if (clean.startsWith('C')) {
    try {
      return Buffer.from(StrKey.decodeContract(clean));
    } catch {
      // Fallback
    }
  }

  // Fallback if plain hex without 0x
  if (/^[0-9a-fA-F]{64}$/.test(clean)) {
    return Buffer.from(clean, 'hex');
  }

  // Otherwise hash string to 32 bytes
  return sha256(Buffer.from(clean, 'utf8'));
}

/**
 * Encodes leaf payload into an 88-byte buffer matching Solidity abi.encodePacked:
 * - bytes32 contractId (32 bytes)
 * - bytes32 stellarAddress (32 bytes)
 * - uint32 score (4 bytes, BE)
 * - uint32 fulfilledCount (4 bytes, BE)
 * - uint32 lateCount (4 bytes, BE)
 * - uint32 breachedCount (4 bytes, BE)
 * - uint32 epoch (4 bytes, BE)
 * - uint64 sourceLedgerSeq (8 bytes, BE)
 */
export function encodeLeafPayload(
  contractIdBytes: Buffer,
  stellarAddressBytes: Buffer,
  scoreData: ScoreData
): Buffer {
  const buf = Buffer.alloc(92);

  contractIdBytes.copy(buf, 0, 0, 32);
  stellarAddressBytes.copy(buf, 32, 0, 32);
  buf.writeUInt32BE(scoreData.score, 64);
  buf.writeUInt32BE(scoreData.fulfilledCount, 68);
  buf.writeUInt32BE(scoreData.lateCount, 72);
  buf.writeUInt32BE(scoreData.breachedCount, 76);
  buf.writeUInt32BE(scoreData.epoch, 80);

  // Write uint64 sourceLedgerSeq as BigInt (8 bytes big endian)
  buf.writeBigUInt64BE(BigInt(scoreData.sourceLedgerSeq), 84);

  return buf;
}

/**
 * Computes the 32-byte SHA-256 leaf hash for a trust score contract data entry.
 */
export function computeLeafHash(
  contractId: string,
  stellarAddress: string,
  scoreData: ScoreData
): Buffer {
  const contractIdBytes = addressToBytes32(contractId);
  const stellarAddressBytes = addressToBytes32(stellarAddress);
  const payload = encodeLeafPayload(contractIdBytes, stellarAddressBytes, scoreData);
  return sha256(payload);
}

/**
 * Encodes header fields into buffer matching Solidity abi.encodePacked:
 * - uint32 ledgerSeq (4 bytes, BE)
 * - bytes32 previousLedgerHash (32 bytes)
 * - bytes32 txSetResultHash (32 bytes)
 * - bytes32 bucketListHash (32 bytes)
 * - uint32 ledgerVersion (4 bytes, BE)
 * Total: 104 bytes
 */
export function encodeHeaderPayload(
  ledgerSeq: number,
  headerProof: HeaderProof
): Buffer {
  const buf = Buffer.alloc(104);

  buf.writeUInt32BE(ledgerSeq, 0);

  const prevHash = Buffer.from(headerProof.previousLedgerHash.replace(/^0x/, ''), 'hex');
  const txHash = Buffer.from(headerProof.txSetResultHash.replace(/^0x/, ''), 'hex');
  const bucketHash = Buffer.from(headerProof.bucketListHash.replace(/^0x/, ''), 'hex');

  prevHash.copy(buf, 4, 0, 32);
  txHash.copy(buf, 36, 0, 32);
  bucketHash.copy(buf, 68, 0, 32);
  buf.writeUInt32BE(headerProof.ledgerVersion, 100);

  return buf;
}

/**
 * Computes the SHA-256 header hash from ledger sequence and header proof fields.
 */
export function computeHeaderHash(
  ledgerSeq: number,
  headerProof: HeaderProof
): Buffer {
  const payload = encodeHeaderPayload(ledgerSeq, headerProof);
  return sha256(payload);
}
