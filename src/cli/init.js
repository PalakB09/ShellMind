// Onboarding Wizard — auto-detects Ollama models, no hardcoded defaults.
// Models are always set from what the user actually has installed.
import chalk from 'chalk';
import readline from 'readline';
import { getConfig, saveConfig } from '../config/index.js';
import { isOllamaRunning, getOllamaModels } from '../ai/router.js';

// ─── Helpers ──────────────────────────────────────────────

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, answer => resolve(answer.trim())));
}

// ─── Gemini Model Catalog ─────────────────────────────────
// These are the current stable models available via the Google AI API.
const GEMINI_MODELS = [
  { key: '1', id: 'gemini-2.0-flash',         label: 'Gemini 2.0 Flash',      note: 'fastest, free tier, recommended' },
  { key: '2', id: 'gemini-2.5-flash-preview-04-17', label: 'Gemini 2.5 Flash Preview', note: 'latest preview, highest quality' },
  { key: '3', id: 'gemini-1.5-flash',          label: 'Gemini 1.5 Flash',      note: 'stable, widely available' },
  { key: '4', id: 'gemini-1.5-pro',            label: 'Gemini 1.5 Pro',        note: 'highest accuracy, slower' },
];

// ─── Main Wizard ──────────────────────────────────────────

export async function runInit() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log(chalk.bold.cyan('\n  AI CLI — Setup Wizard\n'));
    console.log(chalk.dim('  Configures your AI provider and saves to ~/.ai-cli/config.json\n'));
    console.log(chalk.dim('  Press Ctrl+C at any time to cancel.\n'));

    // ─── Step 1: Detect Ollama & Available Models ─────────

    process.stdout.write(chalk.dim('  Checking Ollama...\n'));
    const ollamaRunning = await isOllamaRunning();
    const pulledModels = ollamaRunning ? await getOllamaModels() : [];

    if (ollamaRunning) {
      console.log(chalk.green(`  ✓ Ollama is running.\n`));
      if (pulledModels.length > 0) {
        console.log(chalk.dim(`  Installed models: ${pulledModels.join(', ')}\n`));
      } else {
        console.log(chalk.yellow('  No models installed yet. You can pull one after setup.\n'));
      }
    } else {
      console.log(chalk.yellow('  ⚠  Ollama is not running or not installed.\n'));
      console.log(chalk.dim('  Install: https://ollama.com/download'));
      console.log(chalk.dim('  Then pull a model: ollama pull llama3.2:3b\n'));
    }

    // ─── Step 2: Choose Mode ─────────────────────────────

    console.log(chalk.bold('  How would you like to run AI CLI?\n'));
    console.log(`    ${chalk.cyan('1)')} Local Only       — Ollama  (private, no API key, works offline)`);
    console.log(`    ${chalk.cyan('2)')} Cloud Only        — Gemini  (internet + API key required)`);
    console.log(`    ${chalk.cyan('3)')} Hybrid            — Ollama primary, Gemini fallback  ${chalk.dim('[recommended]')}`);
    console.log(`    ${chalk.cyan('4)')} No AI             — Deterministic commands only (no model needed)\n`);

    const modeAnswer = await ask(rl, chalk.cyan('  Choose (1/2/3/4) [default: 3]: '));
    const mode = ['1', '2', '3', '4'].includes(modeAnswer) ? modeAnswer : '3';

    const newConfig = {
      provider: mode === '2' ? 'gemini' : mode === '4' ? 'none' : 'ollama',
      apiKeys: {},
      models: {},
    };

    // ─── Step 3: No AI Mode — skip everything ────────────
    if (mode === '4') {
      saveConfig(newConfig);
      console.log(chalk.bold.green('\n  ✓ Configuration saved to ~/.ai-cli/config.json\n'));
      console.log(chalk.bold('  No AI mode active.\n'));
      console.log(chalk.dim('  Deterministic commands, saved workflows, and ai-commands.md all work.'));
      console.log(chalk.dim('  AI features (natural language → command) are disabled.'));
      console.log(chalk.dim('  Run `ai init` again to enable AI later.\n'));
      console.log(chalk.bold('  Try:\n'));
      console.log(chalk.cyan('    ai git status'));
      console.log(chalk.cyan('    ai list'));
      console.log(chalk.cyan('    ai run <workflow-name>\n'));
      rl.close();
      return;
    }

    // ─── Step 3: Local Model Selection ───────────────────
    // Always auto-detect from what is actually installed — no hardcoded defaults.

    if (mode === '1' || mode === '3') {
      if (pulledModels.length === 0) {
        // No models installed — prompt to pull first
        console.log(chalk.yellow('\n  No local models installed in Ollama.\n'));
        console.log(chalk.dim('  Pull one now in a separate terminal:\n'));
        console.log(chalk.bold('    ollama pull llama3.2:3b') + chalk.dim('  (recommended)'));
        console.log(chalk.bold('    ollama pull llama3.2:1b') + chalk.dim('  (lightweight, faster)'));
        console.log(chalk.bold('    ollama pull llama3.1:8b') + chalk.dim('  (most powerful)'));
        const manual = await ask(rl, chalk.cyan('\n  Or type a model name manually (e.g. llama3.2:3b), or Enter to skip: '));
        if (manual.trim()) {
          newConfig.models.local = manual.trim();
          console.log(chalk.dim(`\n  Will use "${newConfig.models.local}" — pull it before running commands.\n`));
        } else {
          console.log(chalk.dim('\n  Skipped. Run `ai init` again after pulling a model.\n'));
        }
      } else if (pulledModels.length === 1) {
        // Only one model — auto-select it, no prompt needed
        newConfig.models.local = pulledModels[0];
        console.log(chalk.green(`\n  ✓ Auto-selected local model: ${chalk.bold(pulledModels[0])}\n`));
      } else {
        // Multiple models — let user pick from their actual installed list
        console.log(chalk.bold('\n  Select local model (your installed models):\n'));
        pulledModels.forEach((m, i) => {
          console.log(`    ${chalk.cyan((i + 1) + ')')} ${m}`);
        });
        console.log();

        const modelAnswer = await ask(rl, chalk.cyan(`  Choose (1-${pulledModels.length}) [default: 1]: `));
        const idx = parseInt(modelAnswer, 10) - 1;
        const selectedModel = pulledModels[Number.isInteger(idx) && idx >= 0 && idx < pulledModels.length ? idx : 0];
        newConfig.models.local = selectedModel;
        console.log(chalk.green(`\n  ✓ Selected: ${chalk.bold(selectedModel)}\n`));
      }
    }

    // ─── Step 4: Gemini API Key ───────────────────────────

    if (mode === '2' || mode === '3') {
      // Let user pick which Gemini model to use
      console.log(chalk.bold('  Select Gemini model:\n'));
      for (const m of GEMINI_MODELS) {
        const tag = m.key === '1' ? chalk.dim(' ← recommended') : '';
        console.log(`    ${chalk.cyan(m.key + ')')} ${m.label.padEnd(28)} — ${chalk.dim(m.note)}${tag}`);
      }
      console.log();

      const geminiModelAnswer = await ask(rl, chalk.cyan(`  Choose (1-${GEMINI_MODELS.length}) [default: 1]: `));
      const selectedGeminiModel = GEMINI_MODELS.find(m => m.key === geminiModelAnswer) || GEMINI_MODELS[0];
      newConfig.models.cloud = selectedGeminiModel.id;
      console.log(chalk.green(`\n  ✓ Cloud model: ${chalk.bold(selectedGeminiModel.label)}\n`));

      // Check existing key
      const existingKey = getConfig().apiKeys?.gemini;
      if (existingKey) {
        console.log(chalk.green('  ✓ Gemini API key already saved.'));
        const keep = await ask(rl, chalk.cyan('  Keep existing key? (y/n) [default: y]: '));
        const keepLower = keep.toLowerCase();
        if (!keepLower.startsWith('n')) {
          newConfig.apiKeys.gemini = existingKey;
        }
      }

      if (!newConfig.apiKeys.gemini) {
        console.log(chalk.dim('\n  Get a free API key at: https://aistudio.google.com/apikey\n'));
        const key = await ask(rl, chalk.cyan('  Paste your Gemini API key (or Enter to skip): '));
        if (key) {
          newConfig.apiKeys.gemini = key;
          console.log(chalk.green('\n  ✓ Gemini API key saved.\n'));
        } else {
          console.log(chalk.dim('\n  Skipped. Run `ai init` again to add a Gemini key later.\n'));
        }
      }
    }

    // ─── Step 5: Save & Summary ───────────────────────────

    saveConfig(newConfig);

    console.log(chalk.bold.green('  ✓ Configuration saved to ~/.ai-cli/config.json\n'));
    console.log(chalk.bold('  Your setup:\n'));

    if (newConfig.models.local) {
      console.log(`    Local model:   ${chalk.cyan(newConfig.models.local)}`);
    }
    if (newConfig.models.cloud) {
      console.log(`    Cloud model:   ${chalk.cyan(newConfig.models.cloud)}`);
    }
    const keyStatus = newConfig.apiKeys.gemini ? chalk.green('configured') : chalk.yellow('not set');
    console.log(`    Gemini key:    ${keyStatus}`);

    const hasLocalReady = mode !== '2' && !!newConfig.models.local;
    const hasCloudReady = (mode === '2' || mode === '3') && !!newConfig.apiKeys.gemini;

    if (!hasLocalReady && !hasCloudReady) {
      console.log(chalk.yellow('\n  ⚠  No provider is fully ready. Pull an Ollama model or add a Gemini key.'));
    } else {
      console.log(chalk.bold('\n  Ready. Try:\n'));
      console.log(chalk.cyan('    ai git add chat.js and package.json'));
      console.log(chalk.cyan('    ai show me memory-heavy processes'));
      console.log(chalk.cyan('    ai chat\n'));
    }

  } catch (err) {
    if (err.code === 'ERR_USE_AFTER_CLOSE') return; // Ctrl+C
    console.log(chalk.red(`\n  Setup error: ${err.message}\n`));
  } finally {
    rl.close();
  }
}
