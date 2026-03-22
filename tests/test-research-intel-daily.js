#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildPaperSlug,
  buildRecordPaths,
  buildRunPaths,
  decorateSelectedPapers
} = require('../scripts/research-intel/lib/daily');
const {
  DEFAULT_HTML_GENERATION_MAX_ATTEMPTS,
  buildHtmlInputCostSignals,
  buildPaperHtmlAttemptPaths,
  buildDependencyCardPayload,
  buildSessionContextPayload,
  inspectPaperArtifactReleaseReadiness,
  parseArgs,
  minimumArtifactCount,
  planDailyGenerationRoute,
  resolveHtmlEvidenceImageLimit,
  resolveProcessEnv,
  resolveRuntimeModelConfig,
  shouldLoadProjectEnv,
  selectForToday,
  splitDailyPicks
} = require('../scripts/research-intel/daily-run');

test('buildPaperSlug creates stable filesystem-friendly slugs', () => {
  assert.equal(
    buildPaperSlug('Gödel Agent: A Self-Referential Agent Framework for Recursive Self-Improvement'),
    'godel-agent-a-self-referential-agent-framework-for-recursive-self-improvement'
  );
});

test('buildRunPaths creates the expected date-scoped output layout', () => {
  const paths = buildRunPaths('/tmp/research-intel', '2026-03-13');

  assert.equal(paths.runDir, '/tmp/research-intel/daily/2026-03-13');
  assert.equal(paths.papersDir, '/tmp/research-intel/daily/2026-03-13/papers');
  assert.equal(paths.readingRouteJsonPath, '/tmp/research-intel/daily/2026-03-13/reading_route.json');
  assert.equal(paths.readingRouteMarkdownPath, '/tmp/research-intel/daily/2026-03-13/reading_route.md');
  assert.equal(paths.dependencyGraphPath, '/tmp/research-intel/daily/2026-03-13/dependency_graph.json');
  assert.equal(paths.dependencyCardsDir, '/tmp/research-intel/daily/2026-03-13/dependency_cards');
  assert.equal(paths.sessionContextsDir, '/tmp/research-intel/daily/2026-03-13/session_contexts');
  assert.equal(
    paths.packagePath,
    '/tmp/research-intel/daily/2026-03-13/research-intelligence-2026-03-13.tar.gz'
  );
});

test('buildRecordPaths creates tracked record layout separate from heavy run outputs', () => {
  const paths = buildRecordPaths('/tmp/research-intel-records', '2026-03-13');

  assert.equal(paths.runDir, '/tmp/research-intel-records/daily/2026-03-13');
  assert.equal(paths.knowledgeDir, '/tmp/research-intel-records/knowledge');
  assert.equal(paths.readingRouteJsonPath, '/tmp/research-intel-records/daily/2026-03-13/reading_route.json');
  assert.equal(paths.readingRouteMarkdownPath, '/tmp/research-intel-records/daily/2026-03-13/reading_route.md');
  assert.equal(paths.dependencyGraphPath, '/tmp/research-intel-records/daily/2026-03-13/dependency_graph.json');
  assert.equal(paths.dependencyCardsDir, '/tmp/research-intel-records/daily/2026-03-13/dependency_cards');
  assert.equal(paths.sessionContextsDir, '/tmp/research-intel-records/daily/2026-03-13/session_contexts');
  assert.equal(paths.methodTreeJsonPath, '/tmp/research-intel-records/knowledge/method_tree.json');
  assert.equal(paths.methodTreeMarkdownPath, '/tmp/research-intel-records/knowledge/method_tree.md');
});

test('buildPaperHtmlAttemptPaths keeps per-attempt paper artifacts isolated under generation_attempts', () => {
  const paths = buildPaperHtmlAttemptPaths('/tmp/research-intel/papers/01-demo', 2);

  assert.equal(DEFAULT_HTML_GENERATION_MAX_ATTEMPTS, 2);
  assert.equal(paths.attemptLabel, 'attempt-02');
  assert.equal(paths.attemptDir, '/tmp/research-intel/papers/01-demo/generation_attempts/attempt-02');
  assert.equal(paths.htmlPath, '/tmp/research-intel/papers/01-demo/generation_attempts/attempt-02/index.html');
  assert.equal(paths.finalMessagePath, '/tmp/research-intel/papers/01-demo/generation_attempts/attempt-02/codex_final_message.txt');
  assert.equal(paths.htmlValidationPath, '/tmp/research-intel/papers/01-demo/generation_attempts/attempt-02/html_validation.json');
  assert.equal(paths.standaloneValidationPath, '/tmp/research-intel/papers/01-demo/generation_attempts/attempt-02/standalone_validation.json');
});

