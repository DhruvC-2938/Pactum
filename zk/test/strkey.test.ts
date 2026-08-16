import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { StrKey } from '@stellar/stellar-sdk';

import { addressToLimbs, decodeEd25519PublicKey } from '../src/strkey.ts';
import { testAddress } from './helpers.ts';

describe('decodeEd25519PublicKey', () => {
  it('matches the Stellar SDK across a spread of addresses', () => {
    for (let index = 0; index < 32; index++) {
      const address = testAddress(index);
      assert.deepEqual(
        Buffer.from(decodeEd25519PublicKey(address)),
        StrKey.decodeEd25519PublicKey(address),
        `mismatch for ${address}`,
      );
    }
  });

  it('rejects an address whose checksum has been tampered with', () => {
    const address = testAddress(0);
    const corrupted = `${address.slice(0, 55)}${address[55] === 'A' ? 'B' : 'A'}`;
    assert.throws(() => decodeEd25519PublicKey(corrupted), /checksum/i);
  });

  it('rejects a contract address, which carries a different version byte', () => {
    const contractId = 'CBADTVTJ6IN332HIKZ7LWUYMYTLPZYCEBV3X2HS47VHR5UDBHQ3GAA7E';
    assert.throws(() => decodeEd25519PublicKey(contractId), /version byte/i);
  });

  it('rejects a string of the wrong length', () => {
    assert.throws(() => decodeEd25519PublicKey('GABC'), /56-character/);
  });

  it('rejects characters outside the base32 alphabet', () => {
    assert.throws(() => decodeEd25519PublicKey(`${testAddress(0).slice(0, 55)}1`), /base32/i);
  });
});

describe('addressToLimbs', () => {
  it('splits the key into two 128-bit halves that recombine to the original', () => {
    const address = testAddress(7);
    const { hi, lo } = addressToLimbs(address);

    assert.ok(hi < 2n ** 128n, 'hi limb must fit in 128 bits');
    assert.ok(lo < 2n ** 128n, 'lo limb must fit in 128 bits');

    const recombined = (hi << 128n) | lo;
    const expected = BigInt(`0x${Buffer.from(decodeEd25519PublicKey(address)).toString('hex')}`);
    assert.equal(recombined, expected);
  });

  it('gives distinct addresses distinct limb pairs', () => {
    const a = addressToLimbs(testAddress(0));
    const b = addressToLimbs(testAddress(1));
    assert.notDeepEqual(a, b);
  });
});
