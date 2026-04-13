import chalk from 'chalk';
import { analyzePlan, displayPlan, promptConfirmation } from '../safety/index.js';
import { executePlan } from '../executor/index.js';
import { persistLastPlan } from '../planner/index.js';

export async function executeSavedWorkflow(name, entry, options = {}) {
  const { dryRun = false, autoExecute = false } = options;
  const steps = entry.steps || (entry.commands || []).map(c => ({ command: c, description: c }));

  if (!steps.length) {
    console.log(chalk.yellow('\nNo commands to execute.\n'));
    return { success: true, results: null, plan: entry };
  }

  const plan = {
    intent: entry.description || name,
    name,
    steps,
    commands: steps.map(s => s.command),
  };
  persistLastPlan(plan);

  console.log(chalk.bold.magenta(`\nRunning workflow: `) + chalk.white(entry.description || name));
  const safetyResult = analyzePlan(steps);
  displayPlan(steps, safetyResult);

  if (safetyResult.hasBlockedSteps) {
    console.log(chalk.red('\nBlocked. This workflow contains a non-overridable safety violation.\n'));
    return { success: false, results: null, plan };
  }

  if (dryRun) {
    console.log(chalk.cyan('\nDry run mode - no commands executed.\n'));
    return { success: true, results: null, plan };
  }

  if (!autoExecute || safetyResult.hasDangerousSteps || safetyResult.hasCautionSteps) {
    const answer = await promptConfirmation(
      safetyResult.hasDangerousSteps
        ? chalk.red.bold('\nExecute these dangerous commands?')
        : chalk.cyan('\nExecute this workflow?'),
      safetyResult.hasDangerousSteps
    );
    if (answer !== 'yes') {
      console.log(chalk.yellow('\nCancelled.\n'));
      return { success: false, results: null, plan };
    }
  }

  console.log(chalk.bold.green('\nExecuting...\n'));
  const executionResult = await executePlan(steps);
  return {
    success: executionResult.allSucceeded,
    results: executionResult.results,
    plan,
  };
}

