// CLI — Commander setup with all subcommands and the main NL handler.
import { Command } from 'commander';
import chalk from 'chalk';
import { runPipeline, saveLastPlan } from '../planner/index.js';
import { loadCommand, listCommands, fuzzyMatchCommand, saveCommand, deleteCommand } from '../memory/index.js';
import { executePlan } from '../executor/index.js';
import { analyzePlan, displayPlan, promptConfirmation } from '../safety/index.js';
import { startChat } from './chat.js';

const VERSION = '1.0.0';

/**
 * Create and configure the CLI program.
 */
export function createCLI() {
  const program = new Command();

  program
    .name('ai')
    .description(chalk.bold('🧠 AI-powered CLI assistant — control your terminal with natural language'))
    .version(VERSION, '-v, --version');

  // ─── Default: Natural Language Command ────────────────────

  // This catches `ai <anything that isn't a subcommand>`
  program
    .argument('[instruction...]', 'Natural language instruction')
    .option('--dry-run', 'Show plan without executing')
    .option('--auto', 'Auto-execute (still confirms dangerous commands)')
    .action(async (instructionWords, opts) => {
      if (instructionWords.length === 0) {
        program.help();
        return;
      }

      const instruction = instructionWords.join(' ');
      await runPipeline(instruction, {
        dryRun: opts.dryRun || false,
        autoExecute: opts.auto || false,
      });
    });

  // ─── Chat REPL ────────────────────────────────────────────

  program
    .command('chat')
    .description('Start an interactive AI chat session')
    .option('--dry-run', 'Preview-only mode')
    .option('--auto', 'Auto-execute mode')
    .action(async (opts) => {
      await startChat({
        dryRun: opts.dryRun || false,
        autoExecute: opts.auto || false,
      });
    });

  // ─── Save Command ────────────────────────────────────────

  program
    .command('save <name>')
    .description('Save the last command plan with an alias')
    .option('-g, --global', 'Save to global scope')
    .option('-d, --description <desc>', 'Description for the saved command')
    .action(async (name, opts) => {
      // For save, we allow the user to specify commands interactively
      console.log(chalk.cyan(`\n📝 Saving command "${name}"...`));
      console.log(chalk.dim('Enter the shell commands (one per line). Type an empty line when done:\n'));

      const commands = [];
      const readline = await import('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

      const askLine = () => new Promise((resolve) => {
        rl.question(chalk.dim('  > '), (line) => resolve(line));
      });

      let line = await askLine();
      while (line.trim() !== '') {
        commands.push(line.trim());
        line = await askLine();
      }
      rl.close();

      if (commands.length === 0) {
        console.log(chalk.yellow('No commands entered. Nothing saved.'));
        return;
      }

      const scope = opts.global ? 'global' : 'local';
      saveCommand(name, {
        commands,
        description: opts.description || `Saved command: ${name}`,
        steps: commands.map(c => ({ command: c, description: c })),
      }, scope);

      console.log(chalk.green(`\n✓ Saved "${name}" with ${commands.length} command(s) (${scope} scope)\n`));
    });

  // ─── Run Saved Command ────────────────────────────────────

  program
    .command('run <name>')
    .description('Run a previously saved command')
    .action(async (name) => {
      let entry = loadCommand(name);

      // Try fuzzy match if exact not found
      if (!entry) {
        const fuzzyResults = fuzzyMatchCommand(name);
        if (fuzzyResults.length > 0) {
          console.log(chalk.yellow(`\n⚠ No exact match for "${name}". Did you mean:\n`));
          fuzzyResults.forEach((r, i) => {
            console.log(chalk.white(`  ${i + 1}. ${chalk.bold(r.name)} — ${r.entry.description || '(no description)'} [${r.scope}]`));
          });

          const readline = await import('readline');
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          const answer = await new Promise((resolve) => {
            rl.question(chalk.cyan('\nSelect (number) or press Enter to cancel: '), resolve);
          });
          rl.close();

          const idx = parseInt(answer) - 1;
          if (idx >= 0 && idx < fuzzyResults.length) {
            entry = { ...fuzzyResults[idx].entry, scope: fuzzyResults[idx].scope };
          } else {
            console.log(chalk.yellow('Cancelled.'));
            return;
          }
        } else {
          console.log(chalk.red(`\n✗ Command "${name}" not found.\n`));
          console.log(chalk.dim('Use "ai list" to see saved commands, or "ai save <name>" to create one.\n'));
          return;
        }
      }

      console.log(chalk.bold.magenta(`\n🎯 Running saved command: `) + chalk.white(entry.description || name));

      const steps = entry.steps || entry.commands.map(c => ({ command: c, description: c }));
      const safetyResult = analyzePlan(steps);
      displayPlan(steps, safetyResult);

      const answer = await promptConfirmation(
        chalk.cyan('\n⚡ Execute?'),
        safetyResult.hasDangerousSteps
      );

      if (answer !== 'yes') {
        console.log(chalk.yellow('\n✋ Cancelled.\n'));
        return;
      }

      console.log(chalk.bold.green('\n🚀 Executing...\n'));
      await executePlan(steps);
    });

  // ─── List Saved Commands ──────────────────────────────────

  program
    .command('list')
    .description('List all saved commands')
    .action(() => {
      const { local, global } = listCommands();
      const localNames = Object.keys(local);
      const globalNames = Object.keys(global);

      if (localNames.length === 0 && globalNames.length === 0) {
        console.log(chalk.yellow('\n📭 No saved commands found.\n'));
        console.log(chalk.dim('Use "ai save <name>" to save a command.\n'));
        return;
      }

      console.log(chalk.bold.cyan('\n📋 Saved Commands:\n'));

      if (localNames.length > 0) {
        console.log(chalk.bold('  Local (this repo):'));
        for (const name of localNames) {
          const entry = local[name];
          console.log(chalk.white(`    ${chalk.green('●')} ${chalk.bold(name)} — ${entry.description || '(no description)'}`));
          if (entry.commands) {
            entry.commands.forEach(c => console.log(chalk.dim(`      $ ${c}`)));
          }
        }
        console.log();
      }

      if (globalNames.length > 0) {
        console.log(chalk.bold('  Global:'));
        for (const name of globalNames) {
          const entry = global[name];
          console.log(chalk.white(`    ${chalk.blue('●')} ${chalk.bold(name)} — ${entry.description || '(no description)'}`));
          if (entry.commands) {
            entry.commands.forEach(c => console.log(chalk.dim(`      $ ${c}`)));
          }
        }
        console.log();
      }
    });

  // ─── Delete Saved Command ─────────────────────────────────

  program
    .command('delete <name>')
    .description('Delete a saved command')
    .option('-g, --global', 'Delete from global scope')
    .action((name, opts) => {
      const scope = opts.global ? 'global' : 'local';
      const deleted = deleteCommand(name, scope);

      if (deleted) {
        console.log(chalk.green(`\n✓ Deleted "${name}" from ${scope} scope.\n`));
      } else {
        console.log(chalk.yellow(`\n⚠ Command "${name}" not found in ${scope} scope.\n`));
      }
    });

  // ─── Setup This Repo ──────────────────────────────────────

  program
    .command('setup')
    .description('Smart setup assistant — detect and install project dependencies')
    .action(async () => {
      const instruction = `Analyze this project directory and create a setup plan:
1. Detect what type of project this is (Node.js, Python, etc.)
2. Check for any dependency files (package.json, requirements.txt, etc.)
3. Generate commands to install all dependencies
4. Check for .env.example or similar files and note any required environment variables
5. Detect any additional setup steps needed (database migrations, build steps, etc.)

Provide a complete setup plan to get this project running from scratch.`;

      await runPipeline(instruction);
    });

  return program;
}
