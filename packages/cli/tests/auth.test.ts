import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Keypair } from '@stellar/stellar-sdk';
import { createAuthCommand } from '../src/commands/auth.js';
import { getStoredCredentials } from '../src/config.js';

describe('Pactum CLI Auth Command', () => {
  let testConfigDir: string;
  let logSpy: any;
  let errSpy: any;

  beforeEach(() => {
    testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactum-cli-auth-test-'));
    process.env.PACTUM_CONFIG_DIR = testConfigDir;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  it('authenticates and stores a valid secret key', async () => {
    const keypair = Keypair.random();
    const secret = keypair.secret();
    const pub = keypair.publicKey();

    const cmd = createAuthCommand();
    await cmd.parseAsync(['node', 'test', secret, '--network', 'testnet']);

    const creds = getStoredCredentials();
    expect(creds.secretKey).toBe(secret);
    expect(creds.address).toBe(pub);
    expect(creds.network).toBe('testnet');
  });

  it('rejects an invalid secret key', async () => {
    const cmd = createAuthCommand();
    process.exitCode = 0;
    await cmd.parseAsync(['node', 'test', 'INVALID_SECRET_KEY']);

    expect(process.exitCode).toBe(1);
    const creds = getStoredCredentials();
    expect(creds.secretKey).toBeUndefined();
  });

  it('outputs status in JSON format with --status --json', async () => {
    const keypair = Keypair.random();
    const cmd = createAuthCommand();
    await cmd.parseAsync(['node', 'test', keypair.secret()]);

    const statusCmd = createAuthCommand();
    await statusCmd.parseAsync(['node', 'test', '--status', '--json']);

    const lastCall = logSpy.mock.calls[logSpy.mock.calls.length - 1][0];
    const parsed = JSON.parse(lastCall);
    expect(parsed.authenticated).toBe(true);
    expect(parsed.address).toBe(keypair.publicKey());
  });

  it('clears credentials with --clear', async () => {
    const keypair = Keypair.random();
    const cmd = createAuthCommand();
    await cmd.parseAsync(['node', 'test', keypair.secret()]);

    const clearCmd = createAuthCommand();
    await clearCmd.parseAsync(['node', 'test', '--clear']);

    const creds = getStoredCredentials();
    expect(creds.address).toBeUndefined();
  });
});
