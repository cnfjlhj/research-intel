#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  DEFAULT_CLAUDE_CODE_HTML_MODEL,
  DEFAULT_CLAUDE_CODE_HTML_TIMEOUT_MS
} = require('./claude-code-enhancement-config');
const { resolveClaudeCodeLaunchSpec, buildClaudeCodeRuntimePath } = require('./claude-code-cli');
const { cleanHtmlResponse, resolveAttachedPageImages } = require('./codex-html');

const CLAUDE_CODE_HTML_NO_OUTPUT_STALL_MS = 2700000;
const CLAUDE_CODE_SPAWN_MAX_BUFFER = 20 * 1024 * 1024;

function ensureDir(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
}

function safeStatSync(filePath) {
  if (!filePath) {
    return null;
  }
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function shortStableHash(...parts) {
  return crypto.createHash('sha1').update(parts.join('|'), 'utf8').digest('hex').slice(0, 8);
}

function sanitizeSessionSegment(value, maxLength = 18) {
  const normalized = String(value || '')
    .replace(/\.(response|message|raw)$/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .toLowerCase();

  if (!normalized) {
    return 'run';
  }

  return normalized.slice(0, maxLength).replace(/-+$/g, '') || 'run';
}

function isHtmlDocument(text) {
  const normalized = String(text || '');
  return (/^<!doctype html/i.test(normalized) || /^<html/i.test(normalized))
    && /<\/html>/i.test(normalized);
}

function buildClaudeCodeHtmlRunPaths({
  workingDir,
  targetHtmlPath,
  finalMessagePath
}) {
  const phaseSegment = sanitizeSessionSegment(path.basename(finalMessagePath || '', path.extname(finalMessagePath || '')), 28);
  const hash = shortStableHash(workingDir, targetHtmlPath, finalMessagePath);
  const runtimeDir = path.join(workingDir, '.claude-code-html-runs', `${phaseSegment}-${hash}`);

  return {
    runtimeDir,
    promptPath: path.join(runtimeDir, 'prompt.md'),
    configPath: path.join(runtimeDir, 'runner-config.json'),
    statusPath: path.join(runtimeDir, 'status.json'),
    stdoutPath: path.join(runtimeDir, 'stdout.log'),
    stderrPath: path.join(runtimeDir, 'stderr.log')
  };
}

function readRecoverableHtmlFromWorkingDir({
  workingDir,
  previousWorkingDirHtmlStat
}) {
  const workingDirHtmlPath = path.join(workingDir, 'index.html');
  const currentStat = safeStatSync(workingDirHtmlPath);
  if (!currentStat) {
    return null;
  }

  if (previousWorkingDirHtmlStat
    && previousWorkingDirHtmlStat.mtimeMs === currentStat.mtimeMs
    && previousWorkingDirHtmlStat.size === currentStat.size) {
    return null;
  }

  const rawWorkingDirHtml = fs.readFileSync(workingDirHtmlPath, 'utf8');
  const recoveredHtml = cleanHtmlResponse(rawWorkingDirHtml);
  if (!isHtmlDocument(recoveredHtml)) {
    return null;
  }

  return {
    recoveredHtml,
    workingDirHtmlPath,
    stat: currentStat
  };
}

function recoverHtmlFromWorkingDir({
  workingDir,
  targetHtmlPath,
  finalMessagePath,
  previousWorkingDirHtmlStat
}) {
  const recoverableHtml = readRecoverableHtmlFromWorkingDir({
    workingDir,
    previousWorkingDirHtmlStat
  });
  if (!recoverableHtml) {
    return null;
  }

  ensureDir(path.dirname(finalMessagePath));
  ensureDir(path.dirname(targetHtmlPath));
  fs.writeFileSync(finalMessagePath, `${recoverableHtml.recoveredHtml}\n`, 'utf8');
  fs.writeFileSync(targetHtmlPath, `${recoverableHtml.recoveredHtml}\n`, 'utf8');

  return {
    recoveredHtml: recoverableHtml.recoveredHtml,
    workingDirHtmlPath: recoverableHtml.workingDirHtmlPath
  };
}

function spawnClaudeCodeProcess({
  command,
  args,
  cwd,
  env,
  inputText,
  stdoutPath,
  stderrPath,
  statusPath,
  timeoutMs
}) {
  return new Promise((resolve, reject) => {
    const stdoutChunks = [];
    const stderrChunks = [];
    let killed = false;
    let timeoutHandle = null;

    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: CLAUDE_CODE_SPAWN_MAX_BUFFER
    });

    child.stdout.on('data', (chunk) => {
      stdoutChunks.push(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderrChunks.push(chunk);
    });

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // already dead
          }
        }, 5000);
      }, timeoutMs);
    }

    child.on('close', (exitCode, signal) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');

      try {
        fs.writeFileSync(stdoutPath, stdout, 'utf8');
      } catch {
        // best-effort log
      }
      try {
        fs.writeFileSync(stderrPath, stderr, 'utf8');
      } catch {
        // best-effort log
      }

      const status = {
        status: killed ? 'timeout' : (exitCode === 0 ? 'completed' : 'failed'),
        exitCode: exitCode ?? -1,
        signal: signal || '',
        killed,
        durationMs: 0
      };
      try {
        fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
      } catch {
        // best-effort log
      }

      resolve({
        exitCode: exitCode ?? -1,
        signal: signal || '',
        killed,
        stdout,
        stderr,
        status
      });
    });

    child.on('error', (error) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      reject(error);
    });

    if (inputText) {
      child.stdin.write(inputText);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

function buildClaudeCodeSystemPrompt(workingDir) {
  return [
    '你是一个学术论文阅读页面生成专家。',
    '你的唯一任务是根据提供的提示，在工作目录中生成一个高质量的 index.html 文件。',
    '',
    '关键规则：',
    `1. 工作目录是 ${workingDir}`,
    '2. 你必须使用 Write 工具将完整的 HTML 写入 index.html',
    '3. HTML 必须是完全自包含的单文件（所有 CSS 内联，不引用任何远程资源）',
    '4. 不要使用 Tailwind CDN、Google Fonts 或任何外部 CDN 资源',
    '5. KaTeX 公式使用本地 assets/katex/ 目录的资源（如果存在）',
    '6. 你可以使用 Read 工具查看工作目录中的论文图片（pages/ 目录）',
    '7. 完成 HTML 写入后，立即结束，不要做多余的事',
    '8. 输出简短的完成确认即可，HTML 内容写入文件而非打印到 stdout'
  ].join('\n');
}

async function runClaudeCodeHtmlGeneration({
  workingDir,
  targetHtmlPath,
  finalMessagePath,
  promptText,
  attachedPageImages,
  model = DEFAULT_CLAUDE_CODE_HTML_MODEL,
  timeoutMs = DEFAULT_CLAUDE_CODE_HTML_TIMEOUT_MS,
  noOutputStallMs = CLAUDE_CODE_HTML_NO_OUTPUT_STALL_MS
}) {
  const runLabel = `claude-code-${shortStableHash(workingDir, targetHtmlPath, finalMessagePath)}`;
  const previousWorkingDirHtmlStat = safeStatSync(path.join(workingDir, 'index.html'));
  const runtimePaths = buildClaudeCodeHtmlRunPaths({
    workingDir,
    targetHtmlPath,
    finalMessagePath
  });

  const sortedImages = resolveAttachedPageImages(attachedPageImages);

  let fullPrompt = promptText;
  if (sortedImages.length > 0) {
    fullPrompt += '\n\n## 论文证据页面图片\n\n';
    fullPrompt += '以下是论文关键页面的图片路径，请使用 Read 工具查看这些图片以获取视觉信息（图表、公式、架构图等）：\n\n';
    for (const imagePath of sortedImages) {
      fullPrompt += `- \`${imagePath}\`\n`;
    }
  }

  const launchSpec = resolveClaudeCodeLaunchSpec({
    env: process.env,
    nodeBinary: process.execPath
  });

  const claudeArgs = [
    ...launchSpec.argsPrefix,
    '-p',
    '--model', model,
    '--dangerously-skip-permissions',
    '--no-session-persistence',
    '--add-dir', workingDir,
    '--system-prompt', buildClaudeCodeSystemPrompt(workingDir),
    '--tools', 'Read,Write,Edit,Bash,Glob,Grep'
  ];

  const runEnv = {
    ...process.env,
    PATH: buildClaudeCodeRuntimePath(process.env.PATH, launchSpec.claudeBinary)
  };

  ensureDir(runtimePaths.runtimeDir);
  fs.writeFileSync(runtimePaths.promptPath, fullPrompt, 'utf8');
  fs.writeFileSync(runtimePaths.configPath, `${JSON.stringify({
    command: launchSpec.command,
    args: claudeArgs,
    cwd: workingDir,
    inputPath: runtimePaths.promptPath,
    stdoutPath: runtimePaths.stdoutPath,
    stderrPath: runtimePaths.stderrPath,
    statusPath: runtimePaths.statusPath,
    finalMessagePath
  }, null, 2)}\n`, 'utf8');

  const startedAtMs = Date.now();
  let processResult = null;
  let processError = null;

  try {
    processResult = await spawnClaudeCodeProcess({
      command: launchSpec.command,
      args: claudeArgs,
      cwd: workingDir,
      env: runEnv,
      inputText: fullPrompt,
      stdoutPath: runtimePaths.stdoutPath,
      stderrPath: runtimePaths.stderrPath,
      statusPath: runtimePaths.statusPath,
      timeoutMs
    });
  } catch (error) {
    processError = error;
  }

  const durationMs = Date.now() - startedAtMs;
  const stdout = processResult?.stdout
    || (fs.existsSync(runtimePaths.stdoutPath) ? fs.readFileSync(runtimePaths.stdoutPath, 'utf8') : '');
  const stderr = processResult?.stderr
    || (fs.existsSync(runtimePaths.stderrPath) ? fs.readFileSync(runtimePaths.stderrPath, 'utf8') : '');

  const recoveredHtml = recoverHtmlFromWorkingDir({
    workingDir,
    targetHtmlPath,
    finalMessagePath,
    previousWorkingDirHtmlStat
  });
  if (recoveredHtml) {
    return {
      stdout,
      stderr,
      finalMessage: recoveredHtml.recoveredHtml,
      sessionName: runLabel,
      status: processResult?.status || {
        status: 'recovered_from_working_dir',
        exitCode: 0,
        signal: '',
        durationMs
      },
      recoveredFromWorkingDir: true,
      recoveredWorkingDirHtmlPath: recoveredHtml.workingDirHtmlPath
    };
  }

  if (processError) {
    throw processError;
  }

  if (processResult.killed) {
    throw new Error(`Claude Code HTML generation timed out after ${Math.round(timeoutMs / 1000)}s (session: ${runLabel})`);
  }

  if (processResult.exitCode !== 0) {
    throw new Error(
      `claude -p failed (exit=${processResult.exitCode}${processResult.signal ? `, signal=${processResult.signal}` : ''}) `
      + `[session: ${runLabel}]\nstderr (last 2000 chars): ${stderr.slice(-2000)}`
    );
  }

  const stdoutHtml = cleanHtmlResponse(stdout);
  if (isHtmlDocument(stdoutHtml)) {
    ensureDir(path.dirname(finalMessagePath));
    ensureDir(path.dirname(targetHtmlPath));
    fs.writeFileSync(finalMessagePath, `${stdoutHtml}\n`, 'utf8');
    fs.writeFileSync(targetHtmlPath, `${stdoutHtml}\n`, 'utf8');

    return {
      stdout,
      stderr,
      finalMessage: stdoutHtml,
      sessionName: runLabel,
      status: processResult.status,
      recoveredFromWorkingDir: false,
      recoveredWorkingDirHtmlPath: ''
    };
  }

  if (fs.existsSync(finalMessagePath)) {
    const rawFinalMessage = fs.readFileSync(finalMessagePath, 'utf8');
    if (rawFinalMessage.trim()) {
      const html = cleanHtmlResponse(rawFinalMessage);
      if (isHtmlDocument(html)) {
        fs.writeFileSync(targetHtmlPath, `${html}\n`, 'utf8');
        return {
          stdout,
          stderr,
          finalMessage: rawFinalMessage,
          sessionName: runLabel,
          status: processResult.status,
          recoveredFromWorkingDir: false,
          recoveredWorkingDirHtmlPath: ''
        };
      }
    }
  }

  throw new Error(
    `Claude Code did not produce valid HTML output [session: ${runLabel}]. `
    + `stdout preview: ${stdout.slice(0, 500)}`
  );
}

module.exports = {
  buildClaudeCodeHtmlRunPaths,
  runClaudeCodeHtmlGeneration
};
