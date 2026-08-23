import { Command } from 'commander';
import chalk from 'chalk';
import { StrKey } from '@stellar/stellar-sdk';
import {
  saveCredentials,
  getStoredCredentials,
  clearCredentials,
  getConfigFilePath,
} from '../config.js';

export function createAuthCommand(): Command {
  const authCmd = new Command('auth')
    .description('Authenticate and store your Stellar secret key locally in a secure keychain/config')
    .argument('[secret_key]', 'Stellar secret key (starts with S, 56 characters)')
    .option('-n, --network <network>', 'Default network to associate with credentials', 'testnet')
    .option('--status', 'Display current authentication status and active public address')
    .option('--clear', 'Clear stored credentials from local config')
    .option('--json', 'Output results in JSON format')
    .action(async (secretKey: string | undefined, options: { network: string; status?: boolean; clear?: boolean; json?: boolean }) => {
      // Option: Clear credentials
      if (options.clear) {
        const cleared = clearCredentials();
        if (options.json) {
          console.log(JSON.stringify({ success: cleared, message: cleared ? 'Credentials cleared' : 'No credentials found' }, null, 2));
          return;
        }
        if (cleared) {
          console.log(chalk.green('✔ Stored credentials cleared successfully.'));
        } else {
          console.log(chalk.yellow('No stored credentials were found.'));
        }
        return;
      }

      // Option: Check auth status
      if (options.status || !secretKey) {
        const creds = getStoredCredentials();
        if (options.json) {
          console.log(
            JSON.stringify(
              {
                authenticated: Boolean(creds.address),
                address: creds.address ?? null,
                network: creds.network ?? null,
                configPath: getConfigFilePath(),
              },
              null,
              2,
            ),
          );
          return;
        }

        if (creds.address) {
          console.log(chalk.bold.cyan('\n  Pactum CLI — Authentication Status\n'));
          console.log(`  ${chalk.gray('Status:')}       ${chalk.green('Authenticated')}`);
          console.log(`  ${chalk.gray('Address:')}      ${chalk.bold.white(creds.address)}`);
          console.log(`  ${chalk.gray('Network:')}      ${chalk.magenta(creds.network || 'testnet')}`);
          console.log(`  ${chalk.gray('Config:')}       ${chalk.dim(getConfigFilePath())}\n`);
        } else {
          console.log(chalk.yellow('\n  No active credentials found.'));
          console.log(chalk.dim('  Run `pactum auth <secret_key>` to store your credentials.\n'));
        }
        return;
      }

      // Validation: Stellar secret key format
      const trimmed = secretKey.trim();
      if (!trimmed.startsWith('S') || trimmed.length !== 56 || !StrKey.isValidEd25519SecretSeed(trimmed)) {
        const errorMsg = 'Invalid Stellar secret key. Must be a valid 56-character Ed25519 seed starting with "S".';
        if (options.json) {
          console.error(JSON.stringify({ error: errorMsg }, null, 2));
          process.exitCode = 1;
          return;
        }
        console.error(chalk.red(`\n✖ Error: ${errorMsg}\n`));
        process.exitCode = 1;
        return;
      }

      try {
        const saved = saveCredentials(trimmed, options.network);
        const masked = `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                success: true,
                address: saved.address,
                network: saved.network,
                maskedSecret: masked,
                configPath: saved.path,
              },
              null,
              2,
            ),
          );
          return;
        }

        console.log(chalk.bold.green('\n✔ Key stored successfully in secure local config!\n'));
        console.log(`  ${chalk.gray('Public Address:')}  ${chalk.bold.white(saved.address)}`);
        console.log(`  ${chalk.gray('Secret Key:')}      ${chalk.dim(masked)}`);
        console.log(`  ${chalk.gray('Default Network:')} ${chalk.magenta(saved.network)}`);
        console.log(`  ${chalk.gray('Config Location:')} ${chalk.dim(saved.path)}`);
        console.log(chalk.dim(`  Permissions:      0600 (owner read/write only)\n`));
      } catch (error: any) {
        if (options.json) {
          console.error(JSON.stringify({ error: error?.message || 'Failed to save credentials' }, null, 2));
          process.exitCode = 1;
          return;
        }
        console.error(chalk.red(`\n✖ Failed to save credentials: ${error?.message || error}\n`));
        process.exitCode = 1;
      }
    });

  return authCmd;
}
