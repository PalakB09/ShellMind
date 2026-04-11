import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.ai-cli');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG = {
  provider: 'openrouter',
  apiKeys: {}, // { gemini: '...', openrouter: '...' }
  models: [], // E.g., ['meta-llama/llama-3.3-70b-instruct:free', 'google/gemma-3-27b-it:free']
  defaultMode: 'execute'
};

/**
 * Ensures the config directory exists.
 */
function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Loads the user configuration and merges it with process.env
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
      // Ignore parse errors, fallback to default
    }
  }

  const merged = {
    provider: fileConfig.provider || DEFAULT_CONFIG.provider,
    apiKeys: {
      gemini: fileConfig.apiKeys?.gemini || process.env.GEMINI_API_KEY || null,
      openrouter: fileConfig.apiKeys?.openrouter || process.env.OPENROUTER_API_KEY || null
    },
    models: Array.isArray(fileConfig.models) ? fileConfig.models : DEFAULT_CONFIG.models,
    defaultMode: fileConfig.defaultMode || DEFAULT_CONFIG.defaultMode,
    geminiFallbackCache: Array.isArray(fileConfig.geminiFallbackCache) ? fileConfig.geminiFallbackCache : null
  };

  // Auto-detect provider if none explicitly set in file, but keys exist
  if (!fileConfig.provider) {
    if (merged.apiKeys.gemini && !merged.apiKeys.openrouter) {
      merged.provider = 'gemini';
    } else if (merged.apiKeys.openrouter) {
      merged.provider = 'openrouter';
    }
  }

  return merged;
}

/**
 * Checks if the system has any usable API keys available.
 * Required to determine if we should fall back to No-Key Mode.
 * @returns {boolean} True if any API key exists.
 */
export function hasAnyApiKey() {
  const config = getConfig();
  return !!(config.apiKeys.gemini || config.apiKeys.openrouter);
}

/**
 * Save configuration to the config file
 * @param {object} newConfig Partial configuration object to merge and save
 */
export function saveConfig(newConfig) {
  ensureConfigDir();
  
  let currentFileConfig = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      currentFileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    } catch { /* ignore */ }
  }

  const merged = { ...currentFileConfig, ...newConfig };
  
  // Need to merge apiKeys properly
  if (newConfig.apiKeys) {
    merged.apiKeys = { ...currentFileConfig.apiKeys, ...newConfig.apiKeys };
  }

  const tempPath = CONFIG_FILE + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(merged, null, 2), 'utf-8');
  fs.renameSync(tempPath, CONFIG_FILE);
}
