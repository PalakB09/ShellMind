import { buildDeleteOldestCommand, buildStageCommand, filterEntries } from '../context/output-parser.js';
import { getGitStatusEntries, getWorkspaceEntries } from '../context/index.js';

function normalizeIntent(command, description) {
  return {
    intent: description,
    steps: [{ command, description, requiresInput: false }],
    needsMoreInfo: false,
    question: null,
  };
}

export function buildDeterministicIntent(parsedIntent, context = {}) {
  const { os = process.platform === 'win32' ? 'windows' : 'linux', cwd = process.cwd(), latestRecord = null } = context;
  const extractedFiles = latestRecord?.extractedFiles || [];

  switch (parsedIntent.kind) {
    case 'git_status':
      return normalizeIntent('git status', 'Show git working tree status');

    case 'list_files':
      if (parsedIntent.filters?.includeTerms?.length) {
        const extTerm = parsedIntent.filters.includeTerms.find((term) => /^\.?[a-z0-9]+$/i.test(term));
        if (extTerm) {
          const ext = extTerm.replace(/^\./, '');
          return normalizeIntent(
            os === 'windows'
              ? `Get-ChildItem -Recurse -File -Filter *.${ext} | ForEach-Object { Resolve-Path -Relative $_.FullName }`
              : `find . -type f -name '*.${ext}' | sed 's#^./##'`,
            `List .${ext} files`
          );
        }
      }
      return normalizeIntent(os === 'windows' ? 'Get-ChildItem -Name' : 'ls -1', 'List files');

    case 'kill_port':
      if (!parsedIntent.port) return null;
      return normalizeIntent(
        os === 'windows'
          ? `Get-NetTCPConnection -LocalPort ${parsedIntent.port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }`
          : `lsof -ti tcp:${parsedIntent.port} | xargs kill -9`,
        `Kill process on port ${parsedIntent.port}`
      );

    case 'stage_files': {
      const candidateEntries = extractedFiles.length > 0
        ? extractedFiles
        : (getGitStatusEntries(cwd).length > 0 ? getGitStatusEntries(cwd) : getWorkspaceEntries(cwd));
      const filtered = filterEntries(candidateEntries, parsedIntent.instruction);
      const command = buildStageCommand(filtered, cwd);
      return command ? normalizeIntent(command, 'Stage filtered files from real repository state') : null;
    }

    case 'delete_oldest': {
      const filtered = filterEntries(extractedFiles, parsedIntent.instruction);
      const command = buildDeleteOldestCommand(filtered, cwd, os, parsedIntent.quantity || 1);
      return command ? normalizeIntent(command, 'Delete oldest files from previous output') : null;
    }

    default:
      return null;
  }
}
