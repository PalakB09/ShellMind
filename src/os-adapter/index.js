// OS Adapter — detects OS, shell, and maps generic commands to platform-specific ones.
import os from 'os';
import { execSync } from 'child_process';

/**
 * Detect the current operating system.
 * @returns {'windows'|'macos'|'linux'}
 */
export function detectOS() {
  const platform = os.platform();
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  return 'linux';
}

/**
 * Detect the current shell environment.
 * @returns {string} e.g. 'powershell', 'bash', 'zsh', 'cmd'
 */
export function detectShell() {
  const currentOS = detectOS();

  if (currentOS === 'windows') {
    // Check for PowerShell via env variable
    const psModulePath = process.env.PSModulePath;
    if (psModulePath) return 'powershell';
    if (process.env.ComSpec && process.env.ComSpec.toLowerCase().includes('cmd.exe')) return 'cmd';
    return 'powershell'; // default on modern Windows
  }

  // Unix-like: use SHELL env
  const shell = process.env.SHELL || '';
  if (shell.includes('zsh')) return 'zsh';
  if (shell.includes('fish')) return 'fish';
  if (shell.includes('bash')) return 'bash';
  return 'bash'; // fallback
}

/**
 * Get the shell-specific command execution prefix.
 * Used by the executor to know how to spawn commands.
 */
export function getShellConfig() {
  const currentOS = detectOS();
  const shell = detectShell();

  if (currentOS === 'windows') {
    if (shell === 'powershell') {
      return { shellPath: 'powershell.exe', shellFlag: '-Command' };
    }
    return { shellPath: 'cmd.exe', shellFlag: '/c' };
  }

  // Unix
  const shellPath = process.env.SHELL || '/bin/bash';
  return { shellPath, shellFlag: '-c' };
}

/**
 * Build a comprehensive system info object for the AI prompt.
 */
export function getSystemInfo() {
  const currentOS = detectOS();
  const shell = detectShell();
  const shellConfig = getShellConfig();

  return {
    os: currentOS,
    platform: os.platform(),
    arch: os.arch(),
    shell,
    shellConfig,
    homeDir: os.homedir(),
    cwd: process.cwd(),
    user: os.userInfo().username,
    hostname: os.hostname(),
    nodeVersion: process.version,
  };
}
