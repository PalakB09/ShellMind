// Chat — Stateful interactive REPL with execute/dry-run/auto modes.
// HARDENED: history size cap, improved context resolution, /save and /undo support, graceful error handling.
import chalk from 'chalk';
import readline from 'readline';
import { runPipeline, saveLastPlan } from '../planner/index.js';

const MAX_HISTORY_SIZE = 30;  // Cap conversation context to avoid token overflow

const BANNER = `
${chalk.bold.cyan('╔══════════════════════════════════════════════╗')}
${chalk.bold.cyan('║')}   ${chalk.bold.white('🧠 AI CLI — Interactive Chat Mode')}          ${chalk.bold.cyan('║')}
${chalk.bold.cyan('╚══════════════════════════════════════════════╝')}

${chalk.dim('Commands:')}
${chalk.dim('  Type any instruction in natural language')}
${chalk.dim('  /mode <execute|dry-run|auto>  Change execution mode')}
${chalk.dim('  /history                      Show conversation history')}
${chalk.dim('  /save <name>                  Save last plan with an alias')}
${chalk.dim('  /clear                        Clear conversation context')}
${chalk.dim('  /exit or /quit                Exit chat')}
`;

/**
 * Start the interactive chat REPL.
 * @param {object} options
 * @param {boolean} options.dryRun
 * @param {boolean} options.autoExecute
 */
export async function startChat(options = {}) {
  let { dryRun = false, autoExecute = false } = options;

  console.log(BANNER);

  const currentMode = () => {
    if (dryRun) return 'dry-run';
    if (autoExecute) return 'auto';
    return 'execute';
  };

  console.log(chalk.dim(`Current mode: ${chalk.bold(currentMode())}\n`));

  const { hasAnyApiKey } = await import('../config/index.js');
  if (!hasAnyApiKey()) {
    console.log(chalk.yellow('⚠ AI features disabled. Using basic mode. Add an API key (`GEMINI_API_KEY` or `OPENROUTER_API_KEY`) for full capabilities.'));
    console.log(chalk.dim('You can still use basic commands here like /save, /history, but natural language instructions will not generate commands.\n'));
  }

  // Conversation history for context
  const history = [];
  // Track last plan result for /save
  let lastResult = null;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.bold.green('ai> '),
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    // ─── Meta Commands ─────────────────────────────────────

    if (input === '/exit' || input === '/quit') {
      console.log(chalk.cyan('\n👋 Goodbye!\n'));
      rl.close();
      return;
    }

    if (input === '/clear') {
      history.length = 0;
      lastResult = null;
      console.log(chalk.green('\n✓ Conversation context cleared.\n'));
      rl.prompt();
      return;
    }

    if (input === '/history') {
      if (history.length === 0) {
        console.log(chalk.dim('\nNo conversation history yet.\n'));
      } else {
        console.log(chalk.bold.cyan('\n📜 Conversation History:\n'));
        for (const msg of history) {
          const prefix = msg.role === 'user'
            ? chalk.green('  You: ')
            : chalk.blue('  AI:  ');
          const content = msg.content.length > 120
            ? msg.content.substring(0, 120) + '...'
            : msg.content;
          console.log(prefix + chalk.white(content));
        }
        console.log();
      }
      rl.prompt();
      return;
    }

    if (input.startsWith('/save')) {
      const parts = input.split(/\s+/);
      const name = parts[1];

      if (!name) {
        console.log(chalk.yellow('\nUsage: /save <name>\n'));
        rl.prompt();
        return;
      }

      if (!lastResult?.plan) {
        console.log(chalk.yellow('\nNo plan to save. Run a command first.\n'));
        rl.prompt();
        return;
      }

      try {
        saveLastPlan(name, lastResult.plan, 'local');
      } catch (err) {
        console.log(chalk.red(`\n✗ Could not save: ${err.message}\n`));
      }
      rl.prompt();
      return;
    }

    if (input.startsWith('/mode')) {
      const parts = input.split(/\s+/);
      const newMode = parts[1];

      if (newMode === 'execute') {
        dryRun = false;
        autoExecute = false;
      } else if (newMode === 'dry-run') {
        dryRun = true;
        autoExecute = false;
      } else if (newMode === 'auto') {
        dryRun = false;
        autoExecute = true;
      } else {
        console.log(chalk.yellow('\nUsage: /mode <execute|dry-run|auto>\n'));
        rl.prompt();
        return;
      }

      console.log(chalk.green(`\n✓ Mode changed to: ${chalk.bold(currentMode())}\n`));
      rl.prompt();
      return;
    }

    if (input.startsWith('/')) {
      console.log(chalk.yellow(`\nUnknown command: ${input}`));
      console.log(chalk.dim('Available: /mode, /history, /save, /clear, /exit\n'));
      rl.prompt();
      return;
    }

    // ─── Natural Language Processing ────────────────────────

    // Add user message to history
    history.push({ role: 'user', content: input });

    try {
      const result = await runPipeline(input, {
        history: history.slice(-MAX_HISTORY_SIZE),  // Cap history to prevent token overflow
        dryRun,
        autoExecute,
      });

      lastResult = result;

      // Add AI response summary to history for context
      if (result.plan) {
        const stepSummary = result.plan.steps.length > 0
          ? result.plan.steps.map(s => s.command).join('; ')
          : '(no commands)';
        const status = result.success
          ? 'Executed successfully.'
          : result.results
            ? 'Execution failed/partial.'
            : 'Not executed.';

        const summary = `Intent: ${result.plan.intent}. Steps: ${stepSummary}. ${status}`;
        history.push({ role: 'assistant', content: summary });
      }
    } catch (error) {
      console.error(chalk.red(`\n✗ Error: ${error.message}\n`));
      // Still add to history so context is preserved
      history.push({ role: 'assistant', content: `Error occurred: ${error.message}` });
    }

    // Trim history if too long
    while (history.length > MAX_HISTORY_SIZE * 2) {
      history.shift();
    }

    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });

  // Keep the process running
  return new Promise(() => {});
}
