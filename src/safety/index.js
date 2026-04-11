// Safety Engine — three-tier command classification, expanded pattern list, tiered confirmation.
// HARDENED: safe/caution/dangerous tiers, expanded patterns, command length limit, injection detection.
import chalk from 'chalk';
import readline from 'readline';

// ─── Tier Classification ──────────────────────────────────
// Each pattern has a tier: 'caution' (needs y/n) or 'dangerous' (needs "yes" typed out)

const SAFETY_PATTERNS = [
  // ─── DANGEROUS (Tier 3): Irreversible, system-level, or data-destroying ───
  { pattern: /rm\s+(-[a-z]*f[a-z]*\s+|.*--force).*\//i, reason: 'Forced recursive file deletion', tier: 'dangerous' },
  { pattern: /rm\s+-[a-z]*r[a-z]*/i, reason: 'Recursive file deletion', tier: 'dangerous' },
  { pattern: /rm\s+~|rm\s+\/|rm\s+\$HOME/i, reason: 'Deleting home or root directory', tier: 'dangerous' },
  { pattern: /rmdir\s+\/s/i, reason: 'Recursive directory deletion (Windows)', tier: 'dangerous' },
  { pattern: /Remove-Item.*-Recurse/i, reason: 'Recursive deletion (PowerShell)', tier: 'dangerous' },
  { pattern: /Remove-Item\s+.*-Force/i, reason: 'Forced deletion (PowerShell)', tier: 'dangerous' },
  { pattern: /del\s+\/[sfq]/i, reason: 'Forced file deletion (Windows)', tier: 'dangerous' },
  { pattern: /format\s+[a-z]:/i, reason: 'Disk formatting', tier: 'dangerous' },
  { pattern: /mkfs\./i, reason: 'Filesystem formatting', tier: 'dangerous' },
  { pattern: /dd\s+if=/i, reason: 'Low-level disk write (dd)', tier: 'dangerous' },
  { pattern: /:\(\)\{\s*:\|:\s*&\s*\};:/i, reason: 'Fork bomb detected', tier: 'dangerous' },
  { pattern: />\s*\/dev\/sd[a-z]/i, reason: 'Writing directly to disk device', tier: 'dangerous' },
  { pattern: /git\s+reset\s+--hard/i, reason: 'Hard git reset — destroys uncommitted changes', tier: 'dangerous' },
  { pattern: /git\s+push\s+.*--force/i, reason: 'Force push — may overwrite remote history', tier: 'dangerous' },
  { pattern: /git\s+push\s+-f\b/i, reason: 'Force push (shorthand)', tier: 'dangerous' },
  { pattern: /git\s+rebase\s+.*--force/i, reason: 'Forced rebase — may rewrite history', tier: 'dangerous' },
  { pattern: /DROP\s+TABLE|DROP\s+DATABASE|TRUNCATE/i, reason: 'Destructive SQL operation', tier: 'dangerous' },
  { pattern: /curl.*\|\s*(bash|sh|zsh|powershell)/i, reason: 'Piping remote script to shell', tier: 'dangerous' },
  { pattern: /wget.*\|\s*(bash|sh|zsh)/i, reason: 'Piping remote script to shell', tier: 'dangerous' },
  { pattern: /Invoke-Expression.*\(.*Invoke-WebRequest/i, reason: 'Downloading and executing remote code (PowerShell)', tier: 'dangerous' },
  { pattern: /iex\s*\(.*iwr/i, reason: 'Downloading and executing remote code (PowerShell shorthand)', tier: 'dangerous' },
  { pattern: /shutdown|reboot|poweroff/i, reason: 'System shutdown/reboot', tier: 'dangerous' },
  { pattern: /Stop-Computer|Restart-Computer/i, reason: 'System shutdown/reboot (PowerShell)', tier: 'dangerous' },
  { pattern: /reg\s+delete/i, reason: 'Windows registry deletion', tier: 'dangerous' },
  { pattern: /Clear-EventLog/i, reason: 'Clearing Windows event logs', tier: 'dangerous' },

  // ─── CAUTION (Tier 2): Potentially risky but sometimes needed ───
  { pattern: /sudo\s+/i, reason: 'Elevated privilege command', tier: 'caution' },
  { pattern: /runas\s+/i, reason: 'Elevated privilege command (Windows)', tier: 'caution' },
  { pattern: /git\s+clean\s+-[a-z]*f/i, reason: 'Force clean untracked files', tier: 'caution' },
  { pattern: /git\s+stash\s+drop/i, reason: 'Dropping git stash', tier: 'caution' },
  { pattern: /git\s+branch\s+-[dD]/i, reason: 'Deleting a git branch', tier: 'caution' },
  { pattern: /chmod\s+777/i, reason: 'Setting world-writable permissions', tier: 'caution' },
  { pattern: /chmod\s+-R/i, reason: 'Recursive permission change', tier: 'caution' },
  { pattern: /chown\s+-R/i, reason: 'Recursive ownership change', tier: 'caution' },
  { pattern: /kill\s+-9/i, reason: 'Force killing a process', tier: 'caution' },
  { pattern: /kill\s+-SIGKILL/i, reason: 'SIGKILL a process', tier: 'caution' },
  { pattern: /taskkill\s+\/f/i, reason: 'Force killing a process (Windows)', tier: 'caution' },
  { pattern: /Stop-Process\s+-Force/i, reason: 'Force killing a process (PowerShell)', tier: 'caution' },
  { pattern: /npm\s+publish/i, reason: 'Publishing to npm registry', tier: 'caution' },
  { pattern: /pip\s+install\s+(?!-r).*--break-system/i, reason: 'Breaking system Python packages', tier: 'caution' },
  { pattern: /pip\s+install\s+--user.*--force/i, reason: 'Force installing pip packages', tier: 'caution' },
  { pattern: /env\s+.*=.*>/i, reason: 'Potential environment variable leak to file', tier: 'caution' },
  { pattern: /mv\s+\//i, reason: 'Moving files from root directory', tier: 'caution' },
  { pattern: /Move-Item.*\\\\/i, reason: 'Moving files (PowerShell)', tier: 'caution' },
  { pattern: /npm\s+uninstall\s+-g/i, reason: 'Globally uninstalling npm packages', tier: 'caution' },
  { pattern: /pip\s+uninstall/i, reason: 'Uninstalling Python packages', tier: 'caution' },
  { pattern: /docker\s+rm\s+-f/i, reason: 'Force removing Docker containers', tier: 'caution' },
  { pattern: /docker\s+system\s+prune/i, reason: 'Pruning Docker system', tier: 'caution' },
  { pattern: /Set-ExecutionPolicy/i, reason: 'Changing PowerShell execution policy', tier: 'caution' },
  { pattern: /netsh\s+/i, reason: 'Network configuration change', tier: 'caution' },
];

// ─── Injection Detection ──────────────────────────────────

const INJECTION_PATTERNS = [
  /;\s*(rm|del|format|shutdown|reboot)/i,
  /&&\s*(rm|del|format|shutdown|reboot)/i,
  /\|\|\s*(rm|del|format|shutdown|reboot)/i,
  /`[^`]*(rm|del|format|shutdown|reboot)[^`]*`/i,
  /\$\([^)]*(?:rm|del|format|shutdown|reboot)[^)]*\)/i,
];

const MAX_COMMAND_LENGTH = 2000;

// ─── Analysis Functions ───────────────────────────────────

/**
 * Analyze a command for safety risks with three-tier classification.
 * @param {string} command - The shell command to check
 * @returns {{ classification: 'safe'|'caution'|'dangerous', risks: Array<{reason: string, tier: string}> }}
 */
export function analyzeCommand(command) {
  const risks = [];

  // Length check
  if (command.length > MAX_COMMAND_LENGTH) {
    risks.push({ reason: `Command exceeds ${MAX_COMMAND_LENGTH} character safety limit`, tier: 'dangerous' });
  }

  // Injection detection
  for (const injection of INJECTION_PATTERNS) {
    if (injection.test(command)) {
      risks.push({ reason: 'Possible command injection detected', tier: 'dangerous' });
      break;
    }
  }

  // Pattern checks
  for (const entry of SAFETY_PATTERNS) {
    if (entry.pattern.test(command)) {
      risks.push({ reason: entry.reason, tier: entry.tier });
    }
  }

  // Determine overall classification (highest tier wins)
  let classification = 'safe';
  if (risks.some(r => r.tier === 'dangerous')) {
    classification = 'dangerous';
  } else if (risks.some(r => r.tier === 'caution')) {
    classification = 'caution';
  }

  return { classification, risks };
}

/**
 * Analyze an array of plan steps for safety.
 * @param {Array<{command: string}>} steps
 * @returns {{ overallClassification: 'safe'|'caution'|'dangerous', hasDangerousSteps: boolean, hasCautionSteps: boolean, analysis: Array }}
 */
export function analyzePlan(steps) {
  const analysis = steps.map((step, i) => {
    const result = analyzeCommand(step.command);
    return {
      step: i + 1,
      command: step.command,
      ...result,
    };
  });

  const hasDangerousSteps = analysis.some(a => a.classification === 'dangerous');
  const hasCautionSteps = analysis.some(a => a.classification === 'caution');

  let overallClassification = 'safe';
  if (hasDangerousSteps) overallClassification = 'dangerous';
  else if (hasCautionSteps) overallClassification = 'caution';

  return { overallClassification, hasDangerousSteps, hasCautionSteps, analysis };
}

/**
 * Display the execution plan to the user with safety annotations.
 */
export function displayPlan(steps, safetyAnalysis) {
  console.log();
  console.log(chalk.bold.cyan('📋 Execution Plan:'));
  console.log(chalk.dim('─'.repeat(50)));

  for (const item of safetyAnalysis.analysis) {
    const stepLabel = chalk.dim(`  Step ${item.step}:`);
    const commandStr = chalk.white.bold(item.command);

    if (item.classification === 'dangerous') {
      console.log(`${stepLabel} ${chalk.red('⛔')}  ${commandStr}`);
      for (const risk of item.risks) {
        console.log(chalk.red(`           ⛔  ${risk.reason}`));
      }
    } else if (item.classification === 'caution') {
      console.log(`${stepLabel} ${chalk.yellow('⚠')}  ${commandStr}`);
      for (const risk of item.risks) {
        console.log(chalk.yellow(`           ⚠  ${risk.reason}`));
      }
    } else {
      console.log(`${stepLabel} ${chalk.green('✓')}  ${commandStr}`);
    }
  }

  console.log(chalk.dim('─'.repeat(50)));

  if (safetyAnalysis.hasDangerousSteps) {
    console.log(chalk.red.bold('\n⛔  DANGER: This plan contains potentially destructive commands!'));
    console.log(chalk.red('   You will need to type "yes" to confirm.\n'));
  } else if (safetyAnalysis.hasCautionSteps) {
    console.log(chalk.yellow.bold('\n⚠  CAUTION: Some commands in this plan require care.'));
    console.log(chalk.yellow('   Review each step before proceeding.\n'));
  }
}

/**
 * Prompt the user for confirmation via readline.
 * @param {string} message
 * @param {boolean} isDangerous - If true, requires typing "yes" instead of just "y"
 * @returns {Promise<'yes'|'no'|'edit'>}
 */
export function promptConfirmation(message, isDangerous = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const options = isDangerous
      ? `${chalk.yellow('Type "yes" to confirm, "no" to cancel')}: `
      : `${chalk.cyan('(y)es / (n)o / (e)dit')}: `;

    rl.question(`${message} ${options}`, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();

      if (isDangerous) {
        resolve(a === 'yes' ? 'yes' : 'no');
      } else {
        if (a === 'y' || a === 'yes') resolve('yes');
        else if (a === 'e' || a === 'edit') resolve('edit');
        else resolve('no');
      }
    });
  });
}
