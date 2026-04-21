import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.ai-cli');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG = {
  provider: 'ollama',
  apiKeys: {},
  // Models are intentionally NOT hardcoded — they must be set via `ai init`.
  // Having null here means the AI router will skip local/cloud if not configured.
  models: {
    local: null,
    cloud: null,
  },
  defaultMode: 'execute',
};

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Loads and merges user config with environment variables and defaults.
 * @returns {object} Merged configuration object
 */
export function getConfig() {
  let fileConfig = {};

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      if (typeof parsed === 'object' && parsed !== null) {
        fileConfig = parsed;
      }
    } catch {
      // Ignore parse errors, fall back to defaults
    }
  }

  return {
    provider: fileConfig.provider || DEFAULT_CONFIG.provider,
    apiKeys: {
      gemini: fileConfig.apiKeys?.gemini || process.env.GEMINI_API_KEY || null,
    },
    // Deep merge models — use file config ONLY, no fallback hardcoded values.
    models: {
      local: fileConfig.models?.local || process.env.AI_LOCAL_MODEL || null,
      cloud: fileConfig.models?.cloud || process.env.AI_CLOUD_MODEL || null,
    },
    defaultMode: fileConfig.defaultMode || DEFAULT_CONFIG.defaultMode,
  };
}

/**
 * Returns true if ANY AI provider is configured — either a local Ollama model
 * has been selected via `ai init`, or a Gemini API key is present.
 * Returns false in 'No AI' mode (provider === 'none').
 * Ollama reachability is checked at runtime in the router; this only checks config.
 */
export function hasAnyApiKey() {
  const config = getConfig();
  if (config.provider === 'none') return false;
  return !!(config.apiKeys?.gemini || config.models?.local);
}

/**
 * Returns true if any provider is configured (local model set, or Gemini key present).
 * Returns false in 'No AI' mode (provider === 'none').
 * Does NOT guarantee the provider is currently reachable.
 */
export function hasConfiguredProvider() {
  const config = getConfig();
  if (config.provider === 'none') return false;
  return !!(config.apiKeys?.gemini || config.models?.local);
}

/**
 * Persists a partial config update, deep-merging with the existing file config.
 * @param {object} newConfig - Partial configuration to merge and save
 */
export function saveConfig(newConfig) {
  ensureConfigDir();

  let current = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      current = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    } catch { /* ignore */ }
  }

  const merged = { ...current, ...newConfig };

  // Deep merge nested objects
  if (newConfig.apiKeys) {
    merged.apiKeys = { ...current.apiKeys, ...newConfig.apiKeys };
  }
  if (newConfig.models) {
    merged.models = { ...current.models, ...newConfig.models };
  }

  const tempPath = CONFIG_FILE + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(merged, null, 2), 'utf-8');
  fs.renameSync(tempPath, CONFIG_FILE);
}
