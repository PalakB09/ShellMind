// Planner — orchestrates the full flow: intent → safety check → confirmation → execution → error handling.
// HARDENED: max retry depth cap, validated AI fixes before execution, improved UX.
import chalk from 'chalk';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseIntent, parseIntentWithErrorContext, explainError } from '../intent/index.js';
import { analyzeIntent, analyzePlan, displayPlan, promptConfirmation } from '../safety/index.js';
import { executePlan } from '../executor/index.js';
import { saveCommand, loadCommand, commandExists } from '../memory/index.js';
import { checkIntentMemory, cacheSuccessfulIntent } from '../memory/intent.js';
import { getBuiltInWorkflow } from '../memory/defaults.js';
import { recordExecution } from '../context/command-history.js';
import { repairFailedStep } from '../intent/repair.js';
import { logAI, logExec, logSuccess } from '../cli/format.js';
import { buildExecutionIntent } from '../pipeline/index.js';
import { sanitizeSteps } from '../pipeline/sanitizer.js';
import { validateSteps } from '../pipeline/validator.js';

const MAX_PIPELINE_DEPTH = 3;  // Prevent infinite retry/clarification loops
const LAST_PLAN_FILE = path.join(os.homedir(), '.ai-cli', 'last-plan.json');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Name validation pattern — mirrors memory/index.js to catch errors before any I/O.
const NAME_PATTERN = /^[a-zA-Z0-9_\-]+$/;
const MAX_COMMAND_NAME_LENGTH = 50;

export async function saveLastPlan(name, options = {}) {
  if (!name) {
    console.log(chalk.yellow('\nUsage: ai save <name> [--global|--repo]\n'));
    return;
  }

  // Validate name FIRST — before any disk access or interactive prompts.
  // This ensures validation errors surface immediately, not after the scope prompt.
  if (name.length > MAX_COMMAND_NAME_LENGTH) {
    console.log(chalk.red(`\nCommand name must be ${MAX_COMMAND_NAME_LENGTH} characters or fewer.\n`));
    return;
  }
  if (!NAME_PATTERN.test(name)) {
    console.log(chalk.red('\nCommand name may only contain letters, numbers, hyphens, and underscores.\n'));
    return;
  }

  const plan = loadLastPlan();
  if (!plan || !plan.steps || plan.steps.length === 0) {
    console.log(chalk.yellow('\nNo previous plan to save. Run a command first, then use "ai save <name>".\n'));
    return;
  }

  let targetScope = options.scope;
  if (targetScope === null) {
    const choice = await askInput('Save to: (g)lobal / (r)epo? (default: global)');
    targetScope = choice.toLowerCase().startsWith('r') ? 'local' : 'global';
  } else if (!targetScope) {
    targetScope = 'global';
  }

  if (commandExists(name, targetScope)) {
    const scopeLabel = targetScope === 'local' ? 'repo' : 'global';
    const answer = await promptConfirmation(chalk.yellow(`\n"${name}" already exists in ${scopeLabel} workflows. Overwrite?`));
    if (answer !== 'yes') {
      console.log(chalk.yellow('\nCancelled.\n'));
      return;
    }
  }

  saveCommand(name, {
    commands: plan.steps.map(s => s.command),
    description: plan.intent,
    steps: plan.steps,
  }, targetScope);

  console.log(chalk.green(`\nSaved "${name}" to ${targetScope === 'local' ? 'repo' : 'global'} workflows.\n`));
}

/**
 * Prompt the user for input (e.g., commit message).
 * @param {string} prompt
 * @returns {Promise<string>}
 */
