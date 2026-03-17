#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../../.env'), quiet: true });

const { loadProfile } = require('./lib/profile');
const {
  ACTIVE_RUN_STATUSES,
  buildRuntimePaths,
  buildProjectTrustConfigOverride,
  buildStartupInteractionPlan,
  buildWorkerPrompt,
  buildWorkerSessionName
} = require('./lib/worker');
const { buildCodexRuntimePath, resolveCodexLaunchSpec } = require('./lib/codex-cli');

const ROOT_DIR = path.join(__dirname, '../..');
const DEFAULT_PROFILE_DIR = path.join(ROOT_DIR, 'work/research-intel/profile');
const DEFAULT_BASE_DIR = path.join(ROOT_DIR, 'work/research-intel');
const DEFAULT_RECORDS_DIR = path.join(ROOT_DIR, 'research-intel-records');
const DEFAULT_SESSION_BASE = 'research-intel-codex';

function parseArgs(argv) {
  const options = {
    profileDir: DEFAULT_PROFILE_DIR,
    baseDir: DEFAULT_BASE_DIR,
    recordsDir: DEFAULT_RECORDS_DIR,
    sessionBase: DEFAULT_SESSION_BASE,
    staleAfterSec: 20 * 60,
    monitorIntervalSec: 20,
    dateString: null,
    promptFile: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--profile-dir') {
      options.profileDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (value === '--base-dir') {
      options.baseDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (value === '--records-dir') {
      options.recordsDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (value === '--session-base') {
      options.sessionBase = argv[index + 1];
      index += 1;
    } else if (value === '--stale-after-sec') {
      options.staleAfterSec = Number(argv[index + 1]);
      index += 1;
    } else if (value === '--monitor-interval-sec') {
      options.monitorIntervalSec = Number(argv[index + 1]);
      index += 1;
    } else if (value === '--date') {
      options.dateString = argv[index + 1];
      index += 1;
    } else if (value === '--prompt-file') {
      options.promptFile = path.resolve(argv[index + 1]);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  return options;
}

function ensureDir(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function dateStringInTimezone(timezone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const values = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      values[part.type] = part.value;
    }
  }

  return `${values.year}-${values.month}-${values.day}`;
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function writeText(filePath, text) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, text, 'utf8');
}

function sessionExists(sessionName) {
  const result = spawnSync('tmux', ['has-session', '-t', sessionName], {
    encoding: 'utf8'
  });
  return result.status === 0;
}

function tmux(args) {
  const result = spawnSync('tmux', args, {
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    throw new Error(`tmux ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }

  return (result.stdout || '').trim();
}

function capturePane(sessionName) {
  return tmux(['capture-pane', '-t', sessionName, '-p']);
}

function sendKeys(sessionName, keys) {
  tmux(['send-keys', '-t', sessionName, ...keys]);
}

function killSession(sessionName) {
  const result = spawnSync('tmux', ['kill-session', '-t', sessionName], {
    encoding: 'utf8'
  });
  if (result.status !== 0 && sessionExists(sessionName)) {
    throw new Error(`Failed to kill tmux session ${sessionName}: ${result.stderr || result.stdout}`);
  }
}

function buildWorkerCommand({ projectDir, sessionName, promptPath }) {
  const proxyLines = [];
  for (const key of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'no_proxy', 'NO_PROXY']) {
    if (process.env[key]) {
      proxyLines.push(`export ${key}='${String(process.env[key]).replace(/'/g, `'\\''`)}'`);
    }
  }
  const trustOverride = buildProjectTrustConfigOverride(projectDir);
  const launchSpec = resolveCodexLaunchSpec({
    env: process.env,
    nodeBinary: process.execPath
  });
  const runtimePath = buildCodexRuntimePath(process.env.PATH, launchSpec.codexBinary);
  const launchPrefix = [
    launchSpec.command,
    ...launchSpec.argsPrefix
  ].map(value => `'${String(value).replace(/'/g, `'\\''`)}'`).join(' ');

  return [
    `cd '${projectDir}'`,
    `export TMUX_SESSION='${sessionName}'`,
    `export PATH='${path.join(projectDir, 'bin')}':'${runtimePath.replace(/'/g, `'\\''`)}'`,
    ...proxyLines,
    `PROMPT_FILE='${promptPath}'`,
    'PROMPT="$(cat "$PROMPT_FILE")"',
    `exec ${launchPrefix} --no-alt-screen --dangerously-bypass-approvals-and-sandbox --search -c '${trustOverride.replace(/'/g, `'\\''`)}' -C '${projectDir}' "$PROMPT"`
  ].join('\n');
}

function startCodexSession({ projectDir, sessionName, promptPath }) {
  if (sessionExists(sessionName)) {
    return false;
  }

  const command = buildWorkerCommand({ projectDir, sessionName, promptPath });
  const result = spawnSync('tmux', ['new-session', '-d', '-s', sessionName, 'bash', '-lc', command], {
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(`Failed to start tmux session ${sessionName}: ${result.stderr || result.stdout}`);
  }
  return true;
}

async function clearStartupBlockers(sessionName, attempts = 6, delayMs = 1000) {
  let handledBlocker = false;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const paneText = capturePane(sessionName);
    const interactionPlan = buildStartupInteractionPlan(paneText);
    if (interactionPlan.length === 0) {
      if (handledBlocker) {
        return true;
      }
      await sleep(delayMs);
      continue;
    }

    handledBlocker = true;
    for (const step of interactionPlan) {
      sendKeys(sessionName, step.keys);
    }
    await sleep(delayMs);
  }

  return handledBlocker;
}

function isPidRunning(pid) {
  if (!pid || Number.isNaN(Number(pid))) {
    return false;
  }

  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return false;
  }
}

function ensureMonitorProcess({
  sessionName,
  baseDir,
  runtimePaths,
  staleAfterSec,
  monitorIntervalSec
}) {
  const existingPid = fs.existsSync(runtimePaths.monitorPidPath)
    ? Number(fs.readFileSync(runtimePaths.monitorPidPath, 'utf8').trim())
    : 0;
  if (isPidRunning(existingPid)) {
    return {
      pid: existingPid,
      started: false
    };
  }

  const logPath = path.join(runtimePaths.logsDir, `${sessionName}.monitor.log`);
  ensureDir(path.dirname(logPath));
  const stdoutFd = fs.openSync(logPath, 'a');
  const stderrFd = fs.openSync(logPath, 'a');

  const child = spawn(process.execPath, [
    path.join(__dirname, 'heartbeat-monitor.js'),
    '--session-name', sessionName,
    '--base-dir', baseDir,
    '--stale-after-sec', String(staleAfterSec),
    '--interval-sec', String(monitorIntervalSec)
  ], {
    cwd: ROOT_DIR,
    detached: true,
    stdio: ['ignore', stdoutFd, stderrFd]
  });

  child.unref();
  fs.writeFileSync(runtimePaths.monitorPidPath, `${child.pid}\n`, 'utf8');

  return {
    pid: child.pid,
    started: true
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const profile = loadProfile(options.profileDir);
  const dateString = options.dateString || dateStringInTimezone(profile.timezone || 'Asia/Shanghai');
  const runtimePaths = buildRuntimePaths(options.baseDir);
  const sessionName = buildWorkerSessionName(options.sessionBase, dateString);

  ensureDir(runtimePaths.promptsDir);
  ensureDir(runtimePaths.logsDir);

  const existingRun = readJsonIfExists(runtimePaths.currentRunPath);
  if (
    existingRun
    && existingRun.sessionName === sessionName
    && ACTIVE_RUN_STATUSES.has(existingRun.status)
    && sessionExists(sessionName)
  ) {
    const monitor = ensureMonitorProcess({
      sessionName,
      baseDir: options.baseDir,
      runtimePaths,
      staleAfterSec: options.staleAfterSec,
      monitorIntervalSec: options.monitorIntervalSec
    });
    console.log(JSON.stringify({
      ok: true,
      status: 'already_running',
      sessionName,
      attachCommand: `tmux attach -t ${sessionName}`,
      monitorPid: monitor.pid
    }, null, 2));
    return;
  }

  const promptPath = path.join(runtimePaths.promptsDir, `${dateString}.md`);
  const promptText = options.promptFile
    ? fs.readFileSync(options.promptFile, 'utf8')
    : buildWorkerPrompt({
      dateString,
      projectDir: ROOT_DIR,
      profileDir: options.profileDir,
      baseDir: options.baseDir,
      recordsDir: options.recordsDir,
      runtimePaths
    });
  writeText(promptPath, `${promptText}\n`);

  const submittedState = {
    date: dateString,
    sessionName,
    status: 'submitted',
    requestedAt: new Date().toISOString(),
    promptPath,
    promptSource: options.promptFile || 'generated',
    baseDir: options.baseDir,
    profileDir: options.profileDir,
    recordsDir: options.recordsDir,
    attachCommand: `tmux attach -t ${sessionName}`
  };
  writeJson(runtimePaths.currentRunPath, submittedState);
  writeJson(runtimePaths.monitorStatePath, {
    sessionName,
    requestedAt: submittedState.requestedAt,
    staleAlertSentAt: '',
    recoveryAlertSentAt: '',
    missingSessionAlertSentAt: '',
    lastPaneHash: '',
    lastChangeAt: submittedState.requestedAt
  });

  if (sessionExists(sessionName)) {
    killSession(sessionName);
    await sleep(1000);
  }

  const created = startCodexSession({
    projectDir: ROOT_DIR,
    sessionName,
    promptPath
  });
  await sleep(created ? 2000 : 1000);
  await clearStartupBlockers(sessionName);

  const monitor = ensureMonitorProcess({
    sessionName,
    baseDir: options.baseDir,
    runtimePaths,
    staleAfterSec: options.staleAfterSec,
    monitorIntervalSec: options.monitorIntervalSec
  });

  const finalState = {
    ...submittedState,
    status: 'running',
    monitorPid: monitor.pid,
    promptSubmittedAt: new Date().toISOString(),
    startedAt: new Date().toISOString()
  };
  writeJson(runtimePaths.currentRunPath, finalState);
  writeJson(path.join(runtimePaths.runtimeDir, 'latest-session.json'), {
    date: dateString,
    sessionName,
    attachCommand: `tmux attach -t ${sessionName}`,
    promptPath,
    updatedAt: new Date().toISOString()
  });

  console.log(JSON.stringify({
    ok: true,
    status: 'submitted',
    date: dateString,
    sessionName,
    createdSession: created,
    promptPath,
    currentRunPath: runtimePaths.currentRunPath,
    heartbeatPath: runtimePaths.heartbeatPath,
    attachCommand: `tmux attach -t ${sessionName}`,
    monitorPid: monitor.pid
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