test('parseArgs binds runtime.env to the selected profile directory unless explicitly overridden', () => {
  const parsed = parseArgs([
    '--profile-dir', '/tmp/custom-profile'
  ]);
  assert.equal(parsed.profileDir, '/tmp/custom-profile');
  assert.equal(parsed.runtimeEnvPath, '/tmp/custom-profile/runtime.env');
  assert.equal(parsed.profileDirExplicit, true);
  assert.equal(parsed.runtimeEnvExplicit, false);

  const explicit = parseArgs([
    '--profile-dir', '/tmp/custom-profile',
    '--runtime-env', '/tmp/elsewhere/runtime.env'
  ]);
  assert.equal(explicit.runtimeEnvPath, '/tmp/elsewhere/runtime.env');
  assert.equal(explicit.runtimeEnvExplicit, true);
});

test('parseArgs enables fast smoke mode explicitly', () => {
  const parsed = parseArgs(['--fast-smoke']);

  assert.equal(parsed.fastSmoke, true);
});

test('shouldLoadProjectEnv keeps the repo .env for the default profile only', () => {
  assert.equal(shouldLoadProjectEnv(parseArgs([])), true);
  assert.equal(shouldLoadProjectEnv(parseArgs(['--profile-dir', '/tmp/custom-profile'])), false);
  assert.equal(shouldLoadProjectEnv(parseArgs(['--runtime-env', '/tmp/custom/runtime.env'])), false);
});

test('resolveHtmlEvidenceImageLimit trims html evidence pages in fast smoke mode', () => {
  assert.equal(resolveHtmlEvidenceImageLimit({ fastSmoke: false }), 6);
  assert.equal(resolveHtmlEvidenceImageLimit({ fastSmoke: true }), 4);
});

test('buildHtmlInputCostSignals records prompt bytes, image bytes, and heuristic token estimates', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-html-cost-'));
  const imageA = path.join(tempDir, 'a.jpg');
  const imageB = path.join(tempDir, 'b.jpg');
  fs.writeFileSync(imageA, '12345', 'utf8');
  fs.writeFileSync(imageB, '1234567890', 'utf8');

  const metrics = buildHtmlInputCostSignals({
    promptText: '这是 prompt body',
    attachedPageImages: [imageA, imageB]
  });

  assert.equal(metrics.promptBytes > 0, true);
  assert.equal(metrics.promptChars, '这是 prompt body'.length);
  assert.equal(metrics.attachedPageImageCount, 2);
  assert.equal(metrics.attachedPageImageBytes, 15);
  assert.equal(metrics.promptTokenEstimate > 0, true);
  assert.equal(metrics.providerUsageAvailable, false);
});

test('inspectPaperArtifactReleaseReadiness rejects fallback-style artifacts and accepts full codex-chain artifacts', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-release-ready-'));
  const promptPath = path.join(tempDir, 'generation_prompt.md');
  const finalMessagePath = path.join(tempDir, 'codex_final_message.txt');
  const initialHtmlPath = path.join(tempDir, 'index.initial.html');
  fs.writeFileSync(promptPath, '# prompt\n', 'utf8');
  fs.writeFileSync(finalMessagePath, '<!DOCTYPE html><html><body>full chain</body></html>\n', 'utf8');
  fs.writeFileSync(initialHtmlPath, '<!DOCTYPE html><html><body>initial html</body></html>\n', 'utf8');

  const healthy = inspectPaperArtifactReleaseReadiness({
    title: 'Healthy Paper',
    generationSource: 'codex-tmux-pdf-first-single-chain',
    generationPromptPath: promptPath,
    codexFinalMessagePath: finalMessagePath,
    initialHtmlPath
  });
  assert.equal(healthy.ok, true);
  assert.deepEqual(healthy.issues, []);

  const degraded = inspectPaperArtifactReleaseReadiness({
    title: 'Fallback Paper',
    generationSource: 'deterministic-validated-report',
    generationPromptPath: '',
    codexFinalMessagePath: '',
    initialHtmlPath: ''
  });
  assert.equal(degraded.ok, false);
  assert.ok(degraded.issues.some(issue => issue.includes('generation source must be')));
  assert.ok(degraded.issues.some(issue => issue.includes('blocked generation source')));
  assert.ok(degraded.issues.some(issue => issue.includes('missing generation prompt artifact')));
  assert.ok(degraded.issues.some(issue => issue.includes('missing codex final message artifact')));
  assert.ok(degraded.issues.some(issue => issue.includes('missing initial html artifact')));
});

