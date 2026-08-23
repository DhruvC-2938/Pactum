import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { StrKey } from '@stellar/stellar-sdk';
import { getStoredCredentials } from '../config.js';

export interface CommitmentRecord {
  id: number | string;
  issuer?: string;
  counterparty?: string;
  party_a?: string;
  party_b?: string;
  status: string;
  due_at?: number | string;
  dueAt?: number | string;
  encrypted?: boolean;
  terms_hash?: string;
}

export function formatStatus(status: string): string {
  const s = status.toLowerCase();
  switch (s) {
    case 'fulfilled':
      return chalk.green('Fulfilled');
    case 'pending':
      return chalk.yellow('Pending');
    case 'late':
      return chalk.yellowBright('Late');
    case 'breached':
      return chalk.red('Breached');
    case 'disputed':
      return chalk.magenta('Disputed');
    default:
      return chalk.white(status);
  }
}

export function truncateAddress(addr: string | undefined): string {
  if (!addr) return '—';
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function formatDueDate(dueAt: number | string | undefined | null): string {
  if (dueAt == null) return '—';
  const num = typeof dueAt === 'string' ? Number(dueAt) : dueAt;
  if (isNaN(num)) return String(dueAt);
  const ms = num > 1e11 ? num : num * 1000;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return String(dueAt);
  return d.toISOString().replace('T', ' ').slice(0, 16);
}

export function createCommitmentsCommand(): Command {
  const commCmd = new Command('commitments')
    .description('List and inspect commitments on the Pactum Trust Layer');

  commCmd
    .command('list')
    .description('Prints a formatted ASCII table of recent commitments for an address')
    .argument('[address]', 'Stellar public address to list commitments for (defaults to authenticated account)')
    .option('-s, --status <status>', 'Filter by commitment status (Pending, Fulfilled, Late, Breached, Disputed)')
    .option('-l, --limit <number>', 'Maximum number of commitments to display', '20')
    .option('--api-url <url>', 'Pactum backend API URL', process.env.PACTUM_API_URL || 'http://localhost:3000')
    .option('--json', 'Output results as raw JSON')
    .action(async (targetAddress: string | undefined, options: {
      status?: string;
      limit: string;
      apiUrl: string;
      json?: boolean;
    }) => {
      let address = targetAddress?.trim();

      // If no address provided, fallback to active authenticated account
      if (!address) {
        const creds = getStoredCredentials();
        if (creds.address) {
          address = creds.address;
        } else {
          const errorMsg = 'No address specified and no authenticated account found. Provide an address: `pactum commitments list <address>`';
          if (options.json) {
            console.error(JSON.stringify({ error: errorMsg }, null, 2));
            process.exitCode = 1;
            return;
          }
          console.error(chalk.red(`\n✖ Error: ${errorMsg}\n`));
          process.exitCode = 1;
          return;
        }
      }

      // Address validation
      if (!StrKey.isValidEd25519PublicKey(address)) {
        const errorMsg = `Invalid Stellar public key: "${address}". Must be a valid 56-character G... address.`;
        if (options.json) {
          console.error(JSON.stringify({ error: errorMsg }, null, 2));
          process.exitCode = 1;
          return;
        }
        console.error(chalk.red(`\n✖ Error: ${errorMsg}\n`));
        process.exitCode = 1;
        return;
      }

      const parsedLimit = Number(options.limit);
      if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
        const errorMsg = `Invalid limit: "${options.limit}". Limit must be a positive integer.`;
        if (options.json) {
          console.error(JSON.stringify({ error: errorMsg }, null, 2));
          process.exitCode = 1;
          return;
        }
        console.error(chalk.red(`\n✖ Error: ${errorMsg}\n`));
        process.exitCode = 1;
        return;
      }
      const limit = parsedLimit;

      try {
        const apiBase = options.apiUrl.replace(/\/$/, '');
        // Query commitments from backend API
        const params = new URLSearchParams();
        params.set('limit', String(limit * 2));
        if (options.status) {
          params.set('status', options.status);
        }

        const url = `${apiBase}/commitments?${params.toString()}`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`API returned HTTP ${res.status} (${res.statusText}) for endpoint ${url}`);
        }
        const json = (await res.json()) as any;
        const items: CommitmentRecord[] = Array.isArray(json) ? json : json.items || json.data || [];

        // Filter for the address
        const filtered = items.filter((c) => {
          const iss = (c.issuer || c.party_a || '').toUpperCase();
          const cp = (c.counterparty || c.party_b || '').toUpperCase();
          const target = address!.toUpperCase();
          return iss === target || cp === target;
        });

        const displayItems = filtered.slice(0, limit);

        if (options.json) {
          console.log(JSON.stringify({ address, count: displayItems.length, commitments: displayItems }, null, 2));
          return;
        }

        if (displayItems.length === 0) {
          console.log(chalk.bold.cyan(`\n  Commitments for ${chalk.white(truncateAddress(address))}\n`));
          console.log(chalk.yellow('  No commitments found for this address.'));
          console.log(chalk.dim(`  Query endpoint: ${url}\n`));
          return;
        }

        console.log(chalk.bold.cyan(`\n  Pactum Commitments — ${chalk.white(truncateAddress(address))} (${displayItems.length} found)\n`));

        // Create ASCII table with custom styling
        const table = new Table({
          head: [
            chalk.cyan.bold('ID'),
            chalk.cyan.bold('Issuer'),
            chalk.cyan.bold('Counterparty'),
            chalk.cyan.bold('Status'),
            chalk.cyan.bold('Due Date (UTC)'),
            chalk.cyan.bold('Encrypted'),
          ],
          colWidths: [8, 16, 16, 14, 20, 12],
          style: {
            head: [],
            border: ['gray'],
          },
        });

        for (const item of displayItems) {
          const id = `#${item.id}`;
          const issuer = truncateAddress(item.issuer || item.party_a);
          const counterparty = truncateAddress(item.counterparty || item.party_b);
          const status = formatStatus(item.status);
          const due = formatDueDate(item.due_at || item.dueAt);
          const encrypted = item.encrypted ? chalk.magenta('🔒 Yes') : chalk.gray('No');

          table.push([id, issuer, counterparty, status, due, encrypted]);
        }

        console.log(table.toString());
        console.log('');
      } catch (error: any) {
        const msg = error?.message || String(error);
        if (options.json) {
          console.error(JSON.stringify({ error: msg }, null, 2));
          process.exitCode = 1;
          return;
        }
        console.error(chalk.red(`\n✖ Failed to list commitments: ${msg}\n`));
        process.exitCode = 1;
      }
    });

  return commCmd;
}
