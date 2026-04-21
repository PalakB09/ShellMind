// Memory Defaults — built-in OS-aware workflows.
// FIXED: commands now adapt to the detected OS instead of always using Unix syntax.
import { detectOS } from '../os-adapter/index.js';

export function getBuiltInWorkflow(instruction) {
  const norm = instruction.toLowerCase().trim();
  const isWindows = detectOS() === 'windows';

  // OS-specific command variants
  const purgeModules = isWindows
    ? 'Remove-Item -Recurse -Force node_modules, package-lock.json -ErrorAction SilentlyContinue'
    : 'rm -rf node_modules package-lock.json';

  const defaults = {
    'setup': {
      name: 'setup',
      description: 'Built-in: Install project dependencies.',
      steps: [
        { command: 'npm install', description: 'Install Node.js dependencies' },
      ],
    },
    'dev': {
      name: 'dev',
      description: 'Built-in: Start development server.',
      steps: [
        { command: 'npm run dev', description: 'Run dev server' },
      ],
    },
    'test': {
      name: 'test',
      description: 'Built-in: Run test suites.',
      steps: [
        { command: 'npm test', description: 'Execute test pipeline' },
      ],
    },
    'deploy': {
      name: 'deploy',
      description: 'Built-in: Build and start production server.',
      steps: [
        { command: 'npm run build', description: 'Compile production bundle' },
        { command: 'npm start', description: 'Start production server' },
      ],
    },
    'reset': {
      name: 'reset',
      description: 'Built-in: Remove node_modules and reinstall cleanly.',
      steps: [
        { command: purgeModules, description: 'Remove node_modules and lockfile' },
        { command: 'npm install', description: 'Fresh dependency install' },
      ],
    },
  };

  return defaults[norm] || null;
}