test('decorateSelectedPapers adds recommendation reasons, anchor links, and reading order text', () => {
  const papers = [
    {
      title: 'Recursive Self-Improvement for Self-Evolving Agents',
      summary: 'A new framework for recursive self-improvement with agent evolution.',
      published: '2026-03-12T00:00:00Z',
      matchedKeywords: ['self-evolving agents', 'recursive self-improvement'],
      matchedSignals: ['recursive agent improvement'],
      score: 91
    },
    {
      title: 'Automated Discovery with Meta-Evolution',
      summary: 'Automated discovery with meta-evolution for scientific search.',
      published: '2026-03-11T00:00:00Z',
      matchedKeywords: ['automated discovery'],
      matchedSignals: ['meta-evolution'],
      score: 84
    }
  ];

  const profile = {
    seeds: [
      { title: 'Gödel Agent: A Self-Referential Agent Framework for Recursive Self-Improvement' },
      { title: 'ShinkaEvolve: Towards Open-Ended and Sample-Efficient Program Evolution' },
      { title: 'Darwin Godel Machine: Open-Ended Evolution of Self-Improving Agents' },
      { title: 'EvoX: Meta-Evolution for Automated Discovery' }
    ]
  };

  const decorated = decorateSelectedPapers(papers, profile, new Date('2026-03-13T00:00:00Z'));

  assert.equal(decorated.length, 2);
  assert.ok(decorated[0].reasonWhyToday.includes('命中关键词'));
  assert.ok(decorated[0].reasonWhyToday.includes('最近'));
  assert.ok(decorated[0].readingReason.startsWith('先看这篇'));
  assert.ok(decorated[0].relatedSeeds.some(seed => seed.title.includes('Gödel Agent')));
  assert.ok(decorated[1].readingReason.startsWith('再看这篇'));
  assert.ok(decorated[1].relatedSeeds.some(seed => seed.title.includes('EvoX')));
});

test('selectForToday keeps some branch diversity when other strong branches exist', () => {
  const profile = {
    minPapers: 3,
    targetPapers: 4,
    maxPapers: 8
  };

  const selected = selectForToday([
    {
      title: 'Abstract Systems Thinking for Open-Ended Evolution',
      selectionBand: 'strong',
      branchId: 'open-endedness-diagnostics',
      score: 92
    },
    {
      title: 'Metric-Based Diagnostics for Open-Ended Evolution',
      selectionBand: 'strong',
      branchId: 'open-endedness-diagnostics',
      score: 90
    },
    {
      title: 'A Practical Self-Evolving Agent Architecture',
      selectionBand: 'strong',
      branchId: 'static-agents-limit',
      score: 88
    },
    {
      title: 'Verifier-Guided Experience Sharing for Group-Evolving Agents',
      selectionBand: 'strong',
      branchId: 'experience-accumulation',
      score: 86
    },
    {
      title: 'Automated Discovery via Meta-Evolution',
      selectionBand: 'strong',
      branchId: 'automated-discovery-hard-science',
      score: 84
    }
  ], profile);

  assert.equal(selected.length, 4);
  assert.ok(selected.filter(item => item.branchId === 'open-endedness-diagnostics').length <= 2);
  assert.ok(selected.some(item => item.branchId === 'static-agents-limit'));
  assert.ok(selected.some(item => item.branchId === 'experience-accumulation'));
});

