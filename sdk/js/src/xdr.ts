/**
 * XDR encoding and decoding utilities for the Pactum contract types.
 *
 * All Soroban contract values are encoded as ScVal (XDR). This module
 * provides thin, type-safe wrappers so callers never touch raw XDR.
 */
import { Address, nativeToScVal, scValToNative, xdr } from '@stellar/stellar-sdk';
import { CommitmentStatus, type Commitment, type Reputation } from './types.js';

// ─── Encoding ────────────────────────────────────────────────────────────────

/** Encode a Stellar address string as a ScVal Address. */
export function encodeAddress(address: string): xdr.ScVal {
  return new Address(address).toScVal();
}

/** Encode a u64 bigint as a ScVal u64. */
export function encodeU64(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: 'u64' });
}

/** Encode a u32 number as a ScVal u32. */
export function encodeU32(value: number): xdr.ScVal {
  return nativeToScVal(value, { type: 'u32' });
}

/**
 * Encode a CommitmentStatus enum value as a ScVal u32.
 * The Soroban contract uses `#[contracttype]` which serialises enums as
 * ScvLedgerKeyContractInstance variant with a u32 discriminant.
 */
export function encodeCommitmentStatus(status: CommitmentStatus): xdr.ScVal {
  // Soroban enum variants are encoded as ScVal with type xdr.ScValType.scvLedgerKeyContractInstance
  // when using #[contracttype], but for simple C-like enums the SDK nativeToScVal handles them
  // as u32 discriminants inside an ScvMap with an "0" key, i.e. a Soroban enum ScVal.
  // The Stellar SDK encodes Rust contracttype enums as ScvVec([ScvSymbol(variant_name)]) for
  // unit variants, which is what we need here.
  const variantName = CommitmentStatus[status] as string;
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(variantName)]);
}

/**
 * Encode a 32-byte hex string as a ScVal Bytes (BytesN<32>).
 */
export function encodeBytes32(hex: string): xdr.ScVal {
  const normalized = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (normalized.length !== 64) {
    throw new Error(
      `encodeBytes32: expected 32-byte hex string (64 chars), got ${normalized.length} chars.`,
    );
  }
  const buf = Buffer.from(normalized, 'hex');
  return xdr.ScVal.scvBytes(buf);
}

/**
 * Encode an array of address strings as a ScVal Vec<Address>.
 */
export function encodeAddressVec(addresses: string[]): xdr.ScVal {
  return xdr.ScVal.scvVec(addresses.map(encodeAddress));
}

// ─── Decoding ────────────────────────────────────────────────────────────────

/**
 * Decode a raw ScVal returned by Soroban simulation into a typed Commitment.
 *
 * The contract returns a `Commitment` struct serialised as a Soroban Map of
 * field-name symbols to values. `scValToNative` converts it to a plain object
 * with camelCase keys (actually the field names as written in Rust, so
 * snake_case). We normalise to the SDK's camelCase convention.
 */
export function decodeCommitment(val: xdr.ScVal): Commitment {
  // scValToNative converts Soroban Maps to plain JS objects with string keys.
  // For #[contracttype] structs the keys are the Rust field names (snake_case).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = scValToNative(val);

  return {
    id: BigInt(raw.id),
    issuer: raw.issuer.toString(),
    counterparty: raw.counterparty.toString(),
    termsHash: bufferToHex(raw.terms_hash),
    dueAt: BigInt(raw.due_at),
    status: decodeCommitmentStatus(raw.status),
    createdAt: BigInt(raw.created_at),
    attestedAt: raw.attested_at != null ? BigInt(raw.attested_at) : null,
    attestors: Array.isArray(raw.attestors) ? raw.attestors.map((a: unknown) => String(a)) : [],
    threshold: Number(raw.threshold),
  };
}

/**
 * Decode a raw ScVal returned by Soroban simulation into a typed Reputation.
 */
export function decodeReputation(val: xdr.ScVal): Reputation {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = scValToNative(val);
  return {
    fulfilledCount: Number(raw.fulfilled_count),
    lateCount: Number(raw.late_count),
    breachedCount: Number(raw.breached_count),
  };
}

/**
 * Decode a raw ScVal into a CommitmentStatus enum value.
 * Soroban unit-variant enums are returned as { variant_name: void } maps by
 * scValToNative.  We map the string key back to the numeric enum.
 */
export function decodeCommitmentStatus(raw: unknown): CommitmentStatus {
  if (typeof raw === 'object' && raw !== null) {
    const key = Object.keys(raw as object)[0];
    if (key !== undefined) {
      const idx = (CommitmentStatus as Record<string, unknown>)[key];
      if (typeof idx === 'number') return idx;
    }
  }
  // Fallback: handle plain numeric values (e.g. from scValToNative on u32)
  if (typeof raw === 'number' || typeof raw === 'bigint') {
    return Number(raw) as CommitmentStatus;
  }
  if (typeof raw === 'string') {
    const idx = (CommitmentStatus as Record<string, unknown>)[raw];
    if (typeof idx === 'number') return idx;
  }
  return CommitmentStatus.Pending;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function bufferToHex(buf: unknown): string {
  if (buf instanceof Uint8Array || Buffer.isBuffer(buf as object)) {
    return Buffer.from(buf as Uint8Array).toString('hex');
  }
  // Already a hex string
  if (typeof buf === 'string') return buf;
  return String(buf);
}
