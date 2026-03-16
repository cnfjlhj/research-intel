#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runCommandWithTimeout } = require('../scripts/research-intel/lib/process-runner');

test('detached command runner writes stdout, stderr, and status using an input file', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-detached-runner-'));
  const inputPath = path.join(tempDir, 'prompt.txt');
  const stdoutPath = path.join(tempDir, 'stdout.log');
  const stderrPath = path.join(tempDir, 'stderr.log');
  const statusPath = path.join(tempDir, 'status.json');
  const configPath = path.join(tempDir, 'runner-config.json');
  const runnerPath = path.join(__dirname, '..', 'scripts', 'research-intel', 'lib', 'detached-command-runner.js');

  fs.writeFileSync(inputPath, 'hello runner', 'utf8');
  fs.writeFileSync(configPath, JSON.stringify({
    command: process.execPath,
    args: [
      '-e',
      [
        'process.stdin.setEncoding("utf8");',
        'let body = "";',
        'process.stdin.on("data", chunk => { body += chunk; });',
        'process.stdin.on("end", () => {',
        '  process.stdout.write(body.toUpperCase());',
        '  process.stderr.write("warning-stream");',
        '});'
      ].join(' ')
    ],
    cwd: tempDir,
    inputPath,
    stdoutPath,
    stderrPath,
    statusPath
  }, null, 2), 'utf8');

  await runCommandWithTimeout({
    command: process.execPath,
    args: [runnerPath, configPath],
    cwd: tempDir,
    timeoutMs: 5000
  });

  const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  assert.equal(status.status, 'completed');
  assert.equal(status.exitCode, 0);
  assert.equal(status.command, process.execPath);
  assert.equal(fs.readFileSync(stdoutPath, 'utf8'), 'HELLO RUNNER');
  assert.equal(fs.readFileSync(stderrPath, 'utf8'), 'warning-stream');
});