test('selectForToday centers the batch on the strongest branch while still keeping side branches', () => {
  const profile = {
    minPapers: 3,
    targetPapers: 5,
    maxPapers: 8
  };

  const selected = selectForToday([
    {
      title: 'Main Branch Paper A',
      selectionBand: 'strong',
      branchId: 'experience-accumulation',
      score: 96
    },
    {
      title: 'Main Branch Paper B',
      selectionBand: 'strong',
      branchId: 'experience-accumulation',
      score: 94
    },
    {
      title: 'Main Branch Paper C',
      selectionBand: 'strong',
      branchId: 'experience-accumulation',
      score: 91
    },
    {
      title: 'Side Branch Paper A',
      selectionBand: 'strong',
      branchId: 'static-agents-limit',
      score: 89
    },
    {
      title: 'Side Branch Paper B',
      selectionBand: 'strong',
      branchId: 'feedback-and-search',
      score: 87
    },
    {
      title: 'Reserve Branch Paper',
      selectionBand: 'strong',
      branchId: 'automated-discovery-hard-science',
      score: 83
    }
  ], profile);

  assert.equal(selected.length, 5);
  assert.equal(
    selected.filter(item => item.branchId === 'experience-accumulation').length,
    3
  );
  assert.ok(selected.some(item => item.branchId === 'static-agents-limit'));
  assert.ok(selected.some(item => item.branchId === 'feedback-and-search'));
});

test('selectForToday does not pad the batch with borderline papers that lack direct method evidence', () => {
  const profile = {
    minPapers: 3,
    targetPapers: 5,
    maxPapers: 8
  };

  const selected = selectForToday([
    {
      title: 'Verifier-Guided Archive Updates for Group-Evolving Agents',
      selectionBand: 'strong',
      branchId: 'experience-accumulation',
      score: 96,
      directMethodEvidence: true
    },
    {
      title: 'Generic Environment Paper',
      selectionBand: 'borderline',
      branchId: 'feedback-and-search',
      score: 48,
      directMethodEvidence: false
    },
    {
      title: 'Generic Reward Paper',
      selectionBand: 'borderline',
      branchId: 'feedback-and-search',
      score: 45,
      directMethodEvidence: false
    }
  ], profile);

  assert.deepEqual(
    selected.map(item => item.title),
    ['Verifier-Guided Archive Updates for Group-Evolving Agents']
  );
});

test('minimumArtifactCount accepts a smaller high-quality batch when strict filtering leaves fewer papers', () => {
  const required = minimumArtifactCount({
    profile: {
      minPapers: 3
    },
    targetPaperCount: 5,
    generationQueueLength: 2
  });

  assert.equal(required, 2);
});

test('resolveRuntimeModelConfig does not silently reuse HTML models for curation', () => {
  const config = resolveRuntimeModelConfig({
    RESEARCH_INTEL_API_BASE_URL: 'https://example.com/v1/chat/completions',
    RESEARCH_INTEL_API_KEY: 'secret',
    RESEARCH_INTEL_HTML_MODELS: 'legacy-a, legacy-b',
    RESEARCH_INTEL_CHAT_TIMEOUT_MS: '45000'
  });

  assert.deepEqual(config.htmlModels, ['legacy-a', 'legacy-b']);
  assert.deepEqual(config.curationModels, []);
  assert.equal(config.chatTimeoutMs, 45000);
});

test('resolveRuntimeModelConfig inherits the baohe-safe Codex HTML timeout default', () => {
  const config = resolveRuntimeModelConfig({});

  assert.equal(config.codexHtmlTimeoutMs, 1800000);
});

