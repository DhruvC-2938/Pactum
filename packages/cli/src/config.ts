import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Keypair } from '@stellar/stellar-sdk';

export interface PactumConfig {
  activeAddress?: string;
  secretKey?: string;
  defaultNetwork?: string;
  apiUrl?: string;
  updatedAt?: string;
}

/**
 * Returns the base configuration directory for Pactum CLI.
 * Defaults to `~/.pactum` or the path specified in `PACTUM_CONFIG_DIR`.
 */
export function getConfigDir(): string {
  if (process.env.PACTUM_CONFIG_DIR) {
    return path.resolve(process.env.PACTUM_CONFIG_DIR);
  }
  return path.join(os.homedir(), '.pactum');
}

/**
 * Returns the full path to the credentials/config file.
 */
export function getConfigFilePath(): string {
  return path.join(getConfigDir(), 'config.json');
}

/**
 * Ensures the configuration directory exists with restrictive permissions (0700).
 */
export function ensureConfigDir(): string {
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } else {
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      // Ignored if file system doesn't support chmod (e.g. Windows)
    }
  }
  return dir;
}

/**
 * Loads the stored Pactum CLI configuration.
 */
export function loadConfig(): PactumConfig {
  const filePath = getConfigFilePath();
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as PactumConfig;
  } catch (error) {
    return {};
  }
}

/**
 * Persists configuration securely to disk with 0600 permissions.
 */
export function saveConfig(config: PactumConfig): void {
  ensureConfigDir();
  const filePath = getConfigFilePath();
  const data = JSON.stringify(
    {
      ...config,
      updatedAt: new Date().toISOString(),
    },
    null,
    2,
  );

  // Write file with strict owner-only read/write permissions (0600)
  fs.writeFileSync(filePath, data, { mode: 0o600, encoding: 'utf8' });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Ignored on non-POSIX systems
  }
}

/**
 * Stores a Stellar secret key and derives its active public address.
 */
export function saveCredentials(
  secretKey: string,
  network: string = 'testnet',
): { address: string; network: string; path: string } {
  // Validate secret key format using Stellar SDK Keypair
  const keypair = Keypair.fromSecret(secretKey.trim());
  const address = keypair.publicKey();

  const current = loadConfig();
  const updated: PactumConfig = {
    ...current,
    activeAddress: address,
    secretKey: secretKey.trim(),
    defaultNetwork: network,
  };

  saveConfig(updated);
  return {
    address,
    network,
    path: getConfigFilePath(),
  };
}

/**
 * Retrieves the currently active credentials from the secure local config.
 */
export function getStoredCredentials(): {
  secretKey?: string;
  address?: string;
  network?: string;
} {
  const config = loadConfig();
  return {
    secretKey: config.secretKey,
    address: config.activeAddress,
    network: config.defaultNetwork,
  };
}

/**
 * Clears stored credentials from disk.
 */
export function clearCredentials(): boolean {
  const filePath = getConfigFilePath();
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
