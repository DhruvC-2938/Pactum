/**
 * Minimal Stellar strkey decoding.
 *
 * The prover runs in the user's browser, where pulling in the full
 * `@stellar/stellar-sdk` just to turn a `G...` string into 32 bytes is a large
 * dependency for a small job. This is decode-only and is cross-checked against
 * the SDK in `test/strkey.test.ts`.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Version byte for an ed25519 public key; it is what renders the leading `G`. */
const VERSION_BYTE_ED25519_PUBLIC_KEY = 6 << 3;

/** 1 version byte + 32 key bytes + 2 checksum bytes, which is exactly 56 base32 chars. */
const STRKEY_LENGTH = 56;

function base32Decode(input: string): Uint8Array {
  const out = new Uint8Array((input.length * 5) / 8);
  let value = 0;
  let bits = 0;
  let written = 0;

  for (const char of input) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid base32 character in strkey: ${JSON.stringify(char)}`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[written++] = (value >> bits) & 0xff;
    }
  }

  return out;
}

/** CRC16-XModem (poly 0x1021, zero init), the checksum Stellar strkeys carry. */
function crc16Xmodem(bytes: Uint8Array): number {
  let crc = 0x0000;

  for (const byte of bytes) {
    let code = (crc >>> 8) & 0xff;
    code ^= byte & 0xff;
    code ^= code >>> 4;
    crc = (crc << 8) & 0xffff;
    crc ^= code;
    code = (code << 5) & 0xffff;
    crc ^= code;
    code = (code << 7) & 0xffff;
    crc ^= code;
  }

  return crc;
}

/**
 * Decodes a `G...` account address to its raw 32-byte ed25519 public key.
 *
 * @throws If the address is malformed, has the wrong version byte, or fails its checksum.
 */
export function decodeEd25519PublicKey(address: string): Uint8Array {
  if (address.length !== STRKEY_LENGTH) {
    throw new Error(`Expected a ${STRKEY_LENGTH}-character address, got ${address.length}`);
  }

  const decoded = base32Decode(address);

  if (decoded[0] !== VERSION_BYTE_ED25519_PUBLIC_KEY) {
    throw new Error('Not an ed25519 public key address (unexpected version byte)');
  }

  const payload = decoded.subarray(0, 33);
  const expected = crc16Xmodem(payload);
  // The checksum is appended little-endian.
  if (decoded[33] !== (expected & 0xff) || decoded[34] !== ((expected >> 8) & 0xff)) {
    throw new Error('Address checksum mismatch');
  }

  return decoded.slice(1, 33);
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

/**
 * Splits a Stellar account address into the two 128-bit limbs the circuit expects.
 *
 * A 256-bit ed25519 key does not fit in a single BN254 field element (254 bits), so
 * encoding it as one element would mean reducing mod p — and two distinct keys whose
 * difference is p would then commit to the same leaf. Two limbs avoid that entirely.
 */
export function addressToLimbs(address: string): { hi: bigint; lo: bigint } {
  const key = decodeEd25519PublicKey(address);
  return {
    hi: bytesToBigInt(key.subarray(0, 16)),
    lo: bytesToBigInt(key.subarray(16, 32)),
  };
}
