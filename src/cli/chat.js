// Chat — Stateful interactive REPL with execute/dry-run/auto modes.
// FIXED: actual command stdout/stderr is now injected into AI context after each execution.
import chalk from 'chalk';
import readline from 'readline';
import { runPipeline, saveLastPlan } from '../planner/index.js';
import { executeCommand } from '../executor/index.js';
import { recordExecution } from '../context/command-history.js';

const MAX_HISTORY_SIZE = 20; // Conversation turns (user + assistant pairs)
const MAX_OUTPUT_CHARS = 3000; // Cap stdout injected into context to avoid token overflow

// ─── Shell Command Detection ──────────────────────────────
// Detect if input looks like a direct shell command vs natural language.
// Direct commands are executed immediately without AI planning.
const SHELL_PREFIXES = [
  /^(git|npm|npx|node|python|pip|docker|cargo|go|make|curl|wget)\b/i,
  /^(ls|dir|cat|echo|mkdir|rmdir|pwd|cp|mv|rm|touch|chmod|chown|type)\b/i,
  /^(Get-|Set-|Remove-|Test-|New-|Start-|Stop-|Invoke-|Select-|Where-|ForEach-|Write-|Out-|Import-|Export-)/i,
  /^(grep|find|awk|sed|sort|head|tail|wc|diff|tar|zip|unzip|ssh|scp)\b/i,
  /^(dotnet|java|javac|mvn|gradle|ruby|gem|php|composer)\b/i,
];

function looksLikeShellCommand(input) {
  return SHELL_PREFIXES.some(p => p.test(input));
}

const BANNER = `
${chalk.bold.cyan('╔══════════════════════════════════════════════╗')}
${chalk.bold.cyan('║')}   ${chalk.bold.white('AI CLI — Interactive Chat Mode')}            ${chalk.bold.cyan('║')}
${chalk.bold.cyan('╚══════════════════════════════════════════════╝')}

${chalk.dim('Commands:')}
${chalk.dim('  Type any instruction in natural language')}
${chalk.dim('  /mode <execute|dry-run|auto>  Change execution mode')}
${chalk.dim('  /history                      Show conversation history')}
${chalk.dim('  /save <name>                  Save last plan as a workflow')}
${chalk.dim('  /clear                        Clear conversation context')}
${chalk.dim('  /exit or /quit                Exit chat')}
`;

export async function startChat(options = {}) {
  let { dryRun = false, autoExecute = false } = options;

  console.log(BANNER);

  const currentMode = () => {
    if (dryRun) return 'dry-run';
    if (autoExecute) return 'auto';
    return 'execute';
  };

  console.log(chalk.dim(`Current mode: ${chalk.bold(currentMode())}\n`));

  // Provider check: warn the user if no provider is configured at all.
  const { hasConfiguredProvider } = await import('../config/index.js');
  if (!hasConfiguredProvider()) {
    console.log(chalk.yellow('\u26a0 No AI provider configured. Run `ai init` to set up Ollama or Gemini.'));
    console.log(chalk.dim('  You can still use /save and /history.\n'));
  }

  const history = [];
  let lastResult = null;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.bold.green('ai> '),
  });

  rl.prompt();

  let processing = false;

  rl.on('line', async (line) => {
    if (processing) return;
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    // ─── Meta Commands ──────────────────────────────────────

    if (input === '/exit' || input === '/quit') {
      console.log(chalk.cyan('\nGoodbye!\n'));
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
        console.log(chalk.bold.cyan('\nConversation History:\n'));
        for (const msg of history) {
          const prefix = msg.role === 'user'
            ? chalk.green('  You: ')
            : chalk.blue('  AI:  ');
          const snippet = msg.content.length > 150
            ? msg.content.substring(0, 150) + '...'
            : msg.content;
          console.log(prefix + chalk.white(snippet));
        }
        console.log();
      }
      rl.prompt();
      return;
    }

    if (input.startsWith('/save')) {
      const name = input.split(/\s+/)[1];
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
        await saveLastPlan(name, { scope: 'local' });
      } catch (err) {
        console.log(chalk.red(`\n✗ Could not save: ${err.message}\n`));
      }
      rl.prompt();
      return;
    }

    if (input.startsWith('/mode')) {
      const newMode = input.split(/\s+/)[1];
      if (newMode === 'execute') { dryRun = false; autoExecute = false; }
      else if (newMode === 'dry-run') { dryRun = true; autoExecute = false; }
      else if (newMode === 'auto') { dryRun = false; autoExecute = true; }
      else {
        console.log(chalk.yellow('\nUsage: /mode <execute|dry-run|auto>\n'));
        rl.prompt();
        return;
      }
      console.log(chalk.green(`\n✓ Mode: ${chalk.bold(currentMode())}\n`));
      rl.prompt();
      return;
    }

    if (input.startsWith('/')) {
      console.log(chalk.yellow(`\nUnknown command: ${input}`));
      console.log(chalk.dim('Available: /mode, /history, /save, /clear, /exit\n'));
      rl.prompt();
      return;
    }

    // ─── Command Processing ───────────────────────────────────

    history.push({ role: 'user', content: input });

    try {
      processing = true;
      rl.pause(); // Suspend interface

      // ─── Direct Shell Commands ─────────────────────────────
      // If input looks like a shell command (git, npm, etc.), execute directly
      // without AI planning or confirmation — just like a regular terminal.
      if (looksLikeShellCommand(input)) {
        const result = await executeCommand(input);
        const step = { command: input, description: input };
        recordExecution({
          cwd: process.cwd(),
          instruction: input,
          steps: [step],
          results: [{ step: 1, command: input, ...result }],
        });

        lastResult = {
          success: result.success,
          results: [{ step: 1, command: input, ...result }],
          plan: { intent: input, steps: [step] },
        };

        let contextBlock = `Executed: ${input}\nStatus: ${result.success ? 'success' : 'failed'}`;
        if (result.stdout) contextBlock += `\n\nOutput:\n${result.stdout.substring(0, MAX_OUTPUT_CHARS)}`;
        if (result.stderr) contextBlock += `\n\nStderr:\n${result.stderr.substring(0, 800)}`;
        history.push({ role: 'assistant', content: contextBlock });

      } else {
        // ─── AI Pipeline ───────────────────────────────────────
        const result = await runPipeline(input, {
          history: history.slice(-MAX_HISTORY_SIZE),
          dryRun,
          autoExecute,
        });

        lastResult = result;

        // Inject real stdout/stderr into AI context for follow-up awareness
        if (result.plan) {
          const steps = result.plan.steps || [];
          const executedCommands = steps.map(s => s.command).join(' && ') || '(no commands)';
          const execResults = result.results || [];

          const allStdout = execResults
            .map(r => r.stdout || '')
            .filter(Boolean)
            .join('\n')
            .substring(0, MAX_OUTPUT_CHARS);

          const allStderr = execResults
            .map(r => r.stderr || '')
            .filter(Boolean)
            .join('\n')
            .substring(0, 800);

          const status = result.success ? 'success' : 'failed';

          let contextBlock = `Executed: ${executedCommands}\nStatus: ${status}`;
          if (allStdout) contextBlock += `\n\nOutput:\n${allStdout}`;
          if (allStderr) contextBlock += `\n\nStderr:\n${allStderr}`;

          history.push({ role: 'assistant', content: contextBlock });
        }
      }
    } catch (error) {
      console.error(chalk.red(`\n✗ Error: ${error.message}\n`));
      history.push({ role: 'assistant', content: `Error: ${error.message}` });
    } finally {
      processing = false;
      rl.resume();
      rl.prompt();
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });

  return new Promise(() => {});
}
