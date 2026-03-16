#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ACTIVE_RUN_STATUSES,
  FINAL_RUN_STATUSES,
  buildRuntimePaths,
  buildWorkerSessionName,
  buildWorkerPrompt,
  buildProjectTrustConfigOverride,
  buildStartupInteractionPlan,
  detectPaneState,
  buildHeartbeatSnapshot,
  reconcileCurrentRunWithHeartbeat
} = require('../scripts/research-intel/lib/worker');

test('buildRuntimePaths creates runtime files for supervisor and monitor', () => {
  const paths = buildRuntimePaths('/tmp/research-intel');

  assert.equal(paths.runtimeDir, '/tmp/research-intel/runtime');
  assert.equal(paths.promptsDir, '/tmp/research-intel/runtime/prompts');
  assert.equal(paths.logsDir, '/tmp/research-intel/runtime/logs');
  assert.equal(paths.heartbeatPath, '/tmp/research-intel/runtime/heartbeat.json');
  assert.equal(paths.currentRunPath, '/tmp/research-intel/runtime/current-run.json');
  assert.equal(paths.workerProgressPath, '/tmp/research-intel/runtime/worker-progress.md');
  assert.equal(paths.monitorPidPath, '/tmp/research-intel/runtime/heartbeat-monitor.pid');
});

test('buildWorkerPrompt includes the required context, deliverables, and status updates', () => {
  const prompt = buildWorkerPrompt({
    dateString: '2026-03-14',
    projectDir: '/repo',
    profileDir: '/repo/work/research-intel/profile',
    baseDir: '/repo/work/research-intel',
    recordsDir: '/repo/research-intel-records',
    runtimePaths: buildRuntimePaths('/repo/work/research-intel')
  });

  assert.match(prompt, /research_brief\.md/);
  assert.match(prompt, /seed_papers\.jsonl/);
  assert.match(prompt, /feedback\.jsonl/);
  assert.match(prompt, /method_tree_notes\.md/);
  assert.match(prompt, /method_tree\.md/);
  assert.match(prompt, /sent_papers\.jsonl/);
  assert.match(prompt, /HTML 生成模型链配置在 .*runtime\.env/);
  assert.match(prompt, /3 到 8 篇/);
  assert.match(prompt, /index\.html/);
  assert.match(prompt, /paper_card\.json/);
  assert.match(prompt, /method tree delta/);
  assert.match(prompt, /浏览器校验/);
  assert.match(prompt, /Telegram/);
  assert.match(prompt, /git commit/i);
  assert.match(prompt, /current-run\.json/);
  assert.match(prompt, /worker-progress\.md/);
  assert.match(prompt, /paper\.pdf 是唯一真相来源/);
  assert.match(prompt, /独立 paper workspace、独立 Codex tmux session/);
  assert.match(prompt, /fresh generation attempt/);
  assert.doesNotMatch(prompt, /优先修补已有 HTML/);
});

test('buildWorkerSessionName scopes worker tmux sessions by date', () => {
  assert.equal(
    buildWorkerSessionName('research-intel-codex', '2026-03-14'),
    'research-intel-codex-20260314'
  );
});

test('buildProjectTrustConfigOverride marks the worker project as trusted for this run only', () => {
  assert.equal(
    buildProjectTrustConfigOverride('/root/projects/research-intel'),
    'projects."/root/projects/research-intel".trust_level="trusted"'
  );
});

test('detectPaneState reports prompt-ready Codex panes', () => {
  const state = detectPaneState('some output\n› Write tests for @filename\n  gpt-5.4 xhigh · 100% left');
  assert.equal(state.promptReady, true);
  assert.equal(state.lastNonEmptyLine, 'gpt-5.4 xhigh · 100% left');
  assert.equal(state.lineCount, 3);
});

test('detectPaneState keeps useful tail text for busy panes', () => {
  const state = detectPaneState('Working on it...\nRunning tests...');
  assert.equal(state.promptReady, false);
  assert.equal(state.lastNonEmptyLine, 'Running tests...');
});

test('buildStartupInteractionPlan auto-confirms the initial workspace trust prompt', () => {
  const plan = buildStartupInteractionPlan([
    '> You are in /root/projects/research-intel',
    '',
    '  Do you trust the contents of this directory? Working with untrusted contents',
    '  comes with higher risk of prompt injection.',
    '',
    '› 1. Yes, continue',
    '  2. No, quit',
    '',
    '  Press enter to continue'
  ].join('\n'));

  assert.deepEqual(plan, [{ keys: ['Enter'] }]);
});

test('buildHeartbeatSnapshot derives staleness from the last pane change', () => {
  const currentRun = {
    date: '2026-03-14',
    sessionName: 'research-intel-codex',
    status: 'running'
  };

  const snapshot = buildHeartbeatSnapshot({
    sessionName: 'research-intel-codex',
    paneText: 'Press ? for shortcuts\n›',
    checkedAt: '2026-03-14T06:30:00.000Z',
    lastChangeAt: '2026-03-14T06:00:00.000Z',
    currentRun,
    staleAfterMs: 15 * 60 * 1000
  });

  assert.equal(snapshot.alive, true);
  assert.equal(snapshot.stale, true);
  assert.equal(snapshot.secondsSinceChange, 1800);
  assert.equal(snapshot.promptReady, true);
  assert.equal(snapshot.run.status, 'running');
  assert.ok(snapshot.paneHash.length >= 12);
});

test('run status sets separate active and final states', () => {
  assert.ok(ACTIVE_RUN_STATUSES.has('submitted'));
  assert.ok(ACTIVE_RUN_STATUSES.has('running'));
  assert.ok(!ACTIVE_RUN_STATUSES.has('completed'));

  assert.ok(FINAL_RUN_STATUSES.has('completed'));
  assert.ok(FINAL_RUN_STATUSES.has('failed'));
  assert.ok(!FINAL_RUN_STATUSES.has('running'));
});

test('reconcileCurrentRunWithHeartbeat marks stale, recovers to running, and detects missing sessions', () => {
  const baseRun = {
    date: '2026-03-14',
    sessionName: 'research-intel-codex-20260314',
    status: 'submitted',
    requestedAt: '2026-03-13T22:00:01.000Z'
  };

  const running = reconcileCurrentRunWithHeartbeat(baseRun, {
    alive: true,
    stale: false,
    checkedAt: '2026-03-13T22:01:00.000Z'
  });
  assert.equal(running.status, 'running');
  assert.equal(running.startedAt, '2026-03-13T22:01:00.000Z');

  const stale = reconcileCurrentRunWithHeartbeat(running, {
    alive: true,
    stale: true,
    checkedAt: '2026-03-13T22:21:00.000Z'
  });
  assert.equal(stale.status, 'stale');
  assert.equal(stale.staleAt, '2026-03-13T22:21:00.000Z');

  const recovered = reconcileCurrentRunWithHeartbeat(stale, {
    alive: true,
    stale: false,
    checkedAt: '2026-03-13T22:22:00.000Z'
  });
  assert.equal(recovered.status, 'running');
  assert.equal(recovered.recoveredAt, '2026-03-13T22:22:00.000Z');

  const missing = reconcileCurrentRunWithHeartbeat(recovered, {
    alive: false,
    stale: false,
    checkedAt: '2026-03-13T22:25:00.000Z'
  });
  assert.equal(missing.status, 'session_missing');
  assert.equal(missing.endedAt, '2026-03-13T22:25:00.000Z');
});
