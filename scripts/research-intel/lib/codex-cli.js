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

function resolveCodexFromPath(pathValue) {
  return String(pathValue || '')
    .split(path.delimiter)
    .map(segment => segment.trim())
    .filter(Boolean)
    .map(segment => path.join(segment, 'codex'))
    .find(isExecutable) || '';
}

function resolveNewestNvmCodex(homeDir) {
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
    const candidate = path.join(versionsDir, versionDir, 'bin', 'codex');
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return '';
}

function resolveCodexBinary(env = process.env) {
  const explicitCandidates = [
    env.RESEARCH_INTEL_CODEX_BIN,
    env.CODEX_BIN
  ];
  for (const candidate of explicitCandidates) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  const pathCandidate = resolveCodexFromPath(env.PATH);
  if (pathCandidate) {
    return pathCandidate;
  }

  const homeDir = String(env.HOME || os.homedir() || '').trim();
  const fallbackCandidates = [
    homeDir ? resolveNewestNvmCodex(homeDir) : '',
    homeDir ? path.join(homeDir, '.local', 'bin', 'codex') : '',
    homeDir ? path.join(homeDir, 'bin', 'codex') : '',
    '/usr/local/bin/codex',
    '/usr/bin/codex'
  ];
  for (const candidate of fallbackCandidates) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return 'codex';
}

function shouldLaunchCodexWithNode(codexBinary) {
  if (!path.isAbsolute(codexBinary) || !fs.existsSync(codexBinary)) {
    return false;
  }

  try {
    const header = fs.readFileSync(codexBinary, 'utf8').slice(0, 160);
    return /^#!.*\bnode\b/m.test(header);
  } catch {
    return false;
  }
}

function buildCodexRuntimePath(pathValue = '', codexBinary = '') {
  const entries = String(pathValue || '')
    .split(path.delimiter)
    .map(segment => segment.trim())
    .filter(Boolean);

  if (path.isAbsolute(codexBinary)) {
    const codexDir = path.dirname(codexBinary);
    if (!entries.includes(codexDir)) {
      entries.unshift(codexDir);
    }
  }

  return entries.join(path.delimiter);
}

function resolveCodexLaunchSpec({
  env = process.env,
  nodeBinary = process.execPath
} = {}) {
  const codexBinary = resolveCodexBinary(env);

  if (shouldLaunchCodexWithNode(codexBinary) && isExecutable(nodeBinary)) {
    return {
      command: nodeBinary,
      argsPrefix: [codexBinary],
      codexBinary
    };
  }

  return {
    command: codexBinary,
    argsPrefix: [],
    codexBinary
  };
}

module.exports = {
  buildCodexRuntimePath,
  resolveCodexBinary,
  resolveCodexLaunchSpec
};
