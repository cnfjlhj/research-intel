#!/usr/bin/env node

const crypto = require('crypto');
const path = require('path');

const ACTIVE_RUN_STATUSES = new Set([
  'submitted',
  'running',
  'stale'
]);

const FINAL_RUN_STATUSES = new Set([
  'completed',
  'failed',
  'session_missing',
  'cancelled'
]);

function buildRuntimePaths(baseDir) {
  const runtimeDir = path.join(baseDir, 'runtime');
  return {
    runtimeDir,
    promptsDir: path.join(runtimeDir, 'prompts'),
    logsDir: path.join(runtimeDir, 'logs'),
    heartbeatPath: path.join(runtimeDir, 'heartbeat.json'),
    currentRunPath: path.join(runtimeDir, 'current-run.json'),
    workerProgressPath: path.join(runtimeDir, 'worker-progress.md'),
    monitorPidPath: path.join(runtimeDir, 'heartbeat-monitor.pid'),
    monitorStatePath: path.join(runtimeDir, 'heartbeat-monitor-state.json')
  };
}

function buildWorkerSessionName(baseSessionName, dateString) {
  return `${String(baseSessionName || 'research-intel-codex').replace(/-+$/g, '')}-${String(dateString || '').replace(/[^0-9]/g, '')}`;
}

function buildProjectTrustConfigOverride(projectDir) {
  return `projects."${String(projectDir || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}".trust_level="trusted"`;
}

function buildWorkerPrompt({
  dateString,
  projectDir,
  profileDir,
  baseDir,
  recordsDir,
  runtimePaths
}) {
  const runtimeEnvPath = path.join(profileDir, 'runtime.env');
  const methodTreeNotesPath = path.join(profileDir, 'method_tree_notes.md');
  const methodTreeMarkdownPath = path.join(recordsDir, 'knowledge', 'method_tree.md');
  const runsHistoryPath = path.join(recordsDir, 'history', 'runs.jsonl');
  const sentHistoryPath = path.join(recordsDir, 'history', 'sent_papers.jsonl');

  return [
    `你现在是 Research Intelligence 的 Codex orchestrator worker，目标日期是 ${dateString}。`,
    `你正在仓库 ${projectDir} 中执行，不要停在方案、分析或半成品。`,
    '',
    '先读取这些上下文文件并据此行动：',
    `- ${path.join(profileDir, 'research_brief.md')}`,
    `- ${path.join(profileDir, 'seed_papers.jsonl')}`,
    `- ${path.join(profileDir, 'feedback.jsonl')}`,
    `- ${methodTreeNotesPath}`,
    `- ${methodTreeMarkdownPath}`,
    `- ${runsHistoryPath}`,
    `- ${sentHistoryPath}`,
    '',
    '运行时状态要求：',
    `- 一开始就更新 ${runtimePaths.currentRunPath}，把状态写成 running，并写入 startedAt。`,
    `- 每推进一个重要阶段，都向 ${runtimePaths.workerProgressPath} 追加 1-3 句简短进展。`,
    `- 完成后再次更新 ${runtimePaths.currentRunPath}，把状态写成 completed 或 failed，并写入关键产物路径。`,
    '',
    '必须完成的交付：',
    '- 选出今天真正值得进入主链的论文，数量保持在 3 到 8 篇之间，优先最新方法论文。',
    '- 做严格去重，避免重复标题、重复版本、重复来源。',
    '- 每篇入选论文都必须先拿到原始 paper.pdf；paper.pdf 是唯一真相来源，辅助文本、页面图像和 OpenReview 只用于定位与核对。',
    '- 每篇入选论文都必须保留 OpenReview 信息、相关媒体/博客链接、是否有开源代码。',
    '- 每篇入选论文都必须在独立 paper workspace、独立 Codex tmux session 中产出完整 index.html，而不是摘要替代品。',
    '- 每篇入选论文都必须额外沉淀一个结构化的 paper_card.json，作为后续知识网络更新的增量输入。',
    '- 每个 HTML 都必须做本地浏览器校验；如果校验失败，先记录未通过的明确缺口，并优先开启新的 paper-scoped fresh generation attempt，而不是围绕同一份 HTML 做补丁式 repair 叙事。',
    '- 更新每日 brief、reading order、selected papers、method tree、method tree delta 与长期 knowledge 主文件。',
    '- 如果当前运行显式开启 Telegram，再发送汇总包和分论文包，并把历史记录写回；不要把 Telegram 当成主链成功与否的唯一判据。',
    '- 为 research-intel-records 做 git commit，保留网络图和每日记录的演化历史。',
    '- 禁止任何“应急发布/保底发布”策略：如果 arXiv、OpenReview、web search 或其他发现链路因为 429、限流、网络故障、解析失败拿不到今天的真实候选池，不得改用昨天的 backup、历史 shortlist、unsent papers、manual shortlist、manual_backup_rebuild 或任何手工候选来冒充今天日报。',
    '- 如果今天的真实候选池拿不到，就必须把运行标记为 failed 或 cancelled，并在 worker-progress.md 里明确记录阻塞原因；不要发送 Telegram，不要提交 records，不要把 current-run.json 写成 completed。',
    '',
    '关于实现方式：',
    `- HTML 生成模型链配置在 ${runtimeEnvPath}，必须沿用这里的配置，但配置不是主语；主语始终是当前论文的 paper.pdf。`,
    '- 你可以自主使用仓库内已有的 research-intel 脚本和 lib 作为可靠原语，尤其是已有的下载、HTML 生成、浏览器校验、打包与 Telegram 发送逻辑。',
    `- 如果你判断最快且最稳的路径是调用 ${path.join(baseDir, '..', '..', 'scripts', 'research-intel', 'daily-run.js')}，可以这样做，但你仍然要自己核验产物，补上缺项，并在失败时继续收窄问题边界。`,
    '- 你可以使用 web search 去找最新论文、相关媒体报道、中文长文 blog 与开源代码仓库。',
    `- 在发送 Telegram、提交 research-intel-records 或把 current-run.json 写成 completed 之前，必须运行 node ${path.join(baseDir, '..', '..', 'scripts', 'research-intel', 'verify-daily.js')} --date ${dateString} --disable-notification。`,
    '- 如果 query_results.json 或 candidate_pool.jsonl 里出现 manual_backup_rebuild、backup_rebuild、history_rebuild、fallback 等来源标记，视为发布失败，必须停止，不得继续对外发布。',
    '',
    '验收标准：',
    '- 今日目录里要有清晰的 brief、reading order、manifest、selected_papers 与 method tree。',
    '- 所有入选论文都要有通过校验的 index.html。',
    '- 最终回复只需要简洁说明完成情况、关键路径以及还需人工复核的点。'
  ].join('\n');
}

