#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');

const { runCommandWithTimeout } = require('../scripts/research-intel/lib/process-runner');

test('runCommandWithTimeout captures stdout on success', async () => {
  const result = await runCommandWithTimeout({
    command: process.execPath,
    args: ['-e', "process.stdout.write('ok')"],
    timeoutMs: 1000
  });

  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'ok');
  assert.equal(result.stderr, '');
});

test('runCommandWithTimeout rejects with a timeout error', async () => {
  await assert.rejects(
    runCommandWithTimeout({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 5000)'],
      timeoutMs: 100
    }),
    /timed out/i
  );
});
