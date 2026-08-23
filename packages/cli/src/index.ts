import { Command } from 'commander';
import { createAuthCommand } from './commands/auth.js';
import { createReputationCommand } from './commands/reputation.js';
import { createCommitmentsCommand } from './commands/commitments.js';

export function createCli(): Command {
  const program = new Command();

  program
    .name('pactum')
    .description('Pactum Trust Layer CLI — Developer and Power User Terminal Tool')
    .version('0.1.0');

  // Register subcommands
  program.addCommand(createAuthCommand());
  program.addCommand(createReputationCommand());
  program.addCommand(createCommitmentsCommand());

  return program;
}

// Entrypoint execution
const program = createCli();
program.parse(process.argv);
