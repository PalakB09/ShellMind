import chalk from 'chalk';
import { runPipeline, saveLastPlan } from '../planner/index.js';
import { loadCommand, listCommands, fuzzyMatchCommand, deleteCommand, commandExists } from '../memory/index.js';
import { getBuiltInWorkflow } from '../memory/defaults.js';
import { executeSavedWorkflow } from '../cli/workflows.js';
import { startChat } from '../cli/chat.js';
import { runInit } from '../cli/init.js';

const VERSION = '1.0.0';
const SUBCOMMANDS = new Set(['chat', 'save', 'run', 'list', 'delete', 'setup', 'init', 'help']);

function printHelp() {
  console.log(`Usage: ai [options] [instruction...]

AI-powered CLI assistant - workflow engine first, AI assistant second

Options:
  -v, --version       Output the version number
  --dry-run           Show plan without executing
  --auto              Auto-execute safe plans
  -h, --help          Display help

Commands:
  init                Configure AI provider and model (run this first)
  chat                Start an interactive AI chat session
  save <name>         Save the last plan as a workflow
  run <name>          Run a saved workflow
  list                List saved workflows
  delete <name>       Delete a saved workflow
  setup               Built-in setup assistant
`);
}

export function parseArgv(argv) {
  const options = {
    dryRun: false,
    autoExecute: false,
    repo: false,
    global: false,
    help: false,
    version: false,
  };
  const words = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--auto') options.autoExecute = true;
    else if (arg === '--repo') options.repo = true;
    else if (arg === '--global') options.global = true;
    else if (arg === '-h' || arg === '--help') options.help = true;
    else if (arg === '-v' || arg === '--version') options.version = true;
    else words.push(arg);
  }

  return {
    input: words.join(' ').trim(),
    words,
    options,
  };
}

function planOptions(options) {
  return {
    dryRun: options.dryRun,
    autoExecute: options.autoExecute,
  };
}

async function listSavedCommands() {
  const { local, global } = listCommands();
  const localNames = Object.keys(local);
  const globalNames = Object.keys(global);

  if (localNames.length === 0 && globalNames.length === 0) {
    console.log(chalk.yellow('\nNo saved commands found.\n'));
    console.log(chalk.dim('Use "ai save <name>" after running a plan to save it.\n'));
    return;
  }

  console.log(chalk.bold.cyan('\nSaved Commands:\n'));

  if (localNames.length > 0) {
    console.log(chalk.bold('  Repo:'));
    for (const name of localNames) {
      const entry = local[name];
      console.log(`    - ${chalk.bold(name)} - ${entry.description || '(no description)'}`);
      for (const c of entry.commands || []) console.log(chalk.dim(`      $ ${c}`));
    }
    console.log();
  }

  if (globalNames.length > 0) {
    console.log(chalk.bold('  Global:'));
    for (const name of globalNames) {
      const entry = global[name];
      console.log(`    - ${chalk.bold(name)} - ${entry.description || '(no description)'}`);
      for (const c of entry.commands || []) console.log(chalk.dim(`      $ ${c}`));
    }
    console.log();
  }
}

async function deleteSavedCommand(name, options) {
  if (!name) {
    console.log(chalk.yellow('\nUsage: ai delete <name> [--repo|--global]\n'));
    return;
  }
  const scope = options.repo ? 'local' : 'global';
  const deleted = deleteCommand(name, scope);
  if (deleted) console.log(chalk.green(`\nDeleted "${name}" from ${scope === 'local' ? 'repo' : 'global'} workflows.\n`));
  else console.log(chalk.yellow(`\nCommand "${name}" not found in ${scope === 'local' ? 'repo' : 'global'} workflows.\n`));
}

async function runNamedWorkflow(name, options) {
  if (!name) {
    console.log(chalk.yellow('\nUsage: ai run <name>\n'));
    return;
  }

  let entry = loadCommand(name);
  if (!entry) {
    const fuzzyResults = fuzzyMatchCommand(name);
    if (fuzzyResults.length > 0) {
      console.log(chalk.yellow(`\nNo exact match for "${name}". Did you mean:\n`));
      for (const r of fuzzyResults) {
        console.log(`  - ${r.name} - ${r.entry.description || '(no description)'} [${r.scope}]`);
      }
      console.log(chalk.dim('\nRun the exact workflow name to execute it.\n'));
    } else {
      console.log(chalk.red(`\nCommand "${name}" not found.\n`));
      console.log(chalk.dim('Use "ai list" to see saved workflows, or run a plan and "ai save <name>".\n'));
    }
    return;
  }

  await executeSavedWorkflow(name, entry, planOptions(options));
}

async function runSubcommand(words, options) {
  const [cmd, ...rest] = words;

  if (cmd === 'help') {
    printHelp();
    return;
  }

  if (cmd === 'init') {
    await runInit();
    return;
  }

  if (cmd === 'chat') {
    await startChat(planOptions(options));
    return;
  }

  if (cmd === 'save') {
    let targetScope = null;
    if (options.repo) targetScope = 'local';
    else if (options.global) targetScope = 'global';

    await saveLastPlan(rest[0], {
      scope: targetScope,
      requireExistingRepoFile: options.repo,
    });
    return;
  }

  if (cmd === 'run') {
    await runNamedWorkflow(rest.join(' '), options);
    return;
  }

  if (cmd === 'list') {
    await listSavedCommands();
    return;
  }

  if (cmd === 'delete') {
    await deleteSavedCommand(rest.join(' '), options);
    return;
  }

  if (cmd === 'setup') {
    await runPipeline(`Analyze this project directory and create a setup plan:
1. Detect what type of project this is.
2. Install dependencies using the local package manager.
3. Report required environment files and setup steps.`, planOptions(options));
  }
}

function isExactSubcommand(words) {
  if (words.length === 0) return false;
  const [cmd, ...rest] = words;
  if (!SUBCOMMANDS.has(cmd)) return false;
  if (cmd === 'list' || cmd === 'chat' || cmd === 'setup' || cmd === 'init' || cmd === 'help') return rest.length === 0;
  if (cmd === 'save' || cmd === 'run' || cmd === 'delete') return true;
  return false;
}

export async function handleInput(argv) {
  const { input, words, options } = parseArgv(argv);

  if (options.version) {
    console.log(VERSION);
    return;
  }

  if (options.help || !input) {
    printHelp();
    return;
  }

  const workflow = loadCommand(input);
  if (workflow) {
    await executeSavedWorkflow(input, workflow, planOptions(options));
    return;
  }

  const builtIn = getBuiltInWorkflow(input);
  if (builtIn) {
    await runPipeline(input, planOptions(options));
    return;
  }

  if (isExactSubcommand(words)) {
    await runSubcommand(words, options);
    return;
  }

  if (words[0] && SUBCOMMANDS.has(words[0]) && words.length > 1 && commandExists(words.slice(1).join(' '))) {
    await runNamedWorkflow(words.slice(1).join(' '), options);
    return;
  }

  await runPipeline(input, planOptions(options));
}