function askInput(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });
    rl.question(chalk.cyan(`  ${prompt}: `), (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function normalizeStoredPlan(plan) {
  const steps = plan?.steps || (plan?.commands || []).map(c => ({ command: c, description: c }));
  if (!plan || !steps || steps.length === 0) return null;
  return {
    intent: plan.intent || plan.description || plan.name || 'Saved workflow',
    steps: steps.map(s => ({
      command: s.command,
      description: s.description || s.command,
      requiresInput: s.requiresInput === true,
    })),
    savedAt: new Date().toISOString(),
    cwd: process.cwd(),
  };
}

export function persistLastPlan(plan) {
  const stored = normalizeStoredPlan(plan);
  if (!stored) return;
  ensureDir(path.dirname(LAST_PLAN_FILE));
  const tempPath = LAST_PLAN_FILE + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(stored, null, 2), 'utf-8');
  fs.renameSync(tempPath, LAST_PLAN_FILE);
}

export function loadLastPlan() {
  if (!fs.existsSync(LAST_PLAN_FILE)) return null;
  try {
    return normalizeStoredPlan(JSON.parse(fs.readFileSync(LAST_PLAN_FILE, 'utf-8')));
  } catch {
    return null;
  }
}

/**
 * Resolve any steps that require user input (e.g., commit messages, branch names).
 */
async function resolveInputs(steps) {
  const resolved = [];

  for (const step of steps) {
    let command = step.command;

    if (step.requiresInput) {
      // Find placeholders like <message>, <branch-name>, etc.
      const placeholders = command.match(/<[^>]+>/g) || [];
      for (const placeholder of placeholders) {
        const label = placeholder.replace(/[<>]/g, '');
        const value = await askInput(`Enter ${label}`);

        if (!value) {
          console.log(chalk.yellow(`  ⚠ Empty value for "${label}". Skipping this step.`));
          command = null;
          break;
        }

        // Escape quotes in user input to prevent injection
        const sanitized = value.replace(/"/g, '\\"');
        command = command.replace(placeholder, sanitized);
      }
    }

    if (command !== null) {
      resolved.push({ ...step, command });
    }
  }

  return resolved;
}

/**
 * The main planning and execution pipeline.
 * @param {string} instruction - The user's natural language input
 * @param {object} options
 * @param {Array} [options.history] - Conversation history for chat mode
 * @param {boolean} [options.autoExecute] - Skip confirmation (for 'auto' mode, still checks dangerous)
 * @param {boolean} [options.dryRun] - Only show plan, don't execute
 * @param {number} [options._depth] - Internal recursion depth tracker
 * @returns {Promise<{success: boolean, results: Array|null, plan: object|null}>}
 */
export async function runPipeline(instruction, options = {}) {
  const { history = [], autoExecute = false, dryRun = false, _depth = 0, _overrideIntent = null } = options;

  // Note: Provider availability is handled at runtime by the AI router.
  // No early gating needed here — the pipeline works with deterministic
  // intents even when no AI provider is reachable.

  // Guard: prevent infinite loops
  if (_depth >= MAX_PIPELINE_DEPTH) {
    console.log(chalk.red('\n✗ Maximum retry depth reached. Aborting to prevent loops.\n'));
    return { success: false, results: null, plan: null };
  }

  let intent = null;
  let isFromAI = false;

  // Shortcut: a corrected intent was already parsed by parseIntentWithErrorContext — skip all lookups.
  if (_overrideIntent) {
    intent = _overrideIntent;
    isFromAI = true;
    intent.__source = 'ai';
  }

  // ─── 1. Waterfall Memory Check ────────────────────────ــــ─

  // Attempt to load natively without AI by exactly matching instruction string
  const normalizedInst = instruction.trim();

  // A. Local Workflow (ai-commands.md)
  if (!intent) {
    const nativeObj = loadCommand(normalizedInst);
    if (nativeObj) {
      intent = { name: normalizedInst, ...nativeObj };
    }
  }

  // B. Global Workflow (~/.ai-cli/commands.json)
  // loadCommand inherently checks Local then Global, so A covers B.

  // C. Intent Cache (Previous successful AI executions)
  if (!intent) {
    const cachedIntent = checkIntentMemory(normalizedInst);
    if (cachedIntent) intent = cachedIntent;
  }

  // D. Built-In Default Workflows
  if (!intent) {
    const builtinIntent = getBuiltInWorkflow(normalizedInst);
    if (builtinIntent) intent = builtinIntent;
  }

  // ─── 2. AI Fallback Generation ─────────────────────────────

  if (!intent) {
    const intentSafety = analyzeIntent(normalizedInst);
    if (intentSafety.classification === 'dangerous') {
      console.log(chalk.red('\nBlocked before planning. This request appears destructive or unsafe.'));
      for (const risk of intentSafety.risks) {
        console.log(chalk.red(`  - ${risk.reason}`));
      }
      console.log();
      return { success: false, results: null, plan: null };
    }
  }

  if (!intent) {
    const planningResult = await buildExecutionIntent(instruction, {
      history,
      cwd: process.cwd(),
    });
    intent = planningResult.intent;
    isFromAI = planningResult.source === 'ai';
    
    if (!intent) {
      return { success: false, results: null, plan: null };
    }

    // Interactive clarifications needed?
    if (intent.needsMoreInfo) {
      console.log(chalk.yellow(`\n❓ ${intent.question}\n`));
      const answer = await askInput('Your answer');

      if (!answer) {
        console.log(chalk.yellow('\n✋ No input provided. Cancelling.\n'));
        return { success: false, results: null, plan: null };
      }

      return runPipeline(`${instruction}\n\nUser clarification: ${answer}`, {
        ...options,
        _depth: _depth + 1,
      });
    }
  }

  const hasSteps = intent.steps && intent.steps.length > 0;
  const hasCommands = intent.commands && intent.commands.length > 0;

  if (!hasSteps && !hasCommands) {
    console.log(chalk.yellow('\nNo commands to execute.'));
    return { success: true, results: null, plan: intent };
  }

  // Step 3: Resolve user inputs (placeholders)
  const resolvedSteps = sanitizeSteps(await resolveInputs(intent.steps || intent.commands.map(c => ({ command: c, description: c }))));

  if (resolvedSteps.length === 0) {
    console.log(chalk.yellow('\nAll steps were skipped. Nothing to execute.'));
    return { success: false, results: null, plan: intent };
  }

  const validationResult = validateSteps(resolvedSteps);
  if (!validationResult.valid) {
    console.log(chalk.red('\nInvalid command rejected before execution.\n'));
    for (const issue of validationResult.issues) {
      console.log(chalk.red(`Step ${issue.step}: ${issue.command}`));
      for (const error of issue.errors) {
        console.log(chalk.red(`  - ${error}`));
      }
    }
    console.log();
    return { success: false, results: null, plan: intent };
  }

  // Step 4: Safety analysis
  const safetyResult = analyzePlan(resolvedSteps);
  persistLastPlan({
    intent: intent.intent || intent.description || intent.name || instruction,
    steps: resolvedSteps,
  });

  // Step 5+7: Display plan and confirmation
  // Deterministic + safe commands (e.g. "git status") auto-execute with no ceremony.
  // AI-generated or risky commands always show the plan and require confirmation.
  const isDeterministic = intent.__source === 'deterministic';
  const isSafe = !safetyResult.hasDangerousSteps && !safetyResult.hasCautionSteps;
  const skipConfirmation = isDeterministic && isSafe && !dryRun;

  if (!skipConfirmation) {
    displayPlan(resolvedSteps, safetyResult);
  }

  // Step 6: Dry-run mode — stop here
  if (dryRun) {
    if (skipConfirmation) displayPlan(resolvedSteps, safetyResult); // still show in dry-run
    console.log(chalk.cyan('\n📝 Dry run mode — no commands executed.\n'));
    return { success: true, results: null, plan: intent };
  }

  // Step 7: Confirmation (skip for safe deterministic commands)
  if (!skipConfirmation) {
    if (!autoExecute || safetyResult.hasDangerousSteps || safetyResult.hasCautionSteps) {
      const confirmMsg = safetyResult.hasDangerousSteps
        ? chalk.red.bold('\n⚡ Execute these commands?')
        : safetyResult.hasCautionSteps
          ? chalk.yellow.bold('\n⚡ Execute these commands?')
          : chalk.cyan('\n⚡ Execute this plan?');

      const answer = await promptConfirmation(confirmMsg, safetyResult.hasDangerousSteps);

      if (answer === 'no') {
        console.log(chalk.yellow('\n✋ Cancelled.\n'));
        return { success: false, results: null, plan: intent };
      }

      if (answer === 'edit') {
        console.log(chalk.yellow('\n✏ Please re-phrase your instruction:\n'));
        const newInstruction = await askInput('New instruction');

        if (!newInstruction) {
          console.log(chalk.yellow('\n✋ No input provided. Cancelling.\n'));
          return { success: false, results: null, plan: intent };
        }

        return runPipeline(newInstruction, { ...options, _depth: _depth + 1 });
      }
    }
  }

  // Step 8: Execute
  logExec('Executing plan');
  const executionResult = await executePlan(resolvedSteps, {
    repairStep: isFromAI
      ? ({ failedStep }) => repairFailedStep({ failedStep, instruction })
      : null,
  });
  recordExecution({
    cwd: process.cwd(),
    instruction,
    steps: resolvedSteps,
    results: executionResult.results,
  });

  // Step 9: Error handling + self-healing (with depth guard)
  if (!executionResult.allSucceeded) {
    const failedStep = executionResult.results.find(r => !r.success);
    if (failedStep) {
      const isDeterministicFailure = intent.__source === 'deterministic';
      if (isDeterministicFailure) {
        const conciseError = (failedStep.stderr || 'Command failed.')
          .split('\n')
          .map((line) => line.trim())
          .find(Boolean) || 'Command failed.';
        console.log(chalk.red(`\n${conciseError}\n`));
      } else {
        logAI('Analyzing failed step');
        const explanation = await explainError(
          failedStep.command,
          failedStep.stderr,
          failedStep.stdout
        );
        console.log(chalk.white('\n' + explanation));
        console.log(chalk.dim('─'.repeat(50)));
      }

      // Only offer retry if we haven't hit max depth
      if (!isDeterministicFailure && _depth < MAX_PIPELINE_DEPTH - 1) {
        const retryAnswer = await promptConfirmation(
          chalk.yellow('\n🔄 Would you like to try a corrected approach?')
        );

        if (retryAnswer === 'yes') {
          // Use parseIntentWithErrorContext so the model sees the real error as a
          // conversation turn — not as a new free-text instruction it can hallucinate about.
          const correctedIntent = await parseIntentWithErrorContext(
            instruction,
            failedStep.command,
            failedStep.stderr || ''
          );

          if (!correctedIntent || !correctedIntent.steps?.length) {
            console.log(chalk.yellow('\n⟋ Could not generate a corrected plan. Try rephrasing your request.\n'));
          } else {
            return runPipeline(instruction, {
              ...options,
              _depth: _depth + 1,
              _overrideIntent: correctedIntent,
            });
          }
        }
      } else {
        if (!isDeterministicFailure) {
          console.log(chalk.yellow('\n⚠ Max retry depth reached. Please try a different approach manually.\n'));
        }
      }
    }
  } else {
      logSuccess('Plan completed successfully.');

      if (isFromAI) {
        cacheSuccessfulIntent(instruction, resolvedSteps);
        console.log(chalk.dim(`💡 Run this often? Save it as a workflow: ai save <name>\n`));
      }
  }

  return {
    success: executionResult.allSucceeded,
    results: executionResult.results,
    plan: intent,
  };
}

/**
 * Save the last executed plan as a named command.
 * @param {string} name - Alias to save under
 * @param {object} plan - The plan object from runPipeline
 * @param {'local'|'global'} scope
 */
function legacySaveLastPlanForCompatibility(name, plan, scope = 'local') {
  if (!plan || !plan.steps || plan.steps.length === 0) {
    console.log(chalk.yellow('No plan to save.'));
    return;
  }

  saveCommand(name, {
    commands: plan.steps.map(s => s.command),
    description: plan.intent,
    steps: plan.steps,
  }, scope);

  console.log(chalk.green(`\n✓ Saved as "${name}" (${scope} scope).\n`));
}
