// Safety Module — intent-based, two-tier system.
//
// Design principle: nothing is ever silently blocked.
// The user is always shown the command and always has the final say.
//
// Classification tiers:
//   dangerous — requires typing the full word "yes"
//   caution   — prompts y / n / edit
//   safe      — runs immediately
//
// What we do NOT do:
//   ✗ Hard-block anything (user types YES → it runs, period)
//   ✗ Check $() or backtick syntax blindly
//   ✗ Depend on bash/zsh/PowerShell-specific rules
//   ✗ Block normal developer commands

import chalk from 'chalk';
import readline from 'readline';

const MAX_COMMAND_LENGTH = 2000;

// ─── Intent Patterns ──────────────────────────────────────────────────────────
// Checked against raw user input BEFORE the AI generates commands.
// Only flags obviously catastrophic natural-language intent.

const INTENT_PATTERNS = [
  {
    pattern: /\b(delete|remove|wipe|erase)\s+(everything|all|the\s+project|this\s+repo|my\s+files|all\s+files)\b/i,
    reason: 'Broad destructive deletion request',
  },
  {
    pattern: /\bformat\s+(disk|drive|computer|machine|system)\b/i,
    reason: 'Disk formatting request',
  },
  {
    pattern: /\bdocker\s+(kill|stop|remove|rm)\s+(all|everything)\b/i,
    reason: 'Mass Docker container destruction',
  },
];

// ─── Dangerous Command Patterns ───────────────────────────────────────────────
// Matched against the full command string.
// Requires the user to explicitly type "yes" before running.
// Pattern matching works on the full string so it catches operations embedded
// in chains (e.g. "echo ok && rm -rf /") or subshells (e.g. "echo $(rm -rf /)").

