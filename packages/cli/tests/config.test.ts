import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Keypair } from '@stellar/stellar-sdk';
import {
  getConfigDir,
  getConfigFilePath,
  saveConfig,
  loadConfig,
  saveCredentials,
  getStoredCredentials,
  clearCredentials,
} from '../src/config.js';

describe('Pactum CLI Config & Credentials Store', () => {
  const originalEnv = process.env.PACTUM_CONFIG_DIR;
  let testConfigDir: string;

  beforeEach(() => {
    testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pactum-cli-test-'));
    process.env.PACTUM_CONFIG_DIR = testConfigDir;
  });

  afterEach(() => {
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
    if (originalEnv !== undefined) {
      process.env.PACTUM_CONFIG_DIR = originalEnv;
    } else {
      delete process.env.PACTUM_CONFIG_DIR;
    }
  });

  it('uses custom PACTUM_CONFIG_DIR when provided', () => {
    expect(getConfigDir()).toBe(testConfigDir);
    expect(getConfigFilePath()).toBe(path.join(testConfigDir, 'config.json'));
  });

  it('saves and loads configuration safely', () => {
    saveConfig({ activeAddress: 'GB4UFB7S4CZ6YJ4G77HHZX4C3R7L64UK7Q' });
    const loaded = loadConfig();
    expect(loaded.activeAddress).toBe('GB4UFB7S4CZ6YJ4G77HHZX4C3R7L64UK7Q');
    expect(loaded.updatedAt).toBeDefined();
  });

  it('saves secret key and derives public address', () => {
    const keypair = Keypair.random();
    const secret = keypair.secret();
    const pub = keypair.publicKey();

    const saved = saveCredentials(secret, 'testnet');
    expect(saved.address).toBe(pub);
    expect(saved.network).toBe('testnet');

    const creds = getStoredCredentials();
    expect(creds.address).toBe(pub);
    expect(creds.secretKey).toBe(secret);
    expect(creds.network).toBe('testnet');

    // Check file mode on POSIX systems
    const stats = fs.statSync(getConfigFilePath());
    if (process.platform !== 'win32') {
      // 0o600 is 33152 or matches mode & 0o777 === 0o600
      expect(stats.mode & 0o777).toBe(0o600);
    }
  });

  it('clears stored credentials', () => {
    const keypair = Keypair.random();
    saveCredentials(keypair.secret());
    expect(fs.existsSync(getConfigFilePath())).toBe(true);

    const cleared = clearCredentials();
    expect(cleared).toBe(true);
    expect(fs.existsSync(getConfigFilePath())).toBe(false);

    const creds = getStoredCredentials();
    expect(creds.address).toBeUndefined();
    expect(creds.secretKey).toBeUndefined();
  });
});
