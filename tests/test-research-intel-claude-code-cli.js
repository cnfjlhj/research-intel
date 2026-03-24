#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildClaudeCodeRuntimePath, resolveClaudeCodeBinary, resolveClaudeCodeLaunchSpec } = require('../scripts/research-intel/lib/claude-code-cli');

function writeExecutable(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '#!/usr/bin/env bash\nexit 0\n', 'utf8');
  fs.chmodSync(filePath, 0o755);
}

test('resolveClaudeCodeBinary prefers an explicit executable override', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-claude-cli-'));
  const explicitPath = path.join(rootDir, 'custom', 'claude');
  writeExecutable(explicitPath);

  const actual = resolveClaudeCodeBinary({
    HOME: rootDir,
    PATH: '',
    RESEARCH_INTEL_CLAUDE_CODE_BIN: explicitPath
  });

  assert.equal(actual, explicitPath);
});

test('resolveClaudeCodeBinary falls back to PATH when available', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-claude-path-'));
  const binDir = path.join(rootDir, 'bin');
  const claudePath = path.join(binDir, 'claude');
  writeExecutable(claudePath);

  const actual = resolveClaudeCodeBinary({
    HOME: rootDir,
    PATH: `${binDir}${path.delimiter}/usr/bin`
  });

  assert.equal(actual, claudePath);
});

test('resolveClaudeCodeBinary falls back to the newest fnm-installed claude binary', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-claude-fnm-'));
  const olderPath = path.join(homeDir, '.local', 'share', 'fnm', 'node-versions', 'v20.10.0', 'installation', 'bin', 'claude');
  const newerPath = path.join(homeDir, '.local', 'share', 'fnm', 'node-versions', 'v24.3.0', 'installation', 'bin', 'claude');
  writeExecutable(olderPath);
  writeExecutable(newerPath);

  const actual = resolveClaudeCodeBinary({
    HOME: homeDir,
    PATH: ''
  });

  assert.equal(actual, newerPath);
});

test('resolveClaudeCodeBinary falls back to the newest nvm-installed claude binary', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-claude-nvm-'));
  const olderPath = path.join(homeDir, '.nvm', 'versions', 'node', 'v20.10.0', 'bin', 'claude');
  const newerPath = path.join(homeDir, '.nvm', 'versions', 'node', 'v22.22.0', 'bin', 'claude');
  writeExecutable(olderPath);
  writeExecutable(newerPath);

  const actual = resolveClaudeCodeBinary({
    HOME: homeDir,
    PATH: ''
  });

  assert.equal(actual, newerPath);
});

test('buildClaudeCodeRuntimePath prepends the claude directory when the binary is absolute', () => {
  const actual = buildClaudeCodeRuntimePath('/usr/bin:/bin', '/root/.local/share/fnm/node-versions/v24.3.0/installation/bin/claude');

  assert.equal(actual, `/root/.local/share/fnm/node-versions/v24.3.0/installation/bin${path.delimiter}/usr/bin${path.delimiter}/bin`);
});

test('resolveClaudeCodeLaunchSpec runs npm-style claude shims through the current node binary', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-claude-launch-'));
  const nodeBinary = path.join(rootDir, 'bin', 'node');
  const claudeBinary = path.join(rootDir, 'bin', 'claude');
  writeExecutable(nodeBinary);
  fs.writeFileSync(claudeBinary, '#!/usr/bin/env node\nconsole.log("claude");\n', 'utf8');
  fs.chmodSync(claudeBinary, 0o755);

  const actual = resolveClaudeCodeLaunchSpec({
    env: {
      HOME: rootDir,
      PATH: path.join(rootDir, 'bin')
    },
    nodeBinary
  });

  assert.deepEqual(actual, {
    command: nodeBinary,
    argsPrefix: [claudeBinary],
    claudeBinary
  });
});
