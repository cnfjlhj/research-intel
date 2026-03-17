#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

const { buildPdfCandidateUrls, buildSearchQueries, fetchArxivEntriesByIds, fetchArxivQuery } = require('./lib/arxiv');
const { MinuteRateLimiter } = require('./lib/chat-html');
const { applyDailyCuration, curateDailySelection } = require('./lib/curation');
const {
  buildEvidenceManifest,
  buildCodexInlineHtmlPrompt,
  cleanHtmlResponse,
  injectEvidenceGallery,
  makeHtmlStandalone,
  replaceFigurePlaceholdersWithEvidence,
  renderPdfPagesToImages,
  buildCodexHtmlTmuxRunPaths,
  runCodexHtmlGeneration,
  selectEvidencePageImages,
  validateHtmlWithBrowser
} = require('./lib/codex-html');
const { normalizeArxivId, normalizeTitle, dedupePapers, scorePaper } = require('./lib/core');
const {
  buildDeliveryPlan,
  deliveryReceiptsPath,
  updateDeliveryStatus
} = require('./lib/delivery');
const { discoverPaperEnrichment } = require('./lib/discovery');
const { buildPaperSlug, buildRecordPaths, buildRunPaths, decorateSelectedPapers } = require('./lib/daily');
const { maybeCommitPath, relativeToRepo } = require('./lib/git');
const {
  buildPaperCard,
} = require('./lib/network');
const {
  buildDependencyGraph,
  buildDependencyCardFilename,
  buildSessionContextFilename,
  planReadingRoute
} = require('./lib/reading-route');
const {
  buildMethodTreeDelta,
  rebuildMethodTree,
  resolveMethodTaxonomy,
  renderMethodTreeMarkdown
} = require('./lib/method-tree');
const { fetchOpenReviewForPaper, summarizeOpenReviewThread } = require('./lib/openreview');
const { createTarGz } = require('./lib/package');
const { loadProfile, readJsonl } = require('./lib/profile');
const {
  buildBriefMarkdown,
  buildCoverageMarkdown,
  buildMethodTreeDeltaMarkdown,
  buildReadingOrderMarkdown,
  buildReadingRouteMarkdown,
  buildTelegramMessage
} = require('./lib/render');
const { sendTelegramDocument } = require('./lib/telegram');
const { resolveHtmlTemplateReference } = require('./lib/template');
const { resolveCodexEnhancementConfig } = require('./lib/codex-enhancement-config');

const ROOT_DIR = path.join(__dirname, '../..');
const DEFAULT_PROFILE_DIR = path.join(ROOT_DIR, 'work/research-intel/profile');
const DEFAULT_BASE_DIR = path.join(ROOT_DIR, 'work/research-intel');
const DEFAULT_RECORDS_DIR = path.join(ROOT_DIR, 'research-intel-records');
const DEFAULT_HISTORY_DIR = path.join(DEFAULT_RECORDS_DIR, 'history');
const DEFAULT_PROJECT_ENV_PATH = path.join(ROOT_DIR, '.env');
const DEFAULT_RUNTIME_ENV_PATH = path.join(DEFAULT_PROFILE_DIR, 'runtime.env');
const USER_AGENT = 'research-intel-bot/0.1 (+local)';
const DEFAULT_HTML_TEXT_PREVIEW_LIMIT = 16000;
const DEFAULT_HTML_EVIDENCE_IMAGE_LIMIT = 6;
const FAST_SMOKE_HTML_EVIDENCE_IMAGE_LIMIT = 4;
const DEFAULT_HTML_GENERATION_MAX_ATTEMPTS = 2;

