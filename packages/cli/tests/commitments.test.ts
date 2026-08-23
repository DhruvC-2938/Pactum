import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import {
  createCommitmentsCommand,
  truncateAddress,
  formatStatus,
  formatDueDate,
} from '../src/commands/commitments.js';

describe('Pactum CLI Commitments Command', () => {
  let logSpy: any;
  let errSpy: any;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('truncates address cleanly', () => {
    expect(truncateAddress('GB4UFB7S4CZ6YJ4G77HHZX4C3R7L64UK7Q4GB4UFB7S4CZ6YJ4G77HHZX4C')).toBe('GB4UFB...ZX4C');
    expect(truncateAddress('SHORT')).toBe('SHORT');
    expect(truncateAddress(undefined)).toBe('—');
  });

  it('formats status colors', () => {
    expect(formatStatus('Fulfilled')).toContain('Fulfilled');
    expect(formatStatus('Pending')).toContain('Pending');
    expect(formatStatus('Breached')).toContain('Breached');
  });

  it('formats dates consistently', () => {
    const formatted = formatDueDate(1710000000);
    expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(formatDueDate(undefined)).toBe('—');
  });

  it('lists commitments and formats JSON output', async () => {
    const keypair = Keypair.random();
    const address = keypair.publicKey();

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 1,
          party_a: address,
          party_b: 'GCJUKU7S4CZ6YJ4G77HHZX4C3R7L64UK7Q4GB4UFB7S4CZ6YJ4G77HHZX4C',
          status: 'Pending',
          due_at: 1750000000,
          encrypted: false,
        },
      ],
    });
    global.fetch = mockFetch;

    const cmd = createCommitmentsCommand();
    await cmd.parseAsync(['node', 'test', 'list', address, '--json']);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.address).toBe(address);
    expect(parsed.count).toBe(1);
    expect(parsed.commitments[0].status).toBe('Pending');
  });

  it('rejects an invalid stellar public key', async () => {
    const cmd = createCommitmentsCommand();
    process.exitCode = 0;
    await cmd.parseAsync(['node', 'test', 'list', 'INVALID_PUBLIC_KEY', '--json']);

    expect(process.exitCode).toBe(1);
    const errOutput = errSpy.mock.calls[0][0];
    expect(errOutput).toContain('Invalid Stellar public key');
  });
});
