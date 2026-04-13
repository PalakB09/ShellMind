export function getBuiltInWorkflow(instruction) {
  const norm = instruction.toLowerCase().trim();
  
  const defaults = {
    'setup': {
      name: 'setup',
      description: 'Built-in: Scaffold and install project dependencies.',
      steps: [
        { command: 'npm install', description: 'Install Node dependencies (if present)' }
      ]
    },
    'dev': {
      name: 'dev',
      description: 'Built-in: Start development server.',
      steps: [
        { command: 'npm run dev', description: 'Run dev script' }
      ]
    },
    'test': {
      name: 'test',
      description: 'Built-in: Run local test suites.',
      steps: [
        { command: 'npm test', description: 'Execute testing pipelines' }
      ]
    },
    'deploy': {
      name: 'deploy',
      description: 'Built-in: Run production build and export.',
      steps: [
        { command: 'npm run build', description: 'Compile production bundle' },
        { command: 'npm start', description: 'Spin up production server' }
      ]
    },
    'reset': {
      name: 'reset',
      description: 'Built-in: Nuke node_modules and reinstall.',
      steps: [
        { command: 'rm -rf node_modules package-lock.json', description: 'Purge package caches' },
        { command: 'npm install', description: 'Freshly provision workspace' }
      ]
    }
  };

  return defaults[norm] || null;
}
