#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

function isExecutable(filePath) {
  if (!filePath) {
    return false;
  }

  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function resolveClaudeCodeFromPath(pathValue) {
  return String(pathValue || '')
    .split(path.delimiter)
    .map(segment => segment.trim())
    .filter(Boolean)
    .map(segment => path.join(segment, 'claude'))
    .find(isExecutable) || '';
}

function resolveNewestFnmClaude(homeDir) {
  const versionsDir = path.join(homeDir, '.local', 'share', 'fnm', 'node-versions');
  if (!fs.existsSync(versionsDir)) {
    return '';
  }

  const versionDirs = fs.readdirSync(versionsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right, undefined, {
      numeric: true,
      sensitivity: 'base'
    }))
    .reverse();

  for (const versionDir of versionDirs) {
    const candidate = path.join(versionsDir, versionDir, 'installation', 'bin', 'claude');
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return '';
}

function resolveNewestNvmClaude(homeDir) {
  const versionsDir = path.join(homeDir, '.nvm', 'versions', 'node');
  if (!fs.existsSync(versionsDir)) {
    return '';
  }

  const versionDirs = fs.readdirSync(versionsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right, undefined, {
      numeric: true,
      sensitivity: 'base'
    }))
    .reverse();

  for (const versionDir of versionDirs) {
    const candidate = path.join(versionsDir, versionDir, 'bin', 'claude');
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return '';
}

function resolveClaudeCodeBinary(env = process.env) {
  const explicitCandidates = [
    env.RESEARCH_INTEL_CLAUDE_CODE_BIN,
    env.CLAUDE_CODE_BIN
  ];
  for (const candidate of explicitCandidates) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  const pathCandidate = resolveClaudeCodeFromPath(env.PATH);
  if (pathCandidate) {
    return pathCandidate;
  }

  const homeDir = String(env.HOME || os.homedir() || '').trim();
  const fallbackCandidates = [
    homeDir ? resolveNewestFnmClaude(homeDir) : '',
    homeDir ? resolveNewestNvmClaude(homeDir) : '',
    homeDir ? path.join(homeDir, '.local', 'bin', 'claude') : '',
    homeDir ? path.join(homeDir, 'bin', 'claude') : '',
    '/usr/local/bin/claude',
    '/usr/bin/claude'
  ];
  for (const candidate of fallbackCandidates) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return 'claude';
}

function shouldLaunchClaudeCodeWithNode(claudeBinary) {
  if (!path.isAbsolute(claudeBinary) || !fs.existsSync(claudeBinary)) {
    return false;
  }

  try {
    const header = fs.readFileSync(claudeBinary, 'utf8').slice(0, 160);
    return /^#!.*\bnode\b/m.test(header);
  } catch {
    return false;
  }
}

function buildClaudeCodeRuntimePath(pathValue = '', claudeBinary = '') {
  const entries = String(pathValue || '')
    .split(path.delimiter)
    .map(segment => segment.trim())
    .filter(Boolean);

  if (path.isAbsolute(claudeBinary)) {
    const claudeDir = path.dirname(claudeBinary);
    if (!entries.includes(claudeDir)) {
      entries.unshift(claudeDir);
    }
  }

  return entries.join(path.delimiter);
}

function resolveClaudeCodeLaunchSpec({
  env = process.env,
  nodeBinary = process.execPath
} = {}) {
  const claudeBinary = resolveClaudeCodeBinary(env);

  if (shouldLaunchClaudeCodeWithNode(claudeBinary) && isExecutable(nodeBinary)) {
    return {
      command: nodeBinary,
      argsPrefix: [claudeBinary],
      claudeBinary
    };
  }

  return {
    command: claudeBinary,
    argsPrefix: [],
    claudeBinary
  };
}

module.exports = {
  buildClaudeCodeRuntimePath,
  resolveClaudeCodeBinary,
  resolveClaudeCodeLaunchSpec
};