function parseArgs(argv) {
  const options = {
    profileDir: DEFAULT_PROFILE_DIR,
    profileDirExplicit: false,
    baseDir: DEFAULT_BASE_DIR,
    recordsDir: DEFAULT_RECORDS_DIR,
    historyDir: DEFAULT_HISTORY_DIR,
    runtimeEnvPath: DEFAULT_RUNTIME_ENV_PATH,
    runtimeEnvExplicit: false,
    maxResultsPerQuery: 12,
    paperLimit: null,
    fastSmoke: false,
    noTelegram: false,
    disableNotification: false,
    noHistory: false,
    gitCommit: false,
    dateString: null
  };
  let runtimeEnvExplicit = false;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--profile-dir') {
      options.profileDir = path.resolve(argv[index + 1]);
      options.profileDirExplicit = true;
      index += 1;
    } else if (value === '--base-dir') {
      options.baseDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (value === '--history-dir') {
      options.historyDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (value === '--records-dir') {
      options.recordsDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (value === '--runtime-env') {
      options.runtimeEnvPath = path.resolve(argv[index + 1]);
      runtimeEnvExplicit = true;
      options.runtimeEnvExplicit = true;
      index += 1;
    } else if (value === '--date') {
      options.dateString = argv[index + 1];
      index += 1;
    } else if (value === '--max-results-per-query') {
      options.maxResultsPerQuery = Number(argv[index + 1]);
      index += 1;
    } else if (value === '--paper-limit') {
      options.paperLimit = Number(argv[index + 1]);
      index += 1;
    } else if (value === '--fast-smoke') {
      options.fastSmoke = true;
    } else if (value === '--no-telegram') {
      options.noTelegram = true;
    } else if (value === '--disable-notification') {
      options.disableNotification = true;
    } else if (value === '--no-history') {
      options.noHistory = true;
    } else if (value === '--git-commit') {
      options.gitCommit = true;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  if (!runtimeEnvExplicit) {
    options.runtimeEnvPath = path.join(options.profileDir, 'runtime.env');
  }

  return options;
}

function parseEnvList(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function shouldLoadProjectEnv(options = {}) {
  return !options.profileDirExplicit && !options.runtimeEnvExplicit;
}

function resolveRuntimeModelConfig(env = process.env) {
  const configuredChatTimeoutMs = Number(env.RESEARCH_INTEL_CHAT_TIMEOUT_MS || '60000');
  const codexEnhancementConfig = resolveCodexEnhancementConfig(env);

  return {
    htmlApiBaseUrl: env.RESEARCH_INTEL_API_BASE_URL || '',
    htmlApiKey: env.RESEARCH_INTEL_API_KEY || '',
    htmlModels: parseEnvList(env.RESEARCH_INTEL_HTML_MODELS),
    curationModels: parseEnvList(env.RESEARCH_INTEL_CURATION_MODELS),
    chatTimeoutMs: Number.isFinite(configuredChatTimeoutMs) && configuredChatTimeoutMs > 0
      ? configuredChatTimeoutMs
      : 60000,
    codexHtmlEnhancementEnabled: codexEnhancementConfig.enabled,
    codexHtmlModel: codexEnhancementConfig.model,
    codexHtmlReasoningEffort: codexEnhancementConfig.reasoningEffort,
    codexHtmlTimeoutMs: codexEnhancementConfig.timeoutMs
  };
}

function ensureDir(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
}

function readEnvFile(envPath) {
  if (!envPath || !fs.existsSync(envPath)) {
    return {};
  }
  return dotenv.parse(fs.readFileSync(envPath, 'utf8'));
}

function resolveProcessEnv(options = {}, baseEnv = process.env, projectEnvPath = DEFAULT_PROJECT_ENV_PATH) {
  const inheritedEnv = { ...baseEnv };
  const projectEnv = shouldLoadProjectEnv(options) ? readEnvFile(projectEnvPath) : {};
  const runtimeEnv = readEnvFile(options.runtimeEnvPath);
  return {
    ...projectEnv,
    ...runtimeEnv,
    ...inheritedEnv
  };
}

function writeJson(targetPath, data) {
  fs.writeFileSync(targetPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function writeText(targetPath, text) {
  fs.writeFileSync(targetPath, text, 'utf8');
}

function resolveHtmlEvidenceImageLimit(options = {}) {
  return options.fastSmoke
    ? FAST_SMOKE_HTML_EVIDENCE_IMAGE_LIMIT
    : DEFAULT_HTML_EVIDENCE_IMAGE_LIMIT;
}

function safeFileSize(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return 0;
  }
  return fs.statSync(filePath).size;
}

function estimatePromptTokens(promptText = '') {
  const normalized = String(promptText || '');
  const promptChars = normalized.length;
  const promptBytes = Buffer.byteLength(normalized, 'utf8');
  return Math.max(1, Math.ceil(Math.max(promptChars / 4, promptBytes / 6)));
}

function buildHtmlInputCostSignals({ promptText = '', attachedPageImages = [] }) {
  const normalizedPrompt = String(promptText || '');
  const promptChars = normalizedPrompt.length;
  const promptBytes = Buffer.byteLength(normalizedPrompt, 'utf8');
  const attachedPageImageBytes = attachedPageImages.reduce((total, imagePath) => total + safeFileSize(imagePath), 0);
  return {
    promptChars,
    promptBytes,
    promptTokenEstimate: estimatePromptTokens(normalizedPrompt),
    attachedPageImageCount: attachedPageImages.length,
    attachedPageImageBytes,
    providerUsageAvailable: false,
    providerUsageReason: 'codex-exec-local-artifacts-do-not-expose-provider-token-usage'
  };
}

function buildHtmlOutputCostSignals({ status = null, finalMessagePath = '', htmlPath = '' }) {
  return {
    finalMessageBytes: safeFileSize(finalMessagePath),
    htmlBytes: safeFileSize(htmlPath),
    stdoutBytes: Number(status?.stdoutBytes || 0),
    stderrBytes: Number(status?.stderrBytes || 0),
    startedAt: status?.startedAt || '',
    endedAt: status?.endedAt || '',
    lastOutputAt: status?.lastOutputAt || ''
  };
}

function appendJsonl(targetPath, records) {
  if (!records.length) {
    return;
  }

  ensureDir(path.dirname(targetPath));
  const payload = records.map(record => JSON.stringify(record)).join('\n');
  fs.appendFileSync(targetPath, `${payload}\n`, 'utf8');
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

function uniqueStrings(items) {
  return [...new Set(
    (items || [])
      .map(item => String(item || '').trim())
      .filter(Boolean)
  )];
}

function readSentHistory(historyDir) {
  const filePath = path.join(historyDir, 'sent_papers.jsonl');
  const entries = readJsonl(filePath);
  return {
    filePath,
    entries,
    titles: new Set(entries.map(entry => normalizeTitle(entry.title)))
  };
}

function loadAcceptedRuns(recordsDir, throughDateString = '') {
  const dailyDir = path.join(recordsDir, 'daily');
  if (!fs.existsSync(dailyDir)) {
    return [];
  }

  return fs.readdirSync(dailyDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .filter(name => !throughDateString || name < throughDateString)
    .sort()
    .map(dateString => ({
      dateString,
      selectedPapers: fs.existsSync(path.join(dailyDir, dateString, 'selected_papers.json'))
        ? JSON.parse(fs.readFileSync(path.join(dailyDir, dateString, 'selected_papers.json'), 'utf8'))
        : []
    }));
}

function repoRelativePath(targetPath) {
  return relativeToRepo(ROOT_DIR, targetPath);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }

  return response.text();
}

async function downloadFile(url, outputPath) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
}

async function downloadPaperPdf(paper, outputPath) {
  const attempts = [];

  for (const url of buildPdfCandidateUrls(paper)) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get('content-type') || '';
      const looksLikePdf = contentType.includes('application/pdf')
        || buffer.subarray(0, 4).toString('utf8') === '%PDF';

      if (!looksLikePdf) {
        throw new Error(`unexpected content-type ${contentType || 'unknown'}`);
      }

      fs.writeFileSync(outputPath, buffer);
      return url;
    } catch (error) {
      attempts.push(`${url} -> ${error.message}`);
    }
  }

  throw new Error(`All PDF download URLs failed for ${paper.title}: ${attempts.join('; ')}`);
}

function extractPdfText(pdfPath, outputPath) {
  const result = spawnSync('pdftotext', ['-layout', pdfPath, outputPath], {
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    throw new Error(`pdftotext failed: ${result.stderr || result.stdout}`);
  }
}

function truncateForLlm(text, limit = 25000) {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}\n\n[TRUNCATED FOR LLM INPUT]\n`;
}

function preferValue(content, keys) {
  for (const key of keys) {
    const raw = content?.[key];
    if (!raw) {
      continue;
    }
    if (typeof raw === 'string') {
      return raw;
    }
    if (typeof raw.value === 'string') {
      return raw.value;
    }
  }
  return '';
}

function buildPaperMeta(paper, openreviewData) {
  const submission = openreviewData?.submission?.notes?.[0];
  const content = submission?.content || {};
  const openreviewPdf = submission?.pdf ? `https://openreview.net/pdf?id=${submission.id}` : '';

  return {
    slug: paper.slug,
    title: preferValue(content, ['title']) || paper.title,
    authors: paper.authors || [],
    keywords: paper.categories || [],
    abstract: preferValue(content, ['abstract']) || paper.summary,
    tldr: preferValue(content, ['TL;DR', 'TLDR', 'one_sentence_summary']) || paper.summary.slice(0, 240),
    venue: preferValue(content, ['venue', 'venueid']) || 'arXiv',
    arxiv: {
      id: paper.arxivId,
      abs_url: paper.absUrl,
      pdf_url: paper.pdfUrl,
      published: paper.published,
      updated: paper.updated,
      categories: paper.categories || []
    },
    openreview: openreviewData ? {
      forum_id: openreviewData.forumId,
      forum_url: `https://openreview.net/forum?id=${openreviewData.forumId}`,
      pdf_url: openreviewPdf,
      paperhash: openreviewData.paperhash
    } : null,
    recommendation_context: {
      reason_today: paper.reasonWhyToday,
      reading_reason: paper.readingReason,
      matched_keywords: paper.matchedKeywords || [],
      matched_signals: paper.matchedSignals || [],
      related_seeds: (paper.relatedSeeds || []).map(seed => seed.title)
    }
  };
}

function scoreCandidates(candidates, profile, now) {
  return dedupePapers(candidates)
    .map(paper => ({
      ...paper,
      ...scorePaper(paper, profile, now),
      slug: buildPaperSlug(paper.title)
    }))
    .filter(paper => paper.score > 0)
    .sort((left, right) => right.score - left.score);
}

function selectForToday(scoredCandidates, profile, paperLimit = null) {
  const primary = scoredCandidates.filter(paper => paper.selectionBand === 'strong');
  const reserve = scoredCandidates.filter(
    paper => paper.selectionBand === 'borderline' && paper.directMethodEvidence
  );
  const ordered = [];
  const seen = new Set();

  const desiredCount = Math.min(
    profile.maxPapers,
    Math.max(profile.minPapers, profile.targetPapers || profile.minPapers)
  );

  const countLimit = paperLimit ? Math.min(desiredCount, paperLimit) : desiredCount;

  const addPaper = (paper) => {
    const key = normalizeTitle(paper.title);
    if (seen.has(key) || ordered.length >= countLimit) {
      return false;
    }
    seen.add(key);
    ordered.push(paper);
    return true;
  };

  const primaryByBranch = new Map();
  for (const paper of primary) {
    const branchKey = String(paper.branchId || '__unassigned__');
    if (!primaryByBranch.has(branchKey)) {
      primaryByBranch.set(branchKey, []);
    }
    primaryByBranch.get(branchKey).push(paper);
  }

  const rankedBranches = [...primaryByBranch.entries()]
    .map(([branchId, papers]) => ({
      branchId,
      papers,
      totalScore: papers.reduce((sum, item) => sum + Number(item.score || 0), 0),
      bestScore: Number(papers[0]?.score || 0)
    }))
    .sort((left, right) =>
      right.totalScore - left.totalScore
      || right.bestScore - left.bestScore
      || left.branchId.localeCompare(right.branchId)
    );

  const mainBranch = rankedBranches[0] || null;
  const sideBranches = rankedBranches.filter(entry => entry.branchId !== mainBranch?.branchId);
  const targetSideCount = sideBranches.length > 0
    ? Math.min(sideBranches.length, Math.max(1, Math.round(countLimit * 0.3)))
    : 0;
  const mainQuota = mainBranch
    ? Math.max(1, countLimit - targetSideCount)
    : 0;

  if (mainBranch) {
    for (const paper of mainBranch.papers) {
      if (ordered.length >= mainQuota) {
        break;
      }
      addPaper(paper);
    }
  }

  let sideAdded = 0;
  for (const branch of sideBranches) {
    if (sideAdded >= targetSideCount) {
      break;
    }
    const added = addPaper(branch.papers[0]);
    if (added) {
      sideAdded += 1;
    }
  }

  for (const source of [primary, reserve]) {
    for (const paper of source) {
      addPaper(paper);
      if (ordered.length >= countLimit) {
        break;
      }
    }
    if (ordered.length >= countLimit) {
      break;
    }
  }
  return ordered.slice(0, Math.min(countLimit, ordered.length));
}

const WATCHLIST_EXCLUDED_REASONS = new Set([
  'already_read',
  'applied_domain',
  'abstract_systems_framing',
  'diagnostic_without_actionable_method',
  'feedback_avoid',
  'indirect_alignment_only',
  'negative_signal',
  'security_adjacent',
  'static_branch_weak',
  'survey_style',
  'thin_diagnostic_theory',
  'thin_method_evidence',
  'weak_theme_only'
]);

function canEnterWatchlist(paper) {
  const reasons = new Set((paper.reasons || []).map(reason => String(reason || '').trim()).filter(Boolean));
  if (Number(paper?.score || 0) <= 0) {
    return false;
  }
  if (!paper?.directMethodEvidence) {
    return false;
  }
  for (const reason of reasons) {
    if (WATCHLIST_EXCLUDED_REASONS.has(reason)) {
      return false;
    }
  }

  if (paper.selectionBand === 'strong' || paper.selectionBand === 'borderline') {
    return true;
  }

  return reasons.has('very_old') || reasons.has('stale_without_core');
}

function dedupeByTitle(papers) {
  const ordered = [];
  const seen = new Set();
  for (const paper of papers || []) {
    const key = normalizeTitle(paper?.title || '');
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    ordered.push(paper);
  }
  return ordered;
}

function summarizeWatchlistReason(paper) {
  const reasons = new Set((paper?.reasons || []).map(reason => String(reason || '').trim()).filter(Boolean));
  if (paper?.selectionBand === 'strong') {
    return '和今天主线高度相关，但主推名额优先留给更核心的阅读顺序。';
  }
  if (paper?.selectionBand === 'borderline') {
    return '方向相近且有直接方法证据，但今天先不放进主推队列。';
  }
  if (reasons.has('very_old')) {
    return '方法线相关，但论文发布时间较早，先放入回补观察池。';
  }
  if (reasons.has('stale_without_core')) {
    return '和当前问题相邻，但核心方法证据还不够集中，先持续观察。';
  }
  return '与当前主线相关，但今天不进入主推，先保留在观察池。';
}

function decorateWatchlistPapers(papers, profile, now) {
  return decorateSelectedPapers(papers, profile, now).map(paper => ({
    ...paper,
    watchlistReason: paper.watchlistReason || summarizeWatchlistReason(paper)
  }));
}

function splitDailyPicks(scoredCandidates, profile, paperLimit = null) {
  const mustRead = selectForToday(scoredCandidates, profile, paperLimit);
  const mustReadTitles = new Set(mustRead.map(paper => normalizeTitle(paper.title)));
  const watchlistLimit = Math.min(6, Math.max(2, Math.ceil(desiredPaperCount(profile, paperLimit) * 0.75)));
  const watchlist = [];

  const pushWatchlist = (paper) => {
    const key = normalizeTitle(paper?.title || '');
    if (!key || mustReadTitles.has(key) || watchlist.some(item => normalizeTitle(item.title) === key)) {
      return;
    }
    if (!canEnterWatchlist(paper)) {
      return;
    }
    watchlist.push(paper);
  };

  const remainingStrong = scoredCandidates.filter(paper => paper.selectionBand === 'strong');
  const remainingBorderline = scoredCandidates.filter(paper => paper.selectionBand === 'borderline');
  const nearbyRejects = scoredCandidates.filter(paper => paper.selectionBand === 'reject');

  for (const source of [remainingStrong, remainingBorderline, nearbyRejects]) {
    for (const paper of source) {
      pushWatchlist(paper);
      if (watchlist.length >= watchlistLimit) {
        break;
      }
    }
    if (watchlist.length >= watchlistLimit) {
      break;
    }
  }

  return {
    mustRead: dedupeByTitle(mustRead),
    watchlist: dedupeByTitle(watchlist)
  };
}

function planDailyGenerationRoute({ dateString, selectedPapers, maxInDegree = 3 }) {
  const baseRoute = planReadingRoute({
    dateString,
    selectedPapers
  });
  const dependencyGraph = buildDependencyGraph({
    orderedPapers: baseRoute.orderedPapers,
    maxInDegree
  });
  const generationQueue = baseRoute.orderedPapers.map(paper => ({
    ...paper,
    dependencyPaperIds: (dependencyGraph.dependenciesByPaperId[paper.paperId] || [])
      .map(edge => edge.fromPaperId)
  }));

  return {
    route: {
      ...baseRoute,
      orderedPapers: generationQueue
    },
    dependencyGraph,
    generationQueue
  };
}

function buildSessionContextPayload({
  dateString,
  paper,
  route,
  runPaths,
  sessionContextPath,
  currentSourcePaths,
  dependencyCards
}) {
  return {
    date: dateString,
    paper: {
      paperId: paper.paperId,
      title: paper.title,
      routeRank: paper.rank,
      routeRole: paper.routeRole,
      dependencyPaperIds: paper.dependencyPaperIds || [],
      sessionContextPath
    },
    globalContext: {
      routeLogic: route?.routeLogic || '',
      readingRoutePath: runPaths?.readingRouteJsonPath || '',
      dependencyGraphPath: runPaths?.dependencyGraphPath || ''
    },
    currentSources: {
      paperPdfPath: currentSourcePaths?.paperPdfPath || '',
      paperMetaPath: currentSourcePaths?.paperMetaPath || '',
      paperTextPath: currentSourcePaths?.paperTextPath || '',
      paperTextPreviewPath: currentSourcePaths?.paperTextPreviewPath || '',
      openreviewSummaryPath: currentSourcePaths?.openreviewSummaryPath || '',
      pageImagesDir: currentSourcePaths?.pageImagesDir || '',
      pageTextsDir: currentSourcePaths?.pageTextsDir || ''
    },
    dependencyCards: (dependencyCards || []).map(card => ({
      paperId: card.paperId,
      title: card.title,
      routeRole: card.routeRole || '',
      cardPath: card.cardPath || '',
      compareAxes: card.compareAxes || [],
      whyRelevantToCurrent: card.whyRelevantToCurrent || ''
    }))
  };
}

function buildDependencyCardPayload({
  dateString,
  paper,
  paperCard,
  dependencyEdges,
  dependencyCards,
  dependencyCardPath,
  sessionContextPath
}) {
  const edgeByPaperId = new Map(
    (dependencyEdges || []).map(edge => [edge.fromPaperId, edge])
  );
  const normalizedDependencyCards = (dependencyCards || []).map(card => {
    const edge = edgeByPaperId.get(card.paperId) || {};
    return {
      paper_id: card.paperId,
      title: card.title || '',
      route_role: card.routeRole || '',
      route_rank: Number.isFinite(Number(card.routeRank)) ? Number(card.routeRank) : null,
      card_path: card.cardPath || '',
      compare_axes: uniqueStrings([
        ...(card.compareAxes || []),
        ...(edge.compareAxes || [])
      ]),
      why_relevant_to_current: card.whyRelevantToCurrent || ''
    };
  });

  return {
    ...(paperCard || {}),
    paper_id: paper?.paperId || paperCard?.paper_id || '',
    title: paper?.title || paperCard?.title || '',
    date: dateString,
    route_role: paper?.routeRole || paperCard?.route_role || '',
    route_rank: Number.isFinite(Number(paper?.rank))
      ? Number(paper.rank)
      : (Number.isFinite(Number(paperCard?.route_rank)) ? Number(paperCard.route_rank) : null),
    dependency_paper_ids: uniqueStrings(
      (paper?.dependencyPaperIds || []).length > 0
        ? paper.dependencyPaperIds
        : (paperCard?.dependency_paper_ids || normalizedDependencyCards.map(card => card.paper_id))
    ),
    compare_axes: uniqueStrings([
      ...(paper?.compareAxes || []),
      ...(paperCard?.compare_axes || [])
    ]),
    why_relevant_to_current: String(
      paper?.whyRelevantToCurrent
      || paper?.whyHere
      || paper?.readingReason
      || paperCard?.why_relevant_to_current
      || ''
    ).trim(),
    dependency_card_path: dependencyCardPath || '',
    session_context_path: sessionContextPath || '',
    dependencies: normalizedDependencyCards
  };
}

function minimumArtifactCount({ profile, targetPaperCount, generationQueueLength }) {
  return Math.min(
    Math.max(1, Number(profile?.minPapers || 1)),
    Math.max(0, Number(targetPaperCount || 0)),
    Math.max(0, Number(generationQueueLength || 0))
  );
}

function desiredPaperCount(profile, paperLimit = null) {
  const desiredCount = Math.min(
    profile.maxPapers,
    Math.max(profile.minPapers, profile.targetPapers || profile.minPapers)
  );
  return paperLimit ? Math.min(desiredCount, paperLimit) : desiredCount;
}

function buildPaperHtmlAttemptPaths(paperDir, attemptNumber) {
  const attemptLabel = `attempt-${String(attemptNumber).padStart(2, '0')}`;
  const attemptDir = path.join(paperDir, 'generation_attempts', attemptLabel);
  return {
    attemptNumber,
    attemptLabel,
    attemptDir,
    promptPath: path.join(attemptDir, 'generation_prompt.md'),
    htmlPath: path.join(attemptDir, 'index.html'),
    initialHtmlPath: path.join(attemptDir, 'index.initial.html'),
    finalMessagePath: path.join(attemptDir, 'codex_final_message.txt'),
    codexStdoutPath: path.join(attemptDir, 'codex_stdout.txt'),
    codexStderrPath: path.join(attemptDir, 'codex_stderr.txt'),
    initialModelMessagePath: path.join(attemptDir, 'initial_model_message.txt'),
    initialModelRawPath: path.join(attemptDir, 'initial_model_raw.txt'),
    htmlValidationPath: path.join(attemptDir, 'html_validation.json'),
    htmlValidationScreenshotPath: path.join(attemptDir, 'html_validation.png'),
    standaloneValidationPath: path.join(attemptDir, 'standalone_validation.json'),
    standaloneValidationScreenshotPath: path.join(attemptDir, 'standalone_validation.png')
  };
}

function copyFileIfExists(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) {
    return;
  }
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function writePaperRunState(runStatePath, payload) {
  writeJson(runStatePath, {
    ...payload,
    updatedAt: new Date().toISOString()
  });
}

function summarizeValidationReport(validation = {}) {
  const renderIssue = issue => {
    if (!issue) {
      return '';
    }
    if (typeof issue === 'string') {
      return issue;
    }
    if (issue.code === 'placeholder_marker' && Array.isArray(issue.markers)) {
      return `${issue.code}:${issue.markers.join(', ')}`;
    }
    if (typeof issue.code === 'string') {
      return issue.code;
    }
    return JSON.stringify(issue);
  };
  const parts = [];
  const missingMarkers = (validation.missingMarkers || []).slice(0, 4);
  const remoteAssetRefs = (validation.remoteAssetRefs || []).slice(0, 3);
  const consoleErrors = (validation.consoleErrors || []).slice(0, 2);
  const qualityIssues = (validation.qualityIssues || []).slice(0, 3);
  const placeholderMarkers = (validation.placeholderMarkers || []).slice(0, 3);

  if (missingMarkers.length > 0) {
    parts.push(`missing headings: ${missingMarkers.join(', ')}`);
  }
  if (remoteAssetRefs.length > 0) {
    parts.push(`remote assets: ${remoteAssetRefs.join(', ')}`);
  }
  if (consoleErrors.length > 0) {
    parts.push(`console errors: ${consoleErrors.join(' | ')}`);
  }
  if (qualityIssues.length > 0) {
    parts.push(`quality issues: ${qualityIssues.map(renderIssue).filter(Boolean).join(', ')}`);
  }
  if (placeholderMarkers.length > 0) {
    parts.push(`placeholder markers: ${placeholderMarkers.join(', ')}`);
  }

  return parts.join('; ') || 'browser validation failed without a parsed summary';
}

function buildAttemptFailureSummary(attemptResult) {
  if (attemptResult?.htmlValidation && !attemptResult.htmlValidation.ok) {
    return summarizeValidationReport(attemptResult.htmlValidation);
  }
  if (attemptResult?.standaloneValidation && !attemptResult.standaloneValidation.ok) {
    return summarizeValidationReport(attemptResult.standaloneValidation);
  }
  return 'html generation attempt failed without a structured validation summary';
}

async function runPaperHtmlGenerationAttempt({
  paperDir,
  promptText,
  attachedPageImages,
  evidencePages,
  options,
  attemptPaths,
  inputCostSignals
}) {
  const runtimePaths = buildCodexHtmlTmuxRunPaths({
    workingDir: paperDir,
    targetHtmlPath: attemptPaths.htmlPath,
    finalMessagePath: attemptPaths.finalMessagePath
  });
  ensureDir(attemptPaths.attemptDir);
  writeText(attemptPaths.promptPath, `${promptText}\n`);

  try {
    const codexRun = await runCodexHtmlGeneration({
      workingDir: paperDir,
      targetHtmlPath: attemptPaths.htmlPath,
      finalMessagePath: attemptPaths.finalMessagePath,
      promptText,
      attachedPageImages,
      model: options.codexHtmlModel,
      reasoningEffort: options.codexHtmlReasoningEffort,
      timeoutMs: options.codexHtmlTimeoutMs
    });

    const rawFinalMessage = fs.existsSync(attemptPaths.finalMessagePath)
      ? fs.readFileSync(attemptPaths.finalMessagePath, 'utf8')
      : codexRun.finalMessage || '';
    const cleanedHtml = cleanHtmlResponse(rawFinalMessage);
    writeText(attemptPaths.codexStdoutPath, `${codexRun.stdout || ''}\n`);
    writeText(attemptPaths.codexStderrPath, `${codexRun.stderr || ''}\n`);
    writeText(attemptPaths.initialModelMessagePath, `${rawFinalMessage}\n`);
    writeText(attemptPaths.initialModelRawPath, `${rawFinalMessage}\n`);
    writeText(attemptPaths.initialHtmlPath, `${cleanedHtml}\n`);
    writeText(
      attemptPaths.htmlPath,
      `${injectEvidenceGallery(replaceFigurePlaceholdersWithEvidence(cleanedHtml, evidencePages), evidencePages)}\n`
    );

    await makeHtmlStandalone(attemptPaths.htmlPath);

    const htmlValidation = await validateHtmlWithBrowser({
      htmlPath: attemptPaths.htmlPath,
      screenshotPath: attemptPaths.htmlValidationScreenshotPath,
      evidencePages
    });
    writeJson(attemptPaths.htmlValidationPath, {
      ...htmlValidation,
      generationAttempt: attemptPaths.attemptNumber,
      validationMode: 'final-standalone'
    });

    const standaloneValidation = await validateHtmlWithBrowser({
      htmlPath: attemptPaths.htmlPath,
      screenshotPath: attemptPaths.standaloneValidationScreenshotPath,
      evidencePages
    });
    writeJson(attemptPaths.standaloneValidationPath, {
      ...standaloneValidation,
      generationAttempt: attemptPaths.attemptNumber,
      validationMode: 'standalone-rerun'
    });

    return {
      attemptNumber: attemptPaths.attemptNumber,
      attemptLabel: attemptPaths.attemptLabel,
      attemptDir: attemptPaths.attemptDir,
      sessionName: codexRun.sessionName,
      runtimePaths,
      inputCostSignals,
      outputCostSignals: buildHtmlOutputCostSignals({
        status: codexRun.status,
        finalMessagePath: attemptPaths.finalMessagePath,
        htmlPath: attemptPaths.htmlPath
      }),
      status: htmlValidation.ok && standaloneValidation.ok ? 'passed_validation' : 'failed_validation',
      generationModel: options.codexHtmlModel,
      generationSource: 'codex-tmux-pdf-first-single-chain',
      htmlValidation,
      standaloneValidation
    };
  } catch (error) {
    copyFileIfExists(runtimePaths.stdoutPath, attemptPaths.codexStdoutPath);
    copyFileIfExists(runtimePaths.stderrPath, attemptPaths.codexStderrPath);
    throw error;
  }
}

async function fetchCandidates(profile, maxResultsPerQuery) {
  const queries = buildSearchQueries(profile);
  const explicitSeedIds = [...new Set(
    (profile.seeds || [])
      .map(seed => normalizeArxivId(seed?.arxivId || seed?.absUrl || seed?.pdfUrl || seed?.source || ''))
      .filter(Boolean)
  )];
  const results = await Promise.all(
    queries.map(async query => {
      try {
        const papers = await fetchArxivQuery(query, maxResultsPerQuery);
        return { query, papers, error: null };
      } catch (error) {
        return { query, papers: [], error: error.message };
      }
    })
  );
  if (explicitSeedIds.length > 0) {
    try {
      const papers = await fetchArxivEntriesByIds(explicitSeedIds);
      results.unshift({
        query: `explicit-seeds:${explicitSeedIds.join(',')}`,
        papers,
        error: null
      });
    } catch (error) {
      results.unshift({
        query: `explicit-seeds:${explicitSeedIds.join(',')}`,
        papers: [],
        error: error.message
      });
    }
  }

  return {
    queries,
    results,
    candidates: dedupePapers(results.flatMap(result => result.papers))
  };
}

async function generatePaperArtifacts(paper, index, runPaths, options, dateString, semanticContext = {}) {
  const paperDir = path.join(runPaths.papersDir, `${String(index + 1).padStart(2, '0')}-${paper.slug}`);
  ensureDir(paperDir);

  const openreviewSummaryPath = path.join(paperDir, 'openreview_summary.md');
  const paperPdfPath = path.join(paperDir, 'paper.pdf');
  const paperTextPath = path.join(paperDir, 'paper_text.txt');
  const paperTextPreviewPath = path.join(paperDir, 'paper_text_preview.txt');
  const pageImagesDir = path.join(paperDir, 'pages');
  const pageTextsDir = path.join(paperDir, 'page_texts');
  const paperMetaPath = path.join(paperDir, 'paper_meta.json');
  const promptPath = path.join(paperDir, 'generation_prompt.md');
  const runStatePath = path.join(paperDir, 'run_state.json');
  const finalMessagePath = path.join(paperDir, 'codex_final_message.txt');
  const codexStdoutPath = path.join(paperDir, 'codex_stdout.txt');
  const codexStderrPath = path.join(paperDir, 'codex_stderr.txt');
  const initialModelMessagePath = path.join(paperDir, 'initial_model_message.txt');
  const initialModelRawPath = path.join(paperDir, 'initial_model_raw.txt');
  const enhancementMetaPath = path.join(paperDir, 'codex_enhancement.json');
  const webCoveragePath = path.join(paperDir, 'web_coverage.json');
  const webCoverageMarkdownPath = path.join(paperDir, 'web_coverage.md');
  const htmlPath = path.join(paperDir, 'index.html');
  const initialHtmlPath = path.join(paperDir, 'index.initial.html');
  const htmlValidationPath = path.join(paperDir, 'html_validation.json');
  const htmlValidationScreenshotPath = path.join(paperDir, 'html_validation.png');
  const standaloneValidationPath = path.join(paperDir, 'standalone_validation.json');
  const standaloneValidationScreenshotPath = path.join(paperDir, 'standalone_validation.png');
  const evidencePagesPath = path.join(paperDir, 'evidence_pages.json');
  const paperCardPath = path.join(paperDir, 'paper_card.json');

  let openreviewData = null;
  let openreviewSummary = '暂无公开 OpenReview 信息。';
  try {
    openreviewData = await fetchOpenReviewForPaper(paper.title, paper.authors || []);
    if (openreviewData) {
      openreviewSummary = summarizeOpenReviewThread(openreviewData.thread);
      writeJson(path.join(paperDir, 'openreview_submission.json'), openreviewData.submission);
      writeJson(path.join(paperDir, 'openreview_thread.json'), openreviewData.thread);
    }
  } catch (error) {
    openreviewSummary = `OpenReview 抓取失败：${error.message}`;
  }
  writeText(openreviewSummaryPath, `${openreviewSummary}\n`);

  const resolvedPdfUrl = await downloadPaperPdf(paper, paperPdfPath);
  const paperWithResolvedPdf = {
    ...paper,
    pdfUrl: resolvedPdfUrl
  };
  extractPdfText(paperPdfPath, paperTextPath);
  const extractedText = fs.readFileSync(paperTextPath, 'utf8');
  writeText(paperTextPreviewPath, truncateForLlm(extractedText, DEFAULT_HTML_TEXT_PREVIEW_LIMIT));
  const pageImages = renderPdfPagesToImages({
    pdfPath: paperPdfPath,
    outputDir: pageImagesDir
  });
  const evidencePages = selectEvidencePageImages({
    pdfPath: paperPdfPath,
    pageImages,
    textOutputDir: pageTextsDir,
    maxImages: resolveHtmlEvidenceImageLimit(options)
  });
  const attachedPageImages = evidencePages.map(entry => entry.imagePath);
  const evidenceManifest = buildEvidenceManifest(evidencePages);
  writeJson(evidencePagesPath, evidenceManifest);

  const meta = buildPaperMeta(paperWithResolvedPdf, openreviewData);
  writeJson(paperMetaPath, meta);

  let webCoverage = {
    queriedAt: new Date().toISOString(),
    coverage: [],
    chineseBlogs: [],
    codeRepos: [],
    error: ''
  };
  try {
    webCoverage = {
      ...webCoverage,
      ...await discoverPaperEnrichment({
        paperTitle: meta.title,
        arxivId: meta.arxiv.id
      })
    };
  } catch (error) {
    webCoverage.error = error.message;
  }
  writeJson(webCoveragePath, webCoverage);
  writeText(webCoverageMarkdownPath, `${buildCoverageMarkdown({ paperTitle: meta.title, webCoverage })}\n`);

  const sessionContextPayload = buildSessionContextPayload({
    dateString,
    paper,
    route: semanticContext.route,
    runPaths,
    sessionContextPath: semanticContext.sessionContextPath,
    currentSourcePaths: {
      paperPdfPath,
      paperMetaPath,
      paperTextPath,
      paperTextPreviewPath,
      openreviewSummaryPath,
      pageImagesDir,
      pageTextsDir
    },
    dependencyCards: semanticContext.dependencyCards || []
  });
  if (semanticContext.sessionContextPath) {
    writeJson(semanticContext.sessionContextPath, sessionContextPayload);
  }
  if (semanticContext.recordSessionContextPath) {
    writeJson(semanticContext.recordSessionContextPath, sessionContextPayload);
  }

  const templateHtml = options.htmlTemplate?.templateHtml || '';
  const promptText = buildCodexInlineHtmlPrompt({
    templateHtml,
    paperPdfPath,
    paperMetaPath,
    paperMetaJson: fs.readFileSync(paperMetaPath, 'utf8'),
    paperTextPath,
    paperTextPreviewPath,
    paperTextPreview: fs.readFileSync(paperTextPreviewPath, 'utf8'),
    openreviewSummaryPath,
    openreviewSummary: fs.readFileSync(openreviewSummaryPath, 'utf8'),
    pageImagesDir,
    pageTextsDir,
    pageImageCount: attachedPageImages.length,
    routeContextJson: JSON.stringify({
      date: semanticContext.route?.date || dateString,
      route_logic: semanticContext.route?.routeLogic || '',
      ordered_paper_ids: (semanticContext.route?.orderedPapers || []).map(item => item.paperId),
      current_paper_id: paper.paperId,
      current_route_role: paper.routeRole
    }, null, 2),
    dependencyCardsJson: JSON.stringify((semanticContext.dependencyCards || []).map(card => ({
      paper_id: card.paperId,
      title: card.title,
      route_role: card.routeRole || '',
      compare_axes: card.compareAxes || [],
      why_relevant_to_current: card.whyRelevantToCurrent || ''
    })), null, 2)
  });
  writeText(promptPath, `${promptText}\n`);
  const inputCostSignals = buildHtmlInputCostSignals({
    promptText,
    attachedPageImages
  });

  const codexEnhancement = {
    ok: false,
    enabled: false,
    model: options.codexHtmlModel,
    skipped: true,
    reason: 'single_chain_no_post_generation_patch'
  };
  writeJson(enhancementMetaPath, codexEnhancement);
  const runState = {
    paperTitle: paper.title,
    arxivId: paper.arxivId || '',
    status: 'running',
    stage: 'prepare',
    architecture: 'pdf-first-paper-scoped-tmux-codex-single-chain',
    htmlGenerationMode: options.fastSmoke ? 'fast-smoke' : 'full',
    maxAttempts: DEFAULT_HTML_GENERATION_MAX_ATTEMPTS,
    selectedAttempt: null,
    promptPath,
    htmlPath,
    htmlValidationPath,
    standaloneValidationPath,
    inputCostSignals,
    attempts: []
  };
  writePaperRunState(runStatePath, runState);

  let selectedAttempt = null;
  let lastFailureMessage = '';

  writePaperRunState(runStatePath, {
    ...runState,
    stage: 'generate'
  });

  for (let attemptNumber = 1; attemptNumber <= DEFAULT_HTML_GENERATION_MAX_ATTEMPTS; attemptNumber += 1) {
    const attemptPaths = buildPaperHtmlAttemptPaths(paperDir, attemptNumber);
    const attemptRuntimePaths = buildCodexHtmlTmuxRunPaths({
      workingDir: paperDir,
      targetHtmlPath: attemptPaths.htmlPath,
      finalMessagePath: attemptPaths.finalMessagePath
    });
    writePaperRunState(runStatePath, {
      ...runState,
      stage: 'generate',
      currentAttempt: {
        attempt: attemptNumber,
        attemptDir: attemptPaths.attemptDir,
        promptPath: attemptPaths.promptPath,
        htmlPath: attemptPaths.htmlPath,
        finalMessagePath: attemptPaths.finalMessagePath,
        timeoutMs: options.codexHtmlTimeoutMs,
        runtimeStatusPath: attemptRuntimePaths.statusPath,
        runtimeStdoutPath: attemptRuntimePaths.stdoutPath,
        runtimeStderrPath: attemptRuntimePaths.stderrPath,
        inputCostSignals,
        startedAt: new Date().toISOString()
      }
    });
    try {
      const attemptStartedAtMs = Date.now();
      const attemptResult = await runPaperHtmlGenerationAttempt({
        paperDir,
        promptText,
        attachedPageImages,
        evidencePages,
        options,
        attemptPaths,
        inputCostSignals
      });
      const attemptDurationMs = Date.now() - attemptStartedAtMs;
      const attemptRecord = {
        attempt: attemptNumber,
        status: attemptResult.status,
        attemptDir: attemptPaths.attemptDir,
        promptPath: attemptPaths.promptPath,
        htmlPath: attemptPaths.htmlPath,
        initialHtmlPath: attemptPaths.initialHtmlPath,
        finalMessagePath: attemptPaths.finalMessagePath,
        stdoutPath: attemptPaths.codexStdoutPath,
        stderrPath: attemptPaths.codexStderrPath,
        htmlValidationPath: attemptPaths.htmlValidationPath,
        standaloneValidationPath: attemptPaths.standaloneValidationPath,
        sessionName: attemptResult.sessionName,
        durationMs: attemptDurationMs,
        durationSeconds: Number((attemptDurationMs / 1000).toFixed(3)),
        runtimeStatusPath: attemptResult.runtimePaths?.statusPath || '',
        runtimeStdoutPath: attemptResult.runtimePaths?.stdoutPath || '',
        runtimeStderrPath: attemptResult.runtimePaths?.stderrPath || '',
        inputCostSignals: attemptResult.inputCostSignals || inputCostSignals,
        outputCostSignals: attemptResult.outputCostSignals || {},
        validationFailureSummary: attemptResult.status === 'passed_validation'
          ? ''
          : buildAttemptFailureSummary(attemptResult)
      };
      runState.attempts.push(attemptRecord);
      writePaperRunState(runStatePath, {
        ...runState,
        stage: attemptResult.status === 'passed_validation' ? 'publish' : 'generate_retry',
        currentAttempt: null
      });

      if (attemptResult.status !== 'passed_validation') {
        lastFailureMessage = `attempt ${attemptNumber} failed html validation: ${buildAttemptFailureSummary(attemptResult)}`;
        continue;
      }

      copyFileIfExists(attemptPaths.htmlPath, htmlPath);
      copyFileIfExists(attemptPaths.initialHtmlPath, initialHtmlPath);
      copyFileIfExists(attemptPaths.finalMessagePath, finalMessagePath);
      copyFileIfExists(attemptPaths.codexStdoutPath, codexStdoutPath);
      copyFileIfExists(attemptPaths.codexStderrPath, codexStderrPath);
      copyFileIfExists(attemptPaths.initialModelMessagePath, initialModelMessagePath);
      copyFileIfExists(attemptPaths.initialModelRawPath, initialModelRawPath);
      copyFileIfExists(attemptPaths.htmlValidationScreenshotPath, htmlValidationScreenshotPath);
      copyFileIfExists(attemptPaths.standaloneValidationScreenshotPath, standaloneValidationScreenshotPath);

      const htmlValidation = {
        ...attemptResult.htmlValidation,
        generationAttempt: attemptNumber,
        screenshotPath: htmlValidationScreenshotPath,
        validationMode: 'final-standalone'
      };
      const standaloneValidation = {
        ...attemptResult.standaloneValidation,
        generationAttempt: attemptNumber,
        screenshotPath: standaloneValidationScreenshotPath,
        validationMode: 'standalone-rerun'
      };
      writeJson(htmlValidationPath, htmlValidation);
      writeJson(standaloneValidationPath, standaloneValidation);

      selectedAttempt = {
        ...attemptResult,
        attemptPaths,
        durationMs: attemptDurationMs,
        htmlValidation,
        standaloneValidation
      };
      break;
    } catch (error) {
      const currentAttemptStartedAt = runState.currentAttempt?.startedAt
        ? new Date(runState.currentAttempt.startedAt).getTime()
        : Date.now();
      const attemptDurationMs = Math.max(0, Date.now() - currentAttemptStartedAt);
      lastFailureMessage = error.message;
      runState.attempts.push({
        attempt: attemptNumber,
        status: 'exec_failed',
        attemptDir: attemptPaths.attemptDir,
        promptPath: attemptPaths.promptPath,
        htmlPath: attemptPaths.htmlPath,
        finalMessagePath: attemptPaths.finalMessagePath,
        stdoutPath: attemptPaths.codexStdoutPath,
        stderrPath: attemptPaths.codexStderrPath,
        runtimeStatusPath: attemptRuntimePaths.statusPath,
        runtimeStdoutPath: attemptRuntimePaths.stdoutPath,
        runtimeStderrPath: attemptRuntimePaths.stderrPath,
        durationMs: attemptDurationMs,
        durationSeconds: Number((attemptDurationMs / 1000).toFixed(3)),
        inputCostSignals,
        error: error.message
      });
      writePaperRunState(runStatePath, {
        ...runState,
        stage: attemptNumber < DEFAULT_HTML_GENERATION_MAX_ATTEMPTS ? 'generate_retry' : 'failed',
        currentAttempt: null
      });
    }
  }

  if (!selectedAttempt) {
    writePaperRunState(runStatePath, {
      ...runState,
      status: 'failed',
      stage: 'failed',
      currentAttempt: null,
      lastFailureMessage
    });
    throw new Error(
      `HTML generation failed after ${DEFAULT_HTML_GENERATION_MAX_ATTEMPTS} fresh attempts: ${lastFailureMessage}`
    );
  }

  writePaperRunState(runStatePath, {
    ...runState,
    status: 'completed',
    stage: 'published',
    currentAttempt: null,
    selectedAttempt: selectedAttempt.attemptNumber,
    generationSource: selectedAttempt.generationSource,
    generationModel: selectedAttempt.generationModel,
    outputCostSignals: selectedAttempt.outputCostSignals || {}
  });

  const paperCard = buildPaperCard({
    paper: {
      ...paperWithResolvedPdf,
      webCoverage
    },
    meta,
    openreviewSummary,
    dateString
  });
  writeJson(paperCardPath, paperCard);

  return {
    ...paperWithResolvedPdf,
    artifactDir: paperDir,
    htmlPath,
    pdfPath: paperPdfPath,
    metaPath: path.join(paperDir, 'paper_meta.json'),
    pageImageCount: pageImages.length,
    attachedPageImageCount: attachedPageImages.length,
    evidencePagesPath,
    generationModel: selectedAttempt.generationModel,
    generationSource: selectedAttempt.generationSource,
    codexEnhancement,
    generationPromptPath: promptPath,
    codexFinalMessagePath: finalMessagePath,
    htmlValidationPath,
    initialHtmlPath,
    paperCard,
    paperCardPath,
    paperMeta: meta,
    openreviewSummary,
    runStatePath,
    standaloneValidationPath,
    webCoverage,
    webCoveragePath,
    webCoverageMarkdownPath
  };
}

function buildCandidateLog(results) {
  return results.flatMap(result => result.papers.map(paper => ({
    query: result.query,
    title: paper.title,
    arxivId: paper.arxivId,
    published: paper.published
  })));
}

function packageRunArtifacts(runPaths) {
  createTarGz({
    outputPath: runPaths.packagePath,
    cwd: runPaths.runDir,
    entries: [
      'reading_route.json',
      'reading_route.md',
      'dependency_graph.json',
      'dependency_cards',
      'session_contexts',
      'daily_curation.json',
      'brief.md',
      'reading_order.md',
      'method_tree_delta.md',
      'method_tree.md',
      'method_tree.json',
      'telegram_message.txt',
      'manifest.json',
      'candidate_pool.jsonl',
      'papers'
    ]
  });
}

function packageTelegramArtifacts(runPaths, artifactPapers) {
  const zeroPaperDay = artifactPapers.length === 0;
  return {
    telegramLedgerPath: path.join(
      runPaths.runDir,
      zeroPaperDay ? 'brief.md' : 'method_tree.md'
    ),
    telegramLedgerTitle: zeroPaperDay ? 'Research Brief' : 'Research Ledger',
    paperFiles: artifactPapers.map(paper => ({
      title: paper.title,
      filePath: paper.htmlPath
    }))
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const resolvedEnv = resolveProcessEnv(options);
  Object.assign(process.env, resolvedEnv);
  Object.assign(options, resolveRuntimeModelConfig(resolvedEnv));
  options.rateLimiter = new MinuteRateLimiter(Number(resolvedEnv.RESEARCH_INTEL_RATE_LIMIT_PER_MINUTE || '5'));
  options.htmlTemplate = resolveHtmlTemplateReference({
    rootDir: ROOT_DIR,
    profileDir: options.profileDir
  });
  if (!options.codexHtmlEnhancementEnabled) {
    throw new Error('Missing runtime configuration: RESEARCH_INTEL_CODEX_HTML_MODEL must be set for the PDF-first tmux-backed Codex HTML chain.');
  }

  const profile = loadProfile(options.profileDir);
  const history = readSentHistory(options.historyDir);

  for (const title of history.titles) {
    profile.readTitles.add(title);
  }

  const dateString = options.dateString || dateStringInTimezone(profile.timezone);
  const now = new Date(`${dateString}T00:00:00Z`);
  const runPaths = buildRunPaths(options.baseDir, dateString);
  const recordPaths = buildRecordPaths(options.recordsDir, dateString);
  fs.rmSync(runPaths.runDir, { recursive: true, force: true });
  fs.rmSync(recordPaths.runDir, { recursive: true, force: true });
  ensureDir(runPaths.runDir);
  ensureDir(runPaths.papersDir);
  ensureDir(runPaths.dependencyCardsDir);
  ensureDir(runPaths.sessionContextsDir);
  ensureDir(recordPaths.runDir);
  ensureDir(recordPaths.dependencyCardsDir);
  ensureDir(recordPaths.sessionContextsDir);
  ensureDir(recordPaths.knowledgeDir);
  ensureDir(options.historyDir);

  const candidateResult = await fetchCandidates(profile, options.maxResultsPerQuery);
  writeText(
    path.join(runPaths.runDir, 'candidate_pool.jsonl'),
    buildCandidateLog(candidateResult.results).map(item => JSON.stringify(item)).join('\n') + '\n'
  );
  writeJson(path.join(runPaths.runDir, 'query_results.json'), candidateResult.results.map(result => ({
    query: result.query,
    count: result.papers.length,
    error: result.error
  })));

  const scoredCandidates = scoreCandidates(candidateResult.candidates, profile, now);
  writeJson(path.join(runPaths.runDir, 'ranked_candidates.json'), scoredCandidates.slice(0, 30));

  const targetPaperCount = desiredPaperCount(profile, options.paperLimit);
  const generationTargetCount = Math.min(profile.maxPapers, targetPaperCount + 2);
  const dailyPicks = splitDailyPicks(scoredCandidates, profile, generationTargetCount);
  const initialGenerationQueue = decorateSelectedPapers(
    dailyPicks.mustRead,
    profile,
    now
  );
  const plannedGeneration = planDailyGenerationRoute({
    dateString,
    selectedPapers: initialGenerationQueue
  });
  const generationQueue = plannedGeneration.generationQueue;
  const initialWatchlist = decorateWatchlistPapers(
    dailyPicks.watchlist,
    profile,
    now
  );
  writeJson(runPaths.readingRouteJsonPath, plannedGeneration.route);
  writeText(runPaths.readingRouteMarkdownPath, `${buildReadingRouteMarkdown(plannedGeneration.route)}\n`);
  writeJson(runPaths.dependencyGraphPath, plannedGeneration.dependencyGraph);
  writeJson(recordPaths.readingRouteJsonPath, plannedGeneration.route);
  writeText(recordPaths.readingRouteMarkdownPath, `${buildReadingRouteMarkdown(plannedGeneration.route)}\n`);
  writeJson(recordPaths.dependencyGraphPath, plannedGeneration.dependencyGraph);

  writeJson(path.join(runPaths.runDir, 'selected_papers.json'), generationQueue);
  writeJson(path.join(runPaths.runDir, 'watchlist_papers.json'), initialWatchlist);

  const artifactPapers = [];
  const artifactFailures = [];
  const dependencyCardIndex = new Map();
  for (const paper of generationQueue) {
    const artifactIndex = artifactPapers.length;
    const paperDir = path.join(runPaths.papersDir, `${String(artifactIndex + 1).padStart(2, '0')}-${paper.slug}`);
    const dependencyCardFilename = buildDependencyCardFilename(paper.rank || artifactIndex + 1, paper.slug);
    const sessionContextFilename = buildSessionContextFilename(paper.rank || artifactIndex + 1, paper.slug);
    try {
      const generatedPaper = await generatePaperArtifacts(
        paper,
        artifactIndex,
        runPaths,
        options,
        dateString,
        {
          route: plannedGeneration.route,
          dependencyCards: (paper.dependencyPaperIds || [])
            .map(paperId => dependencyCardIndex.get(paperId))
            .filter(Boolean),
          sessionContextPath: path.join(runPaths.sessionContextsDir, sessionContextFilename),
          recordSessionContextPath: path.join(recordPaths.sessionContextsDir, sessionContextFilename)
        }
      );
      const dependencyCardPath = path.join(runPaths.dependencyCardsDir, dependencyCardFilename);
      const recordDependencyCardPath = path.join(recordPaths.dependencyCardsDir, dependencyCardFilename);
      const dependencyEdges = plannedGeneration.dependencyGraph.dependenciesByPaperId[generatedPaper.paperId] || [];
      const dependencyCards = (paper.dependencyPaperIds || [])
        .map(paperId => dependencyCardIndex.get(paperId))
        .filter(Boolean);
      const dependencyCardPayload = buildDependencyCardPayload({
        dateString,
        paper: generatedPaper,
        paperCard: generatedPaper.paperCard,
        dependencyEdges,
        dependencyCards,
        dependencyCardPath,
        sessionContextPath: path.join(runPaths.sessionContextsDir, sessionContextFilename)
      });
      writeJson(dependencyCardPath, dependencyCardPayload);
      writeJson(recordDependencyCardPath, dependencyCardPayload);
      generatedPaper.dependencyPaperIds = paper.dependencyPaperIds || [];
      generatedPaper.dependencyCardPath = dependencyCardPath;
      generatedPaper.recordDependencyCardPath = recordDependencyCardPath;
      generatedPaper.dependencyCard = dependencyCardPayload;
      generatedPaper.sessionContextPath = path.join(runPaths.sessionContextsDir, sessionContextFilename);
      generatedPaper.recordSessionContextPath = path.join(recordPaths.sessionContextsDir, sessionContextFilename);
      artifactPapers.push(generatedPaper);
      dependencyCardIndex.set(generatedPaper.paperId, {
        paperId: generatedPaper.paperId,
        title: generatedPaper.title,
        routeRole: generatedPaper.routeRole,
        routeRank: generatedPaper.rank,
        cardPath: generatedPaper.dependencyCardPath,
        compareAxes: generatedPaper.compareAxes || [],
        whyRelevantToCurrent: generatedPaper.readingReason || generatedPaper.whyHere || ''
      });
    } catch (error) {
      let failureArtifactDir = '';
      if (fs.existsSync(paperDir)) {
        const failedPapersDir = path.join(runPaths.runDir, 'failed_papers');
        ensureDir(failedPapersDir);
        failureArtifactDir = path.join(failedPapersDir, path.basename(paperDir));
        fs.rmSync(failureArtifactDir, { recursive: true, force: true });
        fs.renameSync(paperDir, failureArtifactDir);
      }
      artifactFailures.push({
        title: paper.title,
        arxivId: paper.arxivId,
        message: error.message,
        artifactDir: failureArtifactDir ? repoRelativePath(failureArtifactDir) : '',
        runStatePath: failureArtifactDir ? repoRelativePath(path.join(failureArtifactDir, 'run_state.json')) : ''
      });
    }

    if (artifactPapers.length >= generationTargetCount) {
      break;
    }
  }

  writeJson(path.join(runPaths.runDir, 'artifact_failures.json'), artifactFailures);

  const requiredArtifactCount = minimumArtifactCount({
    profile,
    targetPaperCount,
    generationQueueLength: generationQueue.length
  });

  if (artifactPapers.length < requiredArtifactCount) {
    throw new Error(
      `Only generated ${artifactPapers.length} paper artifacts; need at least ${requiredArtifactCount}. Failures: ${artifactFailures.map(item => `${item.title}: ${item.message}`).join(' | ')}`
    );
  }

  const taxonomy = resolveMethodTaxonomy(profile);
  const dailyCuration = await curateDailySelection({
    papers: artifactPapers,
    profile,
    taxonomy,
    dateString,
    apiBaseUrl: options.htmlApiBaseUrl,
    apiKey: options.htmlApiKey,
    models: options.curationModels,
    rateLimiter: options.rateLimiter,
    timeoutMs: options.chatTimeoutMs
  });
  const curatedArtifactPapers = applyDailyCuration(artifactPapers, dailyCuration, taxonomy)
    .slice(0, targetPaperCount);
  const acceptedTitles = new Set(curatedArtifactPapers.map(paper => normalizeTitle(paper.title)));
  const deferredFromMustRead = generationQueue.filter(paper => !acceptedTitles.has(normalizeTitle(paper.title)));
  const finalWatchlist = dedupeByTitle([
    ...decorateWatchlistPapers(deferredFromMustRead, profile, now),
    ...initialWatchlist
  ]).filter(paper => !acceptedTitles.has(normalizeTitle(paper.title)));
  for (const paper of artifactPapers) {
    if (!acceptedTitles.has(normalizeTitle(paper.title))) {
      fs.rmSync(paper.artifactDir, { recursive: true, force: true });
    }
  }
  writeJson(path.join(runPaths.runDir, 'daily_curation.json'), dailyCuration);
  writeJson(path.join(recordPaths.runDir, 'daily_curation.json'), dailyCuration);

  const acceptedRuns = loadAcceptedRuns(options.recordsDir, dateString);
  const previousMethodTree = rebuildMethodTree({
    profile,
    runs: acceptedRuns,
    defaultDateString: dateString
  });
  const methodTree = rebuildMethodTree({
    profile,
    runs: [
      ...acceptedRuns,
      {
        dateString,
        selectedPapers: curatedArtifactPapers
      }
    ],
    defaultDateString: dateString
  });
  const methodTreeDelta = buildMethodTreeDelta(previousMethodTree, methodTree);
  const methodTreeMarkdown = renderMethodTreeMarkdown(methodTree);
  const methodTreeDeltaMarkdown = buildMethodTreeDeltaMarkdown({
    dateString,
    delta: methodTreeDelta,
    paperCards: artifactPapers.map(paper => paper.paperCard)
  });
  writeJson(recordPaths.methodTreeJsonPath, methodTree);
  writeText(recordPaths.methodTreeMarkdownPath, `${methodTreeMarkdown}\n`);
  writeText(path.join(recordPaths.runDir, 'method_tree_delta.md'), `${methodTreeDeltaMarkdown}\n`);
  writeJson(path.join(runPaths.runDir, 'method_tree.json'), methodTree);
  writeText(path.join(runPaths.runDir, 'method_tree.md'), `${methodTreeMarkdown}\n`);
  writeText(path.join(runPaths.runDir, 'method_tree_delta.md'), `${methodTreeDeltaMarkdown}\n`);

  const manifest = {
    date: dateString,
    timezone: profile.timezone,
    queries: candidateResult.queries,
    selectedCount: curatedArtifactPapers.length,
    selectedTitles: curatedArtifactPapers.map(paper => paper.title),
    watchlistCount: finalWatchlist.length,
    watchlistTitles: finalWatchlist.map(paper => paper.title),
    curation: dailyCuration,
    readingRoute: {
      markdownPath: repoRelativePath(recordPaths.readingRouteMarkdownPath),
      jsonPath: repoRelativePath(recordPaths.readingRouteJsonPath)
    },
    dependencyGraph: {
      jsonPath: repoRelativePath(recordPaths.dependencyGraphPath)
    },
    methodTree: {
      markdownPath: repoRelativePath(recordPaths.methodTreeMarkdownPath),
      jsonPath: repoRelativePath(recordPaths.methodTreeJsonPath)
    },
    papers: curatedArtifactPapers.map(paper => ({
      title: paper.title,
      published: paper.published,
      htmlPath: repoRelativePath(paper.htmlPath),
      pdfPath: repoRelativePath(paper.pdfPath),
      artifactDir: repoRelativePath(paper.artifactDir),
      generationMethod: paper.generationSource || 'codex-tmux-pdf-first',
      generationModel: paper.generationModel,
      codexEnhancement: paper.codexEnhancement,
      pageImageCount: paper.pageImageCount,
      attachedPageImageCount: paper.attachedPageImageCount,
      htmlValidationPath: repoRelativePath(paper.htmlValidationPath),
      standaloneValidationPath: repoRelativePath(paper.standaloneValidationPath),
      branchId: paper.branchId,
      motivationSummary: paper.motivationSummary,
      methodTakeaway: paper.methodTakeaway,
      matchedKeywords: paper.matchedKeywords,
      matchedSignals: paper.matchedSignals,
      reasonWhyToday: paper.reasonWhyToday,
      readingStage: paper.readingStage,
      readingReason: paper.readingReason,
      routeRole: paper.routeRole,
      routeRank: paper.rank,
      dependencyPaperIds: paper.dependencyPaperIds || [],
      dependencyCardPath: repoRelativePath(paper.dependencyCardPath),
      sessionContextPath: repoRelativePath(paper.sessionContextPath),
      paperCardPath: repoRelativePath(paper.paperCardPath),
      paperCard: paper.paperCard,
      webCoverage: paper.webCoverage
    }))
  };
  writeJson(path.join(runPaths.runDir, 'manifest.json'), manifest);
  writeJson(path.join(recordPaths.runDir, 'manifest.json'), manifest);
  writeJson(path.join(runPaths.runDir, 'selected_papers.json'), curatedArtifactPapers);
  writeJson(path.join(runPaths.runDir, 'watchlist_papers.json'), finalWatchlist);
  writeJson(path.join(recordPaths.runDir, 'watchlist_papers.json'), finalWatchlist.map(paper => ({
    title: paper.title,
    published: paper.published,
    arxivId: paper.arxivId,
    branchId: paper.branchId,
    score: paper.score,
    selectionBand: paper.selectionBand,
    motivationSummary: paper.motivationSummary,
    methodTakeaway: paper.methodTakeaway,
    matchedKeywords: paper.matchedKeywords,
    matchedSignals: paper.matchedSignals,
    reasonWhyToday: paper.reasonWhyToday,
    watchlistReason: paper.watchlistReason,
    relatedSeeds: paper.relatedSeeds,
    absUrl: paper.absUrl,
    pdfUrl: paper.pdfUrl
  })));
  writeJson(path.join(recordPaths.runDir, 'selected_papers.json'), curatedArtifactPapers.map(paper => ({
    title: paper.title,
    published: paper.published,
    arxivId: paper.arxivId,
    branchId: paper.branchId,
    motivationSummary: paper.motivationSummary,
    methodTakeaway: paper.methodTakeaway,
    matchedKeywords: paper.matchedKeywords,
    matchedSignals: paper.matchedSignals,
    reasonWhyToday: paper.reasonWhyToday,
    readingStage: paper.readingStage,
    readingReason: paper.readingReason,
    routeRole: paper.routeRole,
    routeRank: paper.rank,
    dependencyPaperIds: paper.dependencyPaperIds || [],
    relatedSeeds: paper.relatedSeeds,
    htmlPath: repoRelativePath(paper.htmlPath),
    dependencyCardPath: repoRelativePath(paper.dependencyCardPath),
    sessionContextPath: repoRelativePath(paper.sessionContextPath),
    paperCardPath: repoRelativePath(paper.paperCardPath),
    paperCard: paper.paperCard,
    webCoverage: paper.webCoverage
  })));

  const briefMarkdown = buildBriefMarkdown(curatedArtifactPapers, dateString, dailyCuration, finalWatchlist);
  const readingOrderMarkdown = buildReadingOrderMarkdown(curatedArtifactPapers, dateString, dailyCuration);
  writeText(path.join(runPaths.runDir, 'brief.md'), briefMarkdown);
  writeText(path.join(runPaths.runDir, 'reading_order.md'), readingOrderMarkdown);
  writeText(path.join(recordPaths.runDir, 'brief.md'), briefMarkdown);
  writeText(path.join(recordPaths.runDir, 'reading_order.md'), readingOrderMarkdown);
  writeText(path.join(recordPaths.runDir, 'method_tree.md'), `${methodTreeMarkdown}\n`);
  writeJson(path.join(recordPaths.runDir, 'method_tree.json'), methodTree);

  const telegramMessage = buildTelegramMessage({
    dateString,
    selectedPapers: curatedArtifactPapers,
    watchlistPapers: finalWatchlist,
    artifactPackage: runPaths.packagePath
  });
  writeText(path.join(runPaths.runDir, 'telegram_message.txt'), `${telegramMessage}\n`);

  packageRunArtifacts(runPaths);
  const telegramBundles = packageTelegramArtifacts(runPaths, curatedArtifactPapers);
  const deliveryStatusPath = path.join(runPaths.runDir, 'delivery_status.json');
  const recordDeliveryStatusPath = path.join(recordPaths.runDir, 'delivery_status.json');
  const deliveryPlan = buildDeliveryPlan({
    dateString,
    historyDir: options.historyDir,
    paperFiles: telegramBundles.paperFiles,
    ledgerPath: telegramBundles.telegramLedgerPath,
    ledgerTitle: telegramBundles.telegramLedgerTitle
  });
  const persistDeliveryStatus = status => ({
    ...status,
    items: (status.items || []).map(item => ({
      ...item,
      filePath: item.filePath ? repoRelativePath(item.filePath) : '',
      existingReceipt: item.existingReceipt ? {
        ...item.existingReceipt,
        filePath: item.existingReceipt.filePath ? String(item.existingReceipt.filePath) : ''
      } : null
    }))
  });
  const writeDeliveryStatus = status => {
    const persisted = persistDeliveryStatus(status);
    updateDeliveryStatus(deliveryStatusPath, persisted);
    updateDeliveryStatus(recordDeliveryStatusPath, persisted);
  };
  writeDeliveryStatus({
    ...deliveryPlan,
    runDir: repoRelativePath(runPaths.runDir)
  });

  const summaryLine = `Research Intelligence ${dateString}: generated ${curatedArtifactPapers.length} papers at ${runPaths.runDir}`;
  console.log(summaryLine);
  console.log(`Package: ${runPaths.packagePath}`);

  if (!options.noTelegram) {
    for (const [index, item] of deliveryPlan.items.entries()) {
      if (item.status === 'already_sent_same_hash') {
        writeDeliveryStatus(deliveryPlan);
        continue;
      }

      const caption = item.kind === 'ledger'
        ? `${item.title || 'Research Ledger'} ${dateString}`
        : `HTML ${index + 1}: ${item.title.slice(0, 80)}`;

      try {
        const telegramResult = await sendTelegramDocument({
          filePath: item.filePath,
          caption,
          disableNotification: options.disableNotification
        });
        item.status = 'sent';
        item.sentAt = new Date().toISOString();
        item.messageId = telegramResult?.message_id || telegramResult?.messageId || null;
        appendJsonl(deliveryReceiptsPath(options.historyDir), [{
          date: dateString,
          kind: item.kind,
          title: item.title,
          filePath: repoRelativePath(item.filePath),
          fileHash: item.fileHash,
          messageId: item.messageId,
          sentAt: item.sentAt,
          runDir: repoRelativePath(runPaths.runDir)
        }]);
        writeDeliveryStatus(deliveryPlan);
      } catch (error) {
        item.status = 'failed';
        item.error = error.message;
        writeDeliveryStatus(deliveryPlan);
        throw error;
      }
    }
  } else {
    for (const item of deliveryPlan.items) {
      if (!item.status || item.status === 'pending') {
        item.status = 'skipped_telegram_disabled';
      }
    }
    writeDeliveryStatus(deliveryPlan);
  }

  if (!options.noHistory) {
    appendJsonl(history.filePath, curatedArtifactPapers.map(paper => ({
      date: dateString,
      title: paper.title,
      arxivId: paper.arxivId,
      htmlPath: repoRelativePath(paper.htmlPath)
    })));
  }

  appendJsonl(path.join(options.historyDir, 'runs.jsonl'), [{
    date: dateString,
    runDir: repoRelativePath(runPaths.runDir),
    packagePath: repoRelativePath(runPaths.packagePath),
    selectedCount: curatedArtifactPapers.length
  }]);

  if (options.gitCommit) {
    fs.rmSync(path.join(recordPaths.runDir, 'git_commit.json'), { force: true });
    const gitResult = maybeCommitPath({
      repoDir: ROOT_DIR,
      relativePath: relativeToRepo(ROOT_DIR, options.recordsDir),
      message: `research-intel: daily refresh ${dateString}`
    });
    writeJson(path.join(runPaths.runDir, 'git_commit.json'), gitResult);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[research-intel] ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_HTML_GENERATION_MAX_ATTEMPTS,
  buildHtmlInputCostSignals,
  buildPaperHtmlAttemptPaths,
  parseArgs,
  desiredPaperCount,
  minimumArtifactCount,
  resolveHtmlEvidenceImageLimit,
  resolveProcessEnv,
  resolveRuntimeModelConfig,
  shouldLoadProjectEnv,
  scoreCandidates,
  selectForToday,
  splitDailyPicks
  ,
  planDailyGenerationRoute,
  buildSessionContextPayload,
  buildDependencyCardPayload
};