function detectPaneState(paneText) {
  const sourceText = String(paneText || '');
  const lines = sourceText
    .split('\n')
    .map(line => line.replace(/\r/g, ''));
  const nonEmptyLines = lines.filter(line => line.trim().length > 0);
  const lastNonEmptyLine = nonEmptyLines.length > 0 ? nonEmptyLines[nonEmptyLines.length - 1].trim() : '';
  const tailLines = nonEmptyLines.slice(-5).map(line => line.trim());
  const workspaceTrustPrompt = /Do you trust the contents of this directory/i.test(sourceText);
  const promptReady = tailLines.some(line => /^(›|>|❯)(\s.*)?$/.test(line))
    || tailLines.some(line => /Press \? for shortcuts/i.test(line))
    || tailLines.some(line => /What would you like/i.test(line));

  return {
    lineCount: lines.length,
    lastNonEmptyLine,
    promptReady,
    startupBlocker: workspaceTrustPrompt ? 'workspace_trust_prompt' : ''
  };
}

function buildStartupInteractionPlan(paneText) {
  const paneState = detectPaneState(paneText);
  if (paneState.startupBlocker === 'workspace_trust_prompt') {
    return [{ keys: ['Enter'] }];
  }

  return [];
}

function buildHeartbeatSnapshot({
  sessionName,
  paneText,
  checkedAt = new Date().toISOString(),
  lastChangeAt = checkedAt,
  currentRun = null,
  staleAfterMs = 15 * 60 * 1000,
  alive = true
}) {
  const checkedAtMs = new Date(checkedAt).getTime();
  const lastChangeAtMs = new Date(lastChangeAt).getTime();
  const safeLastChangeAtMs = Number.isFinite(lastChangeAtMs) ? lastChangeAtMs : checkedAtMs;
  const secondsSinceChange = Math.max(0, Math.floor((checkedAtMs - safeLastChangeAtMs) / 1000));
  const paneState = detectPaneState(paneText);

  return {
    sessionName,
    checkedAt,
    lastChangeAt: new Date(safeLastChangeAtMs).toISOString(),
    alive,
    stale: secondsSinceChange * 1000 > staleAfterMs,
    secondsSinceChange,
    promptReady: paneState.promptReady,
    startupBlocker: paneState.startupBlocker,
    lastNonEmptyLine: paneState.lastNonEmptyLine,
    paneHash: crypto.createHash('sha1').update(String(paneText || ''), 'utf8').digest('hex'),
    run: currentRun ? {
      date: currentRun.date || '',
      status: currentRun.status || '',
      sessionName: currentRun.sessionName || sessionName
    } : null
  };
}

function reconcileCurrentRunWithHeartbeat(currentRun, heartbeat) {
  if (!currentRun || typeof currentRun !== 'object') {
    return currentRun;
  }
  if (!currentRun.sessionName && !currentRun.status && !currentRun.date) {
    return currentRun;
  }

  const currentStatus = String(currentRun.status || '');
  if (FINAL_RUN_STATUSES.has(currentStatus)) {
    return currentRun;
  }

  const checkedAt = String(heartbeat?.checkedAt || new Date().toISOString());

  if (heartbeat?.alive === false && ACTIVE_RUN_STATUSES.has(currentStatus)) {
    return {
      ...currentRun,
      status: 'session_missing',
      endedAt: currentRun.endedAt || checkedAt,
      error: currentRun.error || 'tmux session missing'
    };
  }

  if (heartbeat?.stale) {
    return {
      ...currentRun,
      status: 'stale',
      startedAt: currentRun.startedAt || checkedAt,
      staleAt: currentRun.staleAt || checkedAt
    };
  }

  if (heartbeat?.alive) {
    const nextRun = {
      ...currentRun,
      status: 'running',
      startedAt: currentRun.startedAt || checkedAt
    };
    if (currentStatus === 'stale' && !currentRun.recoveredAt) {
      nextRun.recoveredAt = checkedAt;
    }
    return nextRun;
  }

  return currentRun;
}

module.exports = {
  ACTIVE_RUN_STATUSES,
  FINAL_RUN_STATUSES,
  buildRuntimePaths,
  buildWorkerSessionName,
  buildProjectTrustConfigOverride,
  buildWorkerPrompt,
  detectPaneState,
  buildStartupInteractionPlan,
  buildHeartbeatSnapshot,
  reconcileCurrentRunWithHeartbeat
};
