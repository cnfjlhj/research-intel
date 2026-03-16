#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../../.env'), quiet: true });

const { buildPdfCandidateUrls, buildSearchQueries, fetchArxivEntriesByIds, fetchArxivQuery } = require('./lib/arxiv');
const { MinuteRateLimiter, generateHtmlWithFallbacks } = require('./lib/chat-html');
const { applyDailyCuration, curateDailySelection } = require('./lib/curation');
const {
  buildEvidenceManifest,
  buildCodexInlineHtmlPrompt,
  buildDeterministicFallbackHtml,
  buildHtmlEnhancementPrompt,
  buildHtmlRepairPrompt,
  cleanHtmlResponse,
  injectEvidenceGallery,
  inspectHtmlQuality,
  makeHtmlStandalone,
  replaceFigurePlaceholdersWithEvidence,
  renderPdfPagesToImages,
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
const DEFAULT_RUNTIME_ENV_PATH = path.join(DEFAULT_PROFILE_DIR, 'runtime.env');
const USER_AGENT = 'research-intel-bot/0.1 (+local)';

function parseArgs(argv) {
  const options = {
    profileDir: DEFAULT_PROFILE_DIR,
    baseDir: DEFAULT_BASE_DIR,
    recordsDir: DEFAULT_RECORDS_DIR,
    historyDir: DEFAULT_HISTORY_DIR,
    runtimeEnvPath: DEFAULT_RUNTIME_ENV_PATH,
    maxResultsPerQuery: 12,
    paperLimit: null,
    noTelegram: false,
    disableNotification: false,
    noHistory: false,
    gitCommit: false,
    dateString: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--profile-dir') {
      options.profileDir = path.resolve(argv[index + 1]);
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

  return options;
}

function ensureDir(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
}

function loadRuntimeEnv(runtimeEnvPath) {
  if (runtimeEnvPath && fs.existsSync(runtimeEnvPath)) {
    dotenv.config({ path: runtimeEnvPath, quiet: true, override: true });
  }
}

function writeJson(targetPath, data) {
  fs.writeFileSync(targetPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function writeText(targetPath, text) {
  fs.writeFileSync(targetPath, text, 'utf8');
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

function normalizeHtmlForAudit(html) {
  return String(html || '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function applyDeterministicFallbackArtifact({
  paper,
  meta,
  openreviewSummary,
  paperTextPreview,
  webCoverage,
  htmlPath,
  fallbackHtmlPath,
  metadataPath,
  screenshotPath,
  evidencePages,
  reason,
  makeStandalone = false
}) {
  const fallbackHtml = buildDeterministicFallbackHtml({
    meta,
    openreviewSummary,
    paperTextPreview,
    webCoverage
  });

  writeText(fallbackHtmlPath, `${fallbackHtml}\n`);
  writeText(
    htmlPath,
    `${injectEvidenceGallery(replaceFigurePlaceholdersWithEvidence(fallbackHtml, evidencePages), evidencePages)}\n`
  );

  if (makeStandalone) {
    await makeHtmlStandalone(htmlPath);
  }

  const validation = await validateHtmlWithBrowser({
    htmlPath,
    screenshotPath,
    evidencePages
  });

  const metadata = {
    used: true,
    ok: validation.ok,
    paperTitle: paper.title,
    reason,
    makeStandalone,
    fallbackHtmlPath,
    screenshotPath,
    validation
  };
  writeJson(metadataPath, metadata);

  return metadata;
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

async function generatePaperArtifacts(paper, index, runPaths, options, dateString) {
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
  const finalMessagePath = path.join(paperDir, 'codex_final_message.txt');
  const codexStdoutPath = path.join(paperDir, 'codex_stdout.txt');
  const codexStderrPath = path.join(paperDir, 'codex_stderr.txt');
  const geminiInitialMessagePath = path.join(paperDir, 'gemini_initial_message.txt');
  const geminiInitialRawPath = path.join(paperDir, 'gemini_initial_raw.json');
  const enhancementPromptPath = path.join(paperDir, 'codex_enhancement_prompt.md');
  const enhancementMessagePath = path.join(paperDir, 'codex_enhancement_message.txt');
  const enhancementStdoutPath = path.join(paperDir, 'codex_enhancement_stdout.txt');
  const enhancementStderrPath = path.join(paperDir, 'codex_enhancement_stderr.txt');
  const enhancementMetaPath = path.join(paperDir, 'codex_enhancement.json');
  const webCoveragePath = path.join(paperDir, 'web_coverage.json');
  const webCoverageMarkdownPath = path.join(paperDir, 'web_coverage.md');
  const htmlPath = path.join(paperDir, 'index.html');
  const initialHtmlPath = path.join(paperDir, 'index.initial.html');
  const fallbackHtmlPath = path.join(paperDir, 'index.deterministic-fallback.html');
  const htmlValidationPath = path.join(paperDir, 'html_validation.json');
  const htmlValidationScreenshotPath = path.join(paperDir, 'html_validation.png');
  const standaloneValidationPath = path.join(paperDir, 'standalone_validation.json');
  const standaloneValidationScreenshotPath = path.join(paperDir, 'standalone_validation.png');
  const fallbackValidationMetaPath = path.join(paperDir, 'deterministic_fallback.validation.json');
  const fallbackValidationScreenshotPath = path.join(paperDir, 'deterministic_fallback.validation.png');
  const fallbackStandaloneMetaPath = path.join(paperDir, 'deterministic_fallback.standalone.json');
  const fallbackStandaloneScreenshotPath = path.join(paperDir, 'deterministic_fallback.standalone.png');
  const evidencePagesPath = path.join(paperDir, 'evidence_pages.json');
  const paperCardPath = path.join(paperDir, 'paper_card.json');
  const repairDir = path.join(paperDir, 'repair');

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
  writeText(paperTextPreviewPath, truncateForLlm(extractedText));
  const pageImages = renderPdfPagesToImages({
    pdfPath: paperPdfPath,
    outputDir: pageImagesDir
  });
  const evidencePages = selectEvidencePageImages({
    pdfPath: paperPdfPath,
    pageImages,
    textOutputDir: pageTextsDir,
    maxImages: 8
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

  const templateHtml = options.htmlTemplate?.templateHtml || '';
  const promptText = buildCodexInlineHtmlPrompt({
    templateHtml,
    paperMetaJson: fs.readFileSync(paperMetaPath, 'utf8'),
    paperTextPreview: fs.readFileSync(paperTextPreviewPath, 'utf8'),
    openreviewSummary: fs.readFileSync(openreviewSummaryPath, 'utf8'),
    pageImageCount: attachedPageImages.length
  });
  writeText(promptPath, `${promptText}\n`);

  const htmlRun = await generateHtmlWithFallbacks({
    apiBaseUrl: options.htmlApiBaseUrl,
    apiKey: options.htmlApiKey,
    models: options.htmlModels,
    promptText,
    attachedPageImages,
    rateLimiter: options.rateLimiter,
    timeoutMs: options.chatTimeoutMs
  });
  const cleanedHtml = cleanHtmlResponse(htmlRun.content);
  writeText(finalMessagePath, `${htmlRun.content}\n`);
  writeText(codexStdoutPath, `${htmlRun.raw}\n`);
  writeText(codexStderrPath, '');
  writeText(geminiInitialMessagePath, `${htmlRun.content}\n`);
  writeText(geminiInitialRawPath, `${htmlRun.raw}\n`);
  writeText(initialHtmlPath, `${cleanedHtml}\n`);
  writeText(htmlPath, `${cleanedHtml}\n`);

  let codexEnhancement = {
    ok: false,
    enabled: options.codexHtmlEnhancementEnabled,
    model: options.codexHtmlModel,
    error: ''
  };
  if (!options.codexHtmlEnhancementEnabled) {
    codexEnhancement = {
      ok: false,
      enabled: false,
      model: '',
      skipped: true,
      reason: 'disabled'
    };
  } else {
    try {
      const htmlBeforeEnhancement = fs.readFileSync(htmlPath, 'utf8');
      const qualityBeforeEnhancement = inspectHtmlQuality(htmlBeforeEnhancement, evidencePages);
      const codexEvidenceImages = attachedPageImages;
      const enhancementPrompt = buildHtmlEnhancementPrompt({
        currentHtml: htmlBeforeEnhancement,
        paperMetaJson: fs.readFileSync(paperMetaPath, 'utf8'),
        paperTextPreview: truncateForLlm(fs.readFileSync(paperTextPath, 'utf8'), 22000),
        openreviewSummary: fs.readFileSync(openreviewSummaryPath, 'utf8'),
        webCoverageJson: fs.readFileSync(webCoveragePath, 'utf8'),
        evidenceManifestJson: fs.readFileSync(evidencePagesPath, 'utf8')
      });
      writeText(enhancementPromptPath, `${enhancementPrompt}\n`);
      const enhancementRun = await runCodexHtmlGeneration({
        workingDir: paperDir,
        targetHtmlPath: htmlPath,
        finalMessagePath: enhancementMessagePath,
        promptText: enhancementPrompt,
        attachedPageImages: codexEvidenceImages,
        model: options.codexHtmlModel,
        timeoutMs: options.codexHtmlTimeoutMs
      });
      writeText(enhancementStdoutPath, `${enhancementRun.stdout || ''}\n`);
      writeText(enhancementStderrPath, `${enhancementRun.stderr || ''}\n`);
      const htmlAfterEnhancement = fs.readFileSync(htmlPath, 'utf8');
      const qualityAfterEnhancement = inspectHtmlQuality(htmlAfterEnhancement, evidencePages);
      const changed = normalizeHtmlForAudit(htmlAfterEnhancement) !== normalizeHtmlForAudit(htmlBeforeEnhancement);
      codexEnhancement = {
        ok: true,
        enabled: true,
        model: options.codexHtmlModel,
        timeoutMs: options.codexHtmlTimeoutMs,
        changed,
        attachedImageCount: codexEvidenceImages.length,
        finalMessagePath: enhancementMessagePath,
        promptPath: enhancementPromptPath,
        stdoutPath: enhancementStdoutPath,
        stderrPath: enhancementStderrPath,
        qualityBefore: qualityBeforeEnhancement,
        qualityAfter: qualityAfterEnhancement
      };
    } catch (error) {
      writeText(enhancementStderrPath, `${error.stack || error.message}\n`);
      codexEnhancement = {
        ok: false,
        enabled: true,
        model: options.codexHtmlModel,
        timeoutMs: options.codexHtmlTimeoutMs,
        attachedImageCount: attachedPageImages.length,
        error: error.message
      };
    }
  }
  writeJson(enhancementMetaPath, codexEnhancement);
  writeText(
    htmlPath,
    `${injectEvidenceGallery(replaceFigurePlaceholdersWithEvidence(fs.readFileSync(htmlPath, 'utf8'), evidencePages), evidencePages)}\n`
  );

  let htmlValidation = await validateHtmlWithBrowser({
    htmlPath,
    screenshotPath: htmlValidationScreenshotPath,
    evidencePages
  });
  const repairAttempts = [];
  let validationFallback = null;

  if (!htmlValidation.ok) {
    ensureDir(repairDir);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const repairPrompt = buildHtmlRepairPrompt({
        currentHtml: fs.readFileSync(htmlPath, 'utf8'),
        validationReport: htmlValidation,
        paperMetaJson: fs.readFileSync(paperMetaPath, 'utf8'),
        openreviewSummary: fs.readFileSync(openreviewSummaryPath, 'utf8'),
        paperTextPreview: fs.readFileSync(paperTextPreviewPath, 'utf8')
      });
      const repairPromptPath = path.join(repairDir, `attempt-${attempt}.prompt.md`);
      const repairResponsePath = path.join(repairDir, `attempt-${attempt}.response.txt`);
      const repairRawPath = path.join(repairDir, `attempt-${attempt}.raw.json`);
      const repairValidationPath = path.join(repairDir, `attempt-${attempt}.validation.json`);
      const repairScreenshotPath = path.join(repairDir, `attempt-${attempt}.png`);
      writeText(repairPromptPath, `${repairPrompt}\n`);

      const repairRun = await generateHtmlWithFallbacks({
        apiBaseUrl: options.htmlApiBaseUrl,
        apiKey: options.htmlApiKey,
        models: options.htmlModels,
        promptText: repairPrompt,
        attachedPageImages,
        rateLimiter: options.rateLimiter,
        maxAttemptsPerModel: 1,
        timeoutMs: options.chatTimeoutMs
      });
      const repairedHtml = cleanHtmlResponse(repairRun.content);
      writeText(repairResponsePath, `${repairRun.content}\n`);
      writeText(repairRawPath, `${repairRun.raw}\n`);
      writeText(
        htmlPath,
        `${injectEvidenceGallery(replaceFigurePlaceholdersWithEvidence(repairedHtml, evidencePages), evidencePages)}\n`
      );

      htmlValidation = await validateHtmlWithBrowser({
        htmlPath,
        screenshotPath: repairScreenshotPath,
        evidencePages
      });
      writeJson(repairValidationPath, htmlValidation);
      repairAttempts.push({
        attempt,
        model: repairRun.model,
        promptPath: repairPromptPath,
        responsePath: repairResponsePath,
        rawPath: repairRawPath,
        validationPath: repairValidationPath,
        screenshotPath: repairScreenshotPath,
        ok: htmlValidation.ok
      });

      if (htmlValidation.ok) {
        break;
      }
    }
  }

  if (!htmlValidation.ok) {
    validationFallback = await applyDeterministicFallbackArtifact({
      paper,
      meta,
      openreviewSummary,
      paperTextPreview: fs.readFileSync(paperTextPreviewPath, 'utf8'),
      webCoverage,
      htmlPath,
      fallbackHtmlPath,
      metadataPath: fallbackValidationMetaPath,
      screenshotPath: fallbackValidationScreenshotPath,
      evidencePages,
      reason: 'html validation failed after model repair attempts'
    });
    htmlValidation = validationFallback.validation;
  }

  writeJson(htmlValidationPath, {
    ...htmlValidation,
    repairAttempts,
    deterministicFallback: validationFallback
  });

  if (!htmlValidation.ok) {
    throw new Error(`HTML validation failed for ${paper.title}: ${JSON.stringify(htmlValidation)}`);
  }

  await makeHtmlStandalone(htmlPath);
  let standaloneValidation = await validateHtmlWithBrowser({
    htmlPath,
    screenshotPath: standaloneValidationScreenshotPath,
    evidencePages
  });
  let standaloneFallback = null;
  if (!standaloneValidation.ok) {
    standaloneFallback = await applyDeterministicFallbackArtifact({
      paper,
      meta,
      openreviewSummary,
      paperTextPreview: fs.readFileSync(paperTextPreviewPath, 'utf8'),
      webCoverage,
      htmlPath,
      fallbackHtmlPath,
      metadataPath: fallbackStandaloneMetaPath,
      screenshotPath: fallbackStandaloneScreenshotPath,
      evidencePages,
      reason: 'standalone html validation failed after inlining local assets',
      makeStandalone: true
    });
    standaloneValidation = standaloneFallback.validation;
  }
  writeJson(standaloneValidationPath, {
    ...standaloneValidation,
    deterministicFallback: standaloneFallback
  });
  if (!standaloneValidation.ok) {
    throw new Error(`Standalone HTML validation failed for ${paper.title}: ${JSON.stringify(standaloneValidation)}`);
  }

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
    generationModel: htmlRun.model,
    codexEnhancement,
    generationPromptPath: promptPath,
    codexFinalMessagePath: finalMessagePath,
    htmlValidationPath,
    initialHtmlPath,
    paperCard,
    paperCardPath,
    paperMeta: meta,
    openreviewSummary,
    standaloneValidationPath,
    webCoverage,
    webCoveragePath,
    webCoverageMarkdownPath,
    deterministicFallback: {
      htmlValidation: validationFallback,
      standaloneValidation: standaloneFallback
    }
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
  return {
    telegramLedgerPath: path.join(runPaths.runDir, 'method_tree.md'),
    paperFiles: artifactPapers.map(paper => ({
      title: paper.title,
      filePath: paper.htmlPath
    }))
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  loadRuntimeEnv(options.runtimeEnvPath);
  options.htmlApiBaseUrl = process.env.RESEARCH_INTEL_API_BASE_URL || '';
  options.htmlApiKey = process.env.RESEARCH_INTEL_API_KEY || '';
  options.htmlModels = (process.env.RESEARCH_INTEL_HTML_MODELS || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  options.curationModels = (process.env.RESEARCH_INTEL_CURATION_MODELS || process.env.RESEARCH_INTEL_HTML_MODELS || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  const configuredChatTimeoutMs = Number(process.env.RESEARCH_INTEL_CHAT_TIMEOUT_MS || '60000');
  options.chatTimeoutMs = Number.isFinite(configuredChatTimeoutMs) && configuredChatTimeoutMs > 0
    ? configuredChatTimeoutMs
    : 60000;
  const codexEnhancementConfig = resolveCodexEnhancementConfig(process.env);
  options.codexHtmlEnhancementEnabled = codexEnhancementConfig.enabled;
  options.codexHtmlModel = codexEnhancementConfig.model;
  options.codexHtmlTimeoutMs = codexEnhancementConfig.timeoutMs;
  options.rateLimiter = new MinuteRateLimiter(Number(process.env.RESEARCH_INTEL_RATE_LIMIT_PER_MINUTE || '5'));
  options.htmlTemplate = resolveHtmlTemplateReference({
    rootDir: ROOT_DIR,
    profileDir: options.profileDir
  });
  if (!options.htmlApiBaseUrl || !options.htmlApiKey || options.htmlModels.length === 0) {
    throw new Error('Missing RESEARCH_INTEL_API_BASE_URL / RESEARCH_INTEL_API_KEY / RESEARCH_INTEL_HTML_MODELS runtime configuration.');
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
  ensureDir(recordPaths.runDir);
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
  const generationQueue = decorateSelectedPapers(
    dailyPicks.mustRead,
    profile,
    now
  );
  const initialWatchlist = decorateWatchlistPapers(
    dailyPicks.watchlist,
    profile,
    now
  );
  if (generationQueue.length === 0) {
    throw new Error('No candidate papers were selected for today.');
  }

  writeJson(path.join(runPaths.runDir, 'selected_papers.json'), generationQueue);
  writeJson(path.join(runPaths.runDir, 'watchlist_papers.json'), initialWatchlist);

  const artifactPapers = [];
  const artifactFailures = [];
  for (const paper of generationQueue) {
    const artifactIndex = artifactPapers.length;
    try {
      artifactPapers.push(await generatePaperArtifacts(
        paper,
        artifactIndex,
        runPaths,
        options,
        dateString
      ));
    } catch (error) {
      fs.rmSync(
        path.join(runPaths.papersDir, `${String(artifactIndex + 1).padStart(2, '0')}-${paper.slug}`),
        { recursive: true, force: true }
      );
      artifactFailures.push({
        title: paper.title,
        arxivId: paper.arxivId,
        message: error.message
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
    methodTree: {
      markdownPath: repoRelativePath(recordPaths.methodTreeMarkdownPath),
      jsonPath: repoRelativePath(recordPaths.methodTreeJsonPath)
    },
    papers: curatedArtifactPapers.map(paper => ({
      title: paper.title,
      published: paper.published,
      htmlPath: repoRelativePath(paper.htmlPath),
      artifactDir: repoRelativePath(paper.artifactDir),
      generationMethod: paper.codexEnhancement?.ok ? 'gemini-draft+codex-enhance' : 'chat-completions',
      generationModel: paper.generationModel,
      codexEnhancement: paper.codexEnhancement,
      pageImageCount: paper.pageImageCount,
      attachedPageImageCount: paper.attachedPageImageCount,
      branchId: paper.branchId,
      motivationSummary: paper.motivationSummary,
      methodTakeaway: paper.methodTakeaway,
      matchedKeywords: paper.matchedKeywords,
      matchedSignals: paper.matchedSignals,
      reasonWhyToday: paper.reasonWhyToday,
      readingStage: paper.readingStage,
      readingReason: paper.readingReason,
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
    relatedSeeds: paper.relatedSeeds,
    htmlPath: repoRelativePath(paper.htmlPath),
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
    ledgerPath: telegramBundles.telegramLedgerPath
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
        ? `Research Ledger ${dateString}`
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
  desiredPaperCount,
  minimumArtifactCount,
  scoreCandidates,
  selectForToday,
  splitDailyPicks
};
