#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildWorkerCommand } = require('../scripts/research-intel/lib/codex-supervisor');

test('buildWorkerCommand sources runtime.env before launching codex', () => {
  const command = buildWorkerCommand({
    projectDir: '/repo',
    sessionName: 'research-intel-codex-20260317',
    promptPath: '/repo/work/research-intel/runtime/prompts/2026-03-17.md',
    runtimeEnvPath: '/repo/work/research-intel/profile/runtime.env',
    env: {
      PATH: '/usr/local/bin:/usr/bin',
      http_proxy: 'http://127.0.0.1:8080'
    },
    nodeBinary: '/usr/bin/node'
  });

  assert.match(command, /RUNTIME_ENV_FILE='\/repo\/work\/research-intel\/profile\/runtime\.env'/);
  assert.match(command, /if \[ -f "\$RUNTIME_ENV_FILE" \]; then/);
  assert.match(command, /set -a/);
  assert.match(command, /\. "\$RUNTIME_ENV_FILE"/);
  assert.match(command, /set \+a/);
});
