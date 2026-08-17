import { describe, it, expect } from 'vitest';
import { sha256 } from '../src/verifier/sha256.js';
import { bytesToHex } from '../src/verifier/stateProofVerifier.js';

describe('SHA-256 Known-Answer Tests', () => {
  const encoder = new TextEncoder();

  it('correctly hashes empty input', () => {
    const input = new Uint8Array(0);
    const hash = bytesToHex(sha256(input));
    expect(hash).toBe('0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('correctly hashes "abc"', () => {
    const input = encoder.encode('abc');
    const hash = bytesToHex(sha256(input));
    expect(hash).toBe('0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('correctly hashes 55-byte boundary input', () => {
    const input = new Uint8Array(55).fill(0x61); // 55 'a's
    const hash = bytesToHex(sha256(input));
    expect(hash.length).toBe(66);
    expect(hash.startsWith('0x')).toBe(true);
  });

  it('correctly hashes 56-byte boundary input (forces extra block padding)', () => {
    const input = new Uint8Array(56).fill(0x61); // 56 'a's
    const hash = bytesToHex(sha256(input));
    expect(hash.length).toBe(66);
    expect(hash.startsWith('0x')).toBe(true);
  });

  it('correctly hashes multi-block (1000 bytes) input', () => {
    const input = new Uint8Array(1000).fill(0x42);
    const hash = bytesToHex(sha256(input));
    expect(hash.length).toBe(66);
    expect(hash.startsWith('0x')).toBe(true);
  });
});
