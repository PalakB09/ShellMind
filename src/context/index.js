// Context Engine — detects project type, available scripts, and gathers directory context.
import fs from 'fs';
import path from 'path';

const PROJECT_MARKERS = [
  { file: 'package.json', type: 'node', label: 'Node.js' },
  { file: 'requirements.txt', type: 'python-pip', label: 'Python (pip)' },
  { file: 'pyproject.toml', type: 'python-poetry', label: 'Python (Poetry/PEP)' },
  { file: 'Pipfile', type: 'python-pipenv', label: 'Python (Pipenv)' },
  { file: 'Cargo.toml', type: 'rust', label: 'Rust' },
  { file: 'go.mod', type: 'go', label: 'Go' },
  { file: 'pom.xml', type: 'java-maven', label: 'Java (Maven)' },
  { file: 'build.gradle', type: 'java-gradle', label: 'Java (Gradle)' },
  { file: 'Gemfile', type: 'ruby', label: 'Ruby' },
  { file: 'composer.json', type: 'php', label: 'PHP (Composer)' },
  { file: 'Dockerfile', type: 'docker', label: 'Docker' },
  { file: 'docker-compose.yml', type: 'docker-compose', label: 'Docker Compose' },
  { file: 'docker-compose.yaml', type: 'docker-compose', label: 'Docker Compose' },
  { file: '.env', type: 'env', label: 'Environment Variables' },
  { file: '.env.example', type: 'env-example', label: 'Environment Template' },
  { file: 'Makefile', type: 'make', label: 'Makefile' },
];

/**
 * Detect all project types present in the given directory.
 * @param {string} dir - Directory to scan (defaults to cwd)
 * @returns {{ types: Array<{type: string, label: string, file: string}>, scripts: object|null, hasGit: boolean }}
 */
export function detectProject(dir = process.cwd()) {
  const detected = [];

  for (const marker of PROJECT_MARKERS) {
    const fullPath = path.join(dir, marker.file);
    if (fs.existsSync(fullPath)) {
      detected.push({ type: marker.type, label: marker.label, file: marker.file });
    }
  }

  // Extract scripts from package.json if present
  let scripts = null;
  const pkgPath = path.join(dir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      scripts = pkg.scripts || null;
    } catch {
      // ignore parse errors
    }
  }

  // Check if it's a git repo
  const hasGit = fs.existsSync(path.join(dir, '.git'));

  return { types: detected, scripts, hasGit };
}

/**
 * Build a directory listing (top-level only) for context.
 * @param {string} dir
 * @returns {string[]}
 */
export function getDirectoryListing(dir = process.cwd()) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries
      .filter(e => !e.name.startsWith('.') || ['.env', '.env.example', '.gitignore', '.dockerignore'].includes(e.name))
      .map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`)
      .slice(0, 50); // cap to avoid flooding prompt
  } catch {
    return [];
  }
}

/**
 * Build a complete context summary string to inject into the AI prompt.
 */
export function buildContextSummary(dir = process.cwd()) {
  const project = detectProject(dir);
  const listing = getDirectoryListing(dir);

  const lines = [];
  lines.push(`Current directory: ${dir}`);

  if (project.hasGit) {
    lines.push(`Git repository: yes`);
  }

  if (project.types.length > 0) {
    lines.push(`Detected project types: ${project.types.map(t => t.label).join(', ')}`);
  }

  if (project.scripts) {
    const scriptNames = Object.keys(project.scripts);
    if (scriptNames.length > 0) {
      lines.push(`Available npm scripts: ${scriptNames.join(', ')}`);
      lines.push(`Script details:`);
      for (const [name, command] of Object.entries(project.scripts)) {
        lines.push(`  - ${name}: ${command}`);
      }
    }
  }

  if (listing.length > 0) {
    lines.push(`\nDirectory contents (top-level):`);
    listing.forEach(l => lines.push(`  ${l}`));
  }

  return lines.join('\n');
}