test('resolveProcessEnv keeps explicit shell overrides above runtime.env while still letting runtime.env override project .env', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-env-'));
  const projectEnvPath = path.join(tempDir, 'project.env');
  const runtimeEnvPath = path.join(tempDir, 'runtime.env');

  fs.writeFileSync(projectEnvPath, [
    'RESEARCH_INTEL_CODEX_HTML_TIMEOUT_MS=600000',
    'RESEARCH_INTEL_CODEX_HTML_REASONING_EFFORT=medium',
    'RESEARCH_INTEL_RATE_LIMIT_PER_MINUTE=5',
    'PROJECT_ONLY=project'
  ].join('\n'), 'utf8');
  fs.writeFileSync(runtimeEnvPath, [
    'RESEARCH_INTEL_CODEX_HTML_TIMEOUT_MS=900000',
    'RESEARCH_INTEL_CODEX_HTML_REASONING_EFFORT=high',
    'RUNTIME_ONLY=runtime'
  ].join('\n'), 'utf8');

  const resolvedEnv = resolveProcessEnv({
    runtimeEnvPath
  }, {
    RESEARCH_INTEL_CODEX_HTML_TIMEOUT_MS: '1800000',
    RESEARCH_INTEL_RATE_LIMIT_PER_MINUTE: '9',
    SHELL_ONLY: 'shell'
  }, projectEnvPath);
  const config = resolveRuntimeModelConfig(resolvedEnv);

  assert.equal(config.codexHtmlTimeoutMs, 1800000);
  assert.equal(config.codexHtmlReasoningEffort, 'high');
  assert.equal(resolvedEnv.RESEARCH_INTEL_RATE_LIMIT_PER_MINUTE, '9');
  assert.equal(resolvedEnv.RUNTIME_ONLY, 'runtime');
  assert.equal(resolvedEnv.PROJECT_ONLY, 'project');
  assert.equal(resolvedEnv.SHELL_ONLY, 'shell');
});

test('splitDailyPicks keeps must-read strict and fills a separate watchlist from nearby candidates', () => {
  const profile = {
    minPapers: 3,
    targetPapers: 5,
    maxPapers: 8
  };

  const picks = splitDailyPicks([
    {
      title: 'Must Read A',
      selectionBand: 'strong',
      branchId: 'experience-accumulation',
      score: 96,
      directMethodEvidence: true,
      reasons: ['keyword_match', 'branch_fit']
    },
    {
      title: 'Must Read B',
      selectionBand: 'strong',
      branchId: 'feedback-and-search',
      score: 91,
      directMethodEvidence: true,
      reasons: ['keyword_match', 'branch_fit']
    },
    {
      title: 'Watch Candidate A',
      selectionBand: 'reject',
      branchId: 'experience-accumulation',
      score: 32,
      directMethodEvidence: true,
      reasons: ['very_old']
    },
    {
      title: 'Watch Candidate B',
      selectionBand: 'reject',
      branchId: 'what-evolves',
      score: 28,
      directMethodEvidence: true,
      reasons: ['stale_without_core']
    },
    {
      title: 'Hard Reject Noise',
      selectionBand: 'reject',
      branchId: 'static-agents-limit',
      score: 27,
      directMethodEvidence: false,
      reasons: ['security_adjacent']
    }
  ], profile);

  assert.deepEqual(
    picks.mustRead.map(item => item.title),
    ['Must Read A', 'Must Read B']
  );
  assert.deepEqual(
    picks.watchlist.map(item => item.title),
    ['Watch Candidate A', 'Watch Candidate B']
  );
});

test('planDailyGenerationRoute uses route order before paper generation', () => {
  const planned = planDailyGenerationRoute({
    dateString: '2026-03-17',
    selectedPapers: [
      {
        title: 'Memory Follow-up',
        branchId: 'memory',
        score: 91,
        reasonWhyToday: 'follow-up'
      },
      {
        title: 'Shared Framing',
        branchId: 'memory',
        score: 95,
        reasonWhyToday: 'framing'
      },
      {
        title: 'Verifier Contrast',
        branchId: 'verifier',
        score: 88,
        reasonWhyToday: 'contrast'
      }
    ]
  });

  assert.deepEqual(
    planned.generationQueue.map(paper => paper.title),
    ['Shared Framing', 'Memory Follow-up', 'Verifier Contrast']
  );
  assert.deepEqual(
    planned.generationQueue.map(paper => paper.routeRole),
    ['prerequisite', 'core', 'contrast']
  );
  assert.equal(planned.route.orderedPapers.length, 3);
  assert.equal(planned.dependencyGraph.edges.every(edge => edge.fromRank < edge.toRank), true);
});

