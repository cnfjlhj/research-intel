#!/usr/bin/env node

const path = require('path');

const { buildProjectTrustConfigOverride } = require('./worker');
const { buildCodexRuntimePath, resolveCodexLaunchSpec } = require('./codex-cli');

function shellQuote(value) {
  return `'${String(value || '').replace(/'/g, `'\\''`)}'`;
}

function buildWorkerCommand({
  projectDir,
  sessionName,
  promptPath,
  runtimeEnvPath = '',
  env = process.env,
  nodeBinary = process.execPath
}) {
  const proxyLines = [];
  for (const key of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'no_proxy', 'NO_PROXY']) {
    if (env[key]) {
      proxyLines.push(`export ${key}=${shellQuote(env[key])}`);
    }
  }

  const runtimeEnvLines = [];
  if (runtimeEnvPath) {
    runtimeEnvLines.push(`RUNTIME_ENV_FILE=${shellQuote(runtimeEnvPath)}`);
    runtimeEnvLines.push('if [ -f "$RUNTIME_ENV_FILE" ]; then');
    runtimeEnvLines.push('  set -a');
    runtimeEnvLines.push('  . "$RUNTIME_ENV_FILE"');
    runtimeEnvLines.push('  set +a');
    runtimeEnvLines.push('fi');
  }

  const trustOverride = buildProjectTrustConfigOverride(projectDir);
  const launchSpec = resolveCodexLaunchSpec({
    env,
    nodeBinary
  });
  const runtimePath = buildCodexRuntimePath(env.PATH, launchSpec.codexBinary);
  const workerPath = [
    path.join(projectDir, 'bin'),
    runtimePath
  ].filter(Boolean).join(path.delimiter);
  const launchPrefix = [
    launchSpec.command,
    ...launchSpec.argsPrefix
  ].map(shellQuote).join(' ');

  return [
    `cd ${shellQuote(projectDir)}`,
    `export TMUX_SESSION=${shellQuote(sessionName)}`,
    `export PATH=${shellQuote(workerPath)}`,
    ...proxyLines,
    ...runtimeEnvLines,
    `PROMPT_FILE=${shellQuote(promptPath)}`,
    'PROMPT="$(cat "$PROMPT_FILE")"',
    `exec ${launchPrefix} --no-alt-screen --dangerously-bypass-approvals-and-sandbox --search -c ${shellQuote(trustOverride)} -C ${shellQuote(projectDir)} "$PROMPT"`
  ].join('\n');
}

module.exports = {
  buildWorkerCommand
};
