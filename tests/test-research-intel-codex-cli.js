#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildCodexRuntimePath, resolveCodexBinary, resolveCodexLaunchSpec } = require('../scripts/research-intel/lib/codex-cli');

function writeExecutable(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '#!/usr/bin/env bash\nexit 0\n', 'utf8');
  fs.chmodSync(filePath, 0o755);
}

test('resolveCodexBinary prefers an explicit executable override', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-codex-cli-'));
  const explicitPath = path.join(rootDir, 'custom', 'codex');
  writeExecutable(explicitPath);

  const actual = resolveCodexBinary({
    HOME: rootDir,
    PATH: '',
    RESEARCH_INTEL_CODEX_BIN: explicitPath
  });

  assert.equal(actual, explicitPath);
});

test('resolveCodexBinary falls back to PATH when available', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-codex-path-'));
  const binDir = path.join(rootDir, 'bin');
  const codexPath = path.join(binDir, 'codex');
  writeExecutable(codexPath);

  const actual = resolveCodexBinary({
    HOME: rootDir,
    PATH: `${binDir}${path.delimiter}/usr/bin`
  });

  assert.equal(actual, codexPath);
});

test('resolveCodexBinary falls back to the newest nvm-installed codex binary', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-codex-nvm-'));
  const olderPath = path.join(homeDir, '.nvm', 'versions', 'node', 'v20.10.0', 'bin', 'codex');
  const newerPath = path.join(homeDir, '.nvm', 'versions', 'node', 'v22.22.0', 'bin', 'codex');
  writeExecutable(olderPath);
  writeExecutable(newerPath);

  const actual = resolveCodexBinary({
    HOME: homeDir,
    PATH: ''
  });

  assert.equal(actual, newerPath);
});

test('buildCodexRuntimePath prepends the codex directory when the binary is absolute', () => {
  const actual = buildCodexRuntimePath('/usr/bin:/bin', '/root/.nvm/versions/node/v22.22.0/bin/codex');

  assert.equal(actual, `/root/.nvm/versions/node/v22.22.0/bin${path.delimiter}/usr/bin${path.delimiter}/bin`);
});

test('resolveCodexLaunchSpec runs npm-style codex shims through the current node binary', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-codex-launch-'));
  const nodeBinary = path.join(rootDir, 'bin', 'node');
  const codexBinary = path.join(rootDir, 'bin', 'codex');
  writeExecutable(nodeBinary);
  fs.writeFileSync(codexBinary, '#!/usr/bin/env node\nconsole.log(\"codex\");\n', 'utf8');
  fs.chmodSync(codexBinary, 0o755);

  const actual = resolveCodexLaunchSpec({
    env: {
      HOME: rootDir,
      PATH: path.join(rootDir, 'bin')
    },
    nodeBinary
  });

  assert.deepEqual(actual, {
    command: nodeBinary,
    argsPrefix: [codexBinary],
    codexBinary
  });
});