test('buildSessionContextPayload records route and dependency inputs for one paper session', () => {
  const sessionContext = buildSessionContextPayload({
    dateString: '2026-03-17',
    paper: {
      paperId: 'paper:b',
      title: 'Memory Follow-up',
      slug: 'memory-follow-up',
      rank: 2,
      routeRole: 'core',
      dependencyPaperIds: ['paper:a']
    },
    route: {
      routeLogic: '先基础，再主方法。'
    },
    runPaths: {
      readingRouteJsonPath: '/tmp/run/reading_route.json',
      dependencyGraphPath: '/tmp/run/dependency_graph.json'
    },
    sessionContextPath: '/tmp/run/session_contexts/02-memory-follow-up.json',
    currentSourcePaths: {
      paperPdfPath: '/tmp/run/papers/02-memory-follow-up/paper.pdf',
      paperMetaPath: '/tmp/run/papers/02-memory-follow-up/paper_meta.json'
    },
    dependencyCards: [
      {
        paperId: 'paper:a',
        title: 'Paper A',
        cardPath: '/tmp/run/dependency_cards/01-paper-a.json',
        compareAxes: ['feedback loop']
      }
    ]
  });

  assert.equal(sessionContext.date, '2026-03-17');
  assert.equal(sessionContext.paper.paperId, 'paper:b');
  assert.equal(sessionContext.paper.routeRole, 'core');
  assert.equal(sessionContext.paper.sessionContextPath, '/tmp/run/session_contexts/02-memory-follow-up.json');
  assert.equal(sessionContext.globalContext.readingRoutePath, '/tmp/run/reading_route.json');
  assert.equal(sessionContext.globalContext.dependencyGraphPath, '/tmp/run/dependency_graph.json');
  assert.deepEqual(sessionContext.dependencyCards.map(card => card.cardPath), [
    '/tmp/run/dependency_cards/01-paper-a.json'
  ]);
  assert.equal(sessionContext.currentSources.paperPdfPath, '/tmp/run/papers/02-memory-follow-up/paper.pdf');
});

test('buildDependencyCardPayload produces a public route-aware dependency card', () => {
  const payload = buildDependencyCardPayload({
    dateString: '2026-03-17',
    paper: {
      paperId: 'paper:b',
      title: 'Memory Follow-up',
      slug: 'memory-follow-up',
      rank: 2,
      routeRole: 'core',
      dependencyPaperIds: ['paper:a'],
      compareAxes: ['feedback loop', 'evaluation setup'],
      whyHere: '主线第二篇，开始讲核心机制。'
    },
    paperCard: {
      paper_id: 'paper:b',
      title: 'Memory Follow-up',
      summary_anchor: 'Paper B extends the shared framing with a concrete method.'
    },
    dependencyEdges: [
      {
        fromRank: 1,
        fromPaperId: 'paper:a',
        toRank: 2,
        toPaperId: 'paper:b',
        compareAxes: ['feedback loop']
      }
    ],
    dependencyCards: [
      {
        paperId: 'paper:a',
        title: 'Shared Framing',
        routeRole: 'prerequisite',
        cardPath: '/tmp/run/dependency_cards/01-shared-framing.json',
        compareAxes: ['feedback loop']
      }
    ],
    dependencyCardPath: '/tmp/run/dependency_cards/02-memory-follow-up.json',
    sessionContextPath: '/tmp/run/session_contexts/02-memory-follow-up.json'
  });

  assert.equal(payload.paper_id, 'paper:b');
  assert.equal(payload.route_role, 'core');
  assert.equal(payload.route_rank, 2);
  assert.deepEqual(payload.dependency_paper_ids, ['paper:a']);
  assert.deepEqual(payload.compare_axes, ['feedback loop', 'evaluation setup']);
  assert.equal(payload.session_context_path, '/tmp/run/session_contexts/02-memory-follow-up.json');
  assert.equal(payload.dependencies[0].paper_id, 'paper:a');
  assert.equal(payload.dependencies[0].card_path, '/tmp/run/dependency_cards/01-shared-framing.json');
});
