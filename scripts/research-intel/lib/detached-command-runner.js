#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeStatus(statusPath, payload) {
  ensureParentDir(statusPath);
  fs.writeFileSync(statusPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function closeStream(stream) {
  return new Promise(resolve => {
    stream.on('finish', resolve);
    stream.end();
  });
}

async function main() {
  const configPath = process.argv[2];
  if (!configPath) {
    throw new Error('Usage: detached-command-runner.js <config-path>');
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const {
    command,
    args = [],
    cwd = process.cwd(),
    env = {},
    inputPath = '',
    input = '',
    stdoutPath,
    stderrPath,
    statusPath,
    finalMessagePath = ''
  } = config;

  if (!command) {
    throw new Error('runner config missing "command"');
  }
  if (!stdoutPath || !stderrPath || !statusPath) {
    throw new Error('runner config missing stdoutPath/stderrPath/statusPath');
  }

  ensureParentDir(stdoutPath);
  ensureParentDir(stderrPath);
  ensureParentDir(statusPath);

  const stdoutStream = fs.createWriteStream(stdoutPath, { flags: 'w' });
  const stderrStream = fs.createWriteStream(stderrPath, { flags: 'w' });
  const startedAt = new Date().toISOString();
  let settled = false;

  async function finalize(payload, exitCode) {
    if (settled) {
      return;
    }
    settled = true;
    await Promise.all([
      closeStream(stdoutStream),
      closeStream(stderrStream)
    ]);
    writeStatus(statusPath, payload);
    process.exit(exitCode);
  }

  const child = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      ...env
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  child.stdout.on('data', chunk => {
    stdoutStream.write(chunk);
  });
  child.stderr.on('data', chunk => {
    stderrStream.write(chunk);
  });

  child.on('error', async error => {
    stderrStream.write(`${error.stack || error.message}\n`);
    await finalize({
      status: 'failed',
      exitCode: null,
      signal: '',
      command,
      args,
      cwd,
      inputPath,
      finalMessagePath,
      stdoutPath,
      stderrPath,
      startedAt,
      endedAt: new Date().toISOString(),
      error: error.message
    }, 1);
  });

  child.on('close', async (code, signal) => {
    await finalize({
      status: code === 0 ? 'completed' : 'failed',
      exitCode: code,
      signal: signal || '',
      command,
      args,
      cwd,
      inputPath,
      finalMessagePath,
      stdoutPath,
      stderrPath,
      startedAt,
      endedAt: new Date().toISOString()
    }, code === null ? 1 : code);
  });

  if (inputPath) {
    child.stdin.end(fs.readFileSync(inputPath));
  } else if (input === undefined || input === null) {
    child.stdin.end();
  } else {
    child.stdin.end(String(input));
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
