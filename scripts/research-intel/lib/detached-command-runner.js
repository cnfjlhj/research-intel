#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const FORCE_FINALIZE_AFTER_EXIT_MS = 1000;

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

function nowIso() {
  return new Date().toISOString();
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
  const startedAt = nowIso();
  let settled = false;
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let lastStdoutAt = '';
  let lastStderrAt = '';
  let lastOutputAt = '';
  let exitFinalizeTimer = null;

  function buildRunningStatus(extra = {}) {
    return {
      status: 'running',
      exitCode: null,
      signal: '',
      command,
      args,
      cwd,
      pid: child.pid || null,
      inputPath,
      finalMessagePath,
      stdoutPath,
      stderrPath,
      startedAt,
      updatedAt: nowIso(),
      stdoutBytes,
      stderrBytes,
      lastStdoutAt,
      lastStderrAt,
      lastOutputAt,
      ...extra
    };
  }

  function disconnectChildPipes() {
    for (const stream of [child.stdout, child.stderr]) {
      if (!stream) {
        continue;
      }
      stream.removeAllListeners('data');
      if (typeof stream.destroy === 'function' && !stream.destroyed) {
        stream.destroy();
      }
    }
  }

  async function finalize(extraPayload, exitCode) {
    if (settled) {
      return;
    }
    settled = true;
    clearInterval(heartbeatTimer);
    if (exitFinalizeTimer) {
      clearTimeout(exitFinalizeTimer);
      exitFinalizeTimer = null;
    }
    disconnectChildPipes();
    await Promise.all([
      closeStream(stdoutStream),
      closeStream(stderrStream)
    ]);
    writeStatus(statusPath, {
      ...buildRunningStatus(),
      ...extraPayload,
      updatedAt: nowIso()
    });
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

  const heartbeatTimer = setInterval(() => {
    if (settled) {
      return;
    }
    writeStatus(statusPath, buildRunningStatus());
  }, 1000);
  if (typeof heartbeatTimer.unref === 'function') {
    heartbeatTimer.unref();
  }
  writeStatus(statusPath, buildRunningStatus());

  child.stdout.on('data', chunk => {
    stdoutStream.write(chunk);
    stdoutBytes += chunk.length;
    lastStdoutAt = nowIso();
    lastOutputAt = lastStdoutAt;
  });
  child.stderr.on('data', chunk => {
    stderrStream.write(chunk);
    stderrBytes += chunk.length;
    lastStderrAt = nowIso();
    lastOutputAt = lastStderrAt;
  });
  child.stdin.on('error', error => {
    if (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED') {
      return;
    }
    stderrStream.write(`[detached-command-runner stdin] ${error.stack || error.message}\n`);
  });

  child.on('error', async error => {
    stderrStream.write(`${error.stack || error.message}\n`);
    await finalize({
      status: 'failed',
      endedAt: nowIso(),
      finalizedFrom: 'error',
      error: error.message
    }, 1);
  });

  child.on('exit', (code, signal) => {
    if (settled) {
      return;
    }
    if (exitFinalizeTimer) {
      clearTimeout(exitFinalizeTimer);
    }
    exitFinalizeTimer = setTimeout(() => {
      finalize({
        status: code === 0 ? 'completed' : 'failed',
        exitCode: code,
        signal: signal || '',
        endedAt: nowIso(),
        finalizedFrom: 'exit_grace_timeout'
      }, code === null ? 1 : code);
    }, FORCE_FINALIZE_AFTER_EXIT_MS);
    if (typeof exitFinalizeTimer.unref === 'function') {
      exitFinalizeTimer.unref();
    }
  });

  child.on('close', async (code, signal) => {
    await finalize({
      status: code === 0 ? 'completed' : 'failed',
      exitCode: code,
      signal: signal || '',
      endedAt: nowIso(),
      finalizedFrom: 'close'
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