const DANGEROUS_PATTERNS = [
  // rm on root / home / wildcard.
  // The end-of-token check ([^\w\/]|$) ensures "rm -rf /home" is NOT matched —
  // only "rm -rf /" (root) is. Local paths like "./dir" fall through to CAUTION.
  { pattern: /\brm\s+-[a-z]*r[a-z]*\s+\/([^\w\/]|$)/i,  reason: 'Recursive deletion from filesystem root' },
  { pattern: /\brm\s+-[a-z]*r[a-z]*\s+~([^\w]|$)/i,     reason: 'Recursive deletion of home directory' },
  { pattern: /\brm\s+-[a-z]*r[a-z]*\s+\*/i,             reason: 'Recursive deletion of all files (wildcard)' },
  { pattern: /\brmdir\s+\/s\b/i,                          reason: 'Recursive directory removal' },

  // Disk / filesystem destruction
  { pattern: /\bformat\s+([a-zA-Z]:|disk|drive)\b/i,     reason: 'Disk formatting' },
  { pattern: /\bmkfs\b/i,                                 reason: 'Filesystem creation / formatting' },
  { pattern: /\bdd\s+if=.*\bof=\/dev\//i,                reason: 'Low-level disk write' },
  { pattern: /:\(\)\{\s*:\|:\s*&\s*\};:/i,               reason: 'Fork bomb pattern' },

  // Remote code execution
  { pattern: /\b(curl|wget)\b.*\|\s*(bash|sh|zsh|fish|powershell|pwsh)\b/i, reason: 'Piping remote script directly to shell' },
  { pattern: /\b(Invoke-Expression|iex)\b/i,              reason: 'Executing arbitrary code via iex / Invoke-Expression' },
  { pattern: /\bpowershell\b.*(-EncodedCommand|-enc)\b/i, reason: 'Encoded PowerShell execution' },

  // Database / registry / system
  { pattern: /\bDROP\s+(TABLE|DATABASE)\b|\bTRUNCATE\b/i, reason: 'Destructive SQL operation' },
  { pattern: /\breg\s+delete\b/i,                          reason: 'Windows registry key deletion' },
  { pattern: /\b(shutdown|reboot|poweroff|Stop-Computer|Restart-Computer)\b/i, reason: 'System shutdown or restart' },

  // Git: only force push is dangerous — plain push is caution
  { pattern: /\bgit\s+push\b.*(--force|-f)\b/i,            reason: 'Force push rewrites remote history' },

  // Filesystem root permissions
  { pattern: /\bchmod\s+777\s+(\/|~|\$HOME)(\s|$)/i,       reason: 'World-writable permissions on root or home directory' },
];

// ─── Caution Command Patterns ─────────────────────────────────────────────────
// Matched against the full command string.
// Shows the command and asks y / n / edit.

const CAUTION_PATTERNS = [
  { pattern: /\bgit\s+push\b(?!.*(--force|-f)\b)/i,  reason: 'Pushing to remote' },
  { pattern: /\bgit\s+reset\s+--hard\b/i,            reason: 'Hard reset discards uncommitted changes' },
  { pattern: /\bgit\s+clean\s+-[a-z]*f/i,            reason: 'Force-cleaning untracked files' },
  { pattern: /\bgit\s+stash\s+drop\b/i,              reason: 'Dropping git stash permanently' },
  { pattern: /\bgit\s+branch\s+-[dD]\b/i,            reason: 'Deleting a git branch' },
  { pattern: /\brm\s+-[a-z]*r[a-z]*/i,              reason: 'Recursive file deletion' },
  { pattern: /\bchmod\b/i,                            reason: 'Changing file permissions' },
  { pattern: /\bchown\s+-R\b/i,                       reason: 'Recursive ownership change' },
  { pattern: /\bdocker\s+(rm|kill|stop)\b/i,         reason: 'Removing or stopping a Docker container' },
  { pattern: /\bdocker\s+system\s+prune\b/i,         reason: 'Pruning Docker system resources' },
  { pattern: /\bnpm\s+publish\b/i,                    reason: 'Publishing a package to npm' },
  { pattern: /\bSet-ExecutionPolicy\b/i,              reason: 'Changing PowerShell execution policy' },
  { pattern: /\bStop-Process\b.*-Force\b/i,           reason: 'Force-killing a process' },
];

// ─── Core Exports ─────────────────────────────────────────────────────────────

/**
 * Analyze the raw user intent string (natural language, before AI).
 * Only flags patterns that are obviously catastrophic.
 */
export function analyzeIntent(input) {
  const risks = [];
  if (!input || !input.trim()) return { classification: 'safe', risks };
  for (const entry of INTENT_PATTERNS) {
    if (entry.pattern.test(input)) {
      risks.push({ reason: entry.reason, tier: 'dangerous' });
    }
  }
  return { classification: risks.length > 0 ? 'dangerous' : 'safe', risks };
}

/**
 * Analyze a single shell command string.
 *
 * The full command string is checked as-is — no chain splitting, no subshell
 * extraction.  Dangerous patterns naturally match even when the dangerous
 * operation is embedded in a chain or $() because regex searches inside strings.
 *
 * Nothing is hard-blocked.  User can always proceed by typing "yes".
 */
export function analyzeCommand(command) {
  if (!command || typeof command !== 'string') {
    return { classification: 'dangerous', risks: [{ reason: 'Empty or invalid command', tier: 'dangerous' }] };
  }
  if (command.length > MAX_COMMAND_LENGTH) {
    return { classification: 'dangerous', risks: [{ reason: `Command exceeds ${MAX_COMMAND_LENGTH} character safety limit`, tier: 'dangerous' }] };
  }

  // 1. Check dangerous patterns first
  const risks = [];
  for (const entry of DANGEROUS_PATTERNS) {
    if (entry.pattern.test(command)) {
      risks.push({ reason: entry.reason, tier: 'dangerous' });
    }
  }
  if (risks.length > 0) {
    return { classification: 'dangerous', risks };
  }

  // 2. Check caution patterns
  for (const entry of CAUTION_PATTERNS) {
    if (entry.pattern.test(command)) {
      risks.push({ reason: entry.reason, tier: 'caution' });
    }
  }

  return {
    classification: risks.length > 0 ? 'caution' : 'safe',
    risks,
  };
}

/**
 * Analyze an array of plan steps.
 */
export function analyzePlan(steps) {
  const analysis = steps.map((step, i) => {
    const result = analyzeCommand(step.command);
    return { step: i + 1, command: step.command, ...result };
  });

  const hasDangerousSteps = analysis.some(a => a.classification === 'dangerous');
  const hasCautionSteps   = analysis.some(a => a.classification === 'caution');
  const overallClassification = hasDangerousSteps ? 'dangerous' : hasCautionSteps ? 'caution' : 'safe';

  return {
    overallClassification,
    hasBlockedSteps: false,   // blocking is removed — field kept for API compat
    hasDangerousSteps,
    hasCautionSteps,
    analysis,
  };
}

/**
 * Display the execution plan with safety markers.
 * Command is ALWAYS shown before execution — no silent running.
 */
export function displayPlan(steps, safetyAnalysis) {
  console.log();
  console.log(chalk.bold.cyan('Plan ready'));
  console.log(chalk.dim('---------------'));

  for (const item of safetyAnalysis.analysis) {
    let bullet = chalk.cyan('-');
    if (item.classification === 'dangerous') bullet = chalk.red('DANGER');
    else if (item.classification === 'caution') bullet = chalk.yellow('CAUTION');

    console.log(` ${bullet} ${chalk.white(item.command)}`);

    if (item.classification !== 'safe') {
      for (const risk of item.risks) {
        const color = risk.tier === 'dangerous' ? chalk.red : chalk.yellow;
        console.log(`   -> ${color(risk.reason)}`);
      }
    }
  }

  console.log(chalk.dim('---------------'));
}

/**
 * Prompt the user for confirmation before running.
 * Dangerous commands require typing the full word "yes".
 * Caution commands accept y / n / edit.
 */
export function promptConfirmation(message, isDangerous = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    const options = isDangerous
      ? `${chalk.red.bold('Dangerous command')} — type "yes" to confirm: `
      : `${chalk.yellow('Confirm')}: (y)es / (n)o / (e)dit: `;

    rl.question(`\n${message || ''}\n${options}`, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (isDangerous)             resolve(a === 'yes' ? 'yes' : 'no');
      else if (a === 'y' || a === 'yes') resolve('yes');
      else if (a === 'e' || a === 'edit') resolve('edit');
      else                         resolve('no');
    });
  });
}
