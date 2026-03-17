#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runCommandWithTimeout } = require('../scripts/research-intel/lib/process-runner');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

test('detached command runner tolerates commands that close stdin immediately', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-detached-runner-epipe-'));
  const inputPath = path.join(tempDir, 'prompt.txt');
  const stdoutPath = path.join(tempDir, 'stdout.log');
  const stderrPath = path.join(tempDir, 'stderr.log');
  const statusPath = path.join(tempDir, 'status.json');
  const configPath = path.join(tempDir, 'runner-config.json');
  const runnerPath = path.join(__dirname, '..', 'scripts', 'research-intel', 'lib', 'detached-command-runner.js');

  fs.writeFileSync(inputPath, 'hello runner', 'utf8');
  fs.writeFileSync(configPath, JSON.stringify({
    command: process.execPath,
    args: ['-e', 'process.exit(0)'],
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
  assert.equal(fs.readFileSync(stderrPath, 'utf8'), '');
});

test('detached command runner publishes a running heartbeat before the child exits', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-detached-runner-heartbeat-'));
  const stdoutPath = path.join(tempDir, 'stdout.log');
  const stderrPath = path.join(tempDir, 'stderr.log');
  const statusPath = path.join(tempDir, 'status.json');
  const configPath = path.join(tempDir, 'runner-config.json');
  const runnerPath = path.join(__dirname, '..', 'scripts', 'research-intel', 'lib', 'detached-command-runner.js');

  fs.writeFileSync(configPath, JSON.stringify({
    command: process.execPath,
    args: [
      '-e',
      [
        'setTimeout(() => {',
        '  process.stdout.write("late-stdout");',
        '  process.stderr.write("late-stderr");',
        '}, 1200);',
        'setTimeout(() => process.exit(0), 1700);'
      ].join(' ')
    ],
    cwd: tempDir,
    stdoutPath,
    stderrPath,
    statusPath
  }, null, 2), 'utf8');

  const child = spawn(process.execPath, [runnerPath, configPath], {
    cwd: tempDir,
    stdio: 'ignore'
  });

  let runningStatus = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (fs.existsSync(statusPath)) {
      const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
      if (status.status === 'running') {
        runningStatus = status;
        break;
      }
    }
    await sleep(100);
  }

  assert.ok(runningStatus, 'expected a running heartbeat status before completion');
  assert.equal(runningStatus.exitCode, null);
  assert.equal(runningStatus.pid > 0, true);
  assert.equal(runningStatus.stdoutBytes, 0);

  await new Promise((resolve, reject) => {
    child.on('exit', code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`runner exited with code ${code}`));
    });
    child.on('error', reject);
  });

  const finalStatus = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  assert.equal(finalStatus.status, 'completed');
  assert.equal(finalStatus.stdoutBytes > 0, true);
  assert.equal(finalStatus.stderrBytes > 0, true);
  assert.equal(finalStatus.lastOutputAt.length > 0, true);
});

test('detached command runner does not hang when a grandchild keeps stderr open after parent exit', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-detached-runner-grandchild-'));
  const stdoutPath = path.join(tempDir, 'stdout.log');
  const stderrPath = path.join(tempDir, 'stderr.log');
  const statusPath = path.join(tempDir, 'status.json');
  const configPath = path.join(tempDir, 'runner-config.json');
  const runnerPath = path.join(__dirname, '..', 'scripts', 'research-intel', 'lib', 'detached-command-runner.js');

  fs.writeFileSync(configPath, JSON.stringify({
    command: process.execPath,
    args: [
      '-e',
      [
        'const { spawn } = require("child_process");',
        'spawn(process.execPath, ["-e", "setTimeout(() => {}, 4000)"], {',
        '  detached: true,',
        '  stdio: ["ignore", "ignore", "inherit"]',
        '}).unref();',
        'process.stderr.write("parent-before-exit");',
        'process.exit(0);'
      ].join(' ')
    ],
    cwd: tempDir,
    stdoutPath,
    stderrPath,
    statusPath
  }, null, 2), 'utf8');

  await runCommandWithTimeout({
    command: process.execPath,
    args: [runnerPath, configPath],
    cwd: tempDir,
    timeoutMs: 2500
  });

  const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  assert.equal(status.status, 'completed');
  assert.equal(status.exitCode, 0);
  assert.match(fs.readFileSync(stderrPath, 'utf8'), /parent-before-exit/);
});
