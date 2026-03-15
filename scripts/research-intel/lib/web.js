#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const express = require('express');

const { normalizeTitle, parseResearchBrief } = require('./core');
const { summarizeDeliveryStatus } = require('./delivery');
const { readJsonl } = require('./profile');
const { buildPaperSlug } = require('./daily');
const { FINAL_RUN_STATUSES, reconcileCurrentRunWithHeartbeat } = require('./worker');

const APP_BASE_PATH = '/research-intel';
const SESSION_COOKIE_NAME = 'research_intel_session';
const ACTIVE_RUN_STATUSES = new Set(['submitted', 'running', 'already_running']);

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function formatDate(dateString) {
  const value = String(dateString || '').trim();
  if (!value) {
    return '未知日期';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: value.includes('T') ? '2-digit' : undefined,
    minute: value.includes('T') ? '2-digit' : undefined,
    timeZone: 'Asia/Shanghai'
  }).format(date);
}

function ensureFile(filePath, defaultContent = '') {
  if (fs.existsSync(filePath)) {
    return;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, defaultContent, 'utf8');
}

function readText(filePath, fallback = '') {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : fallback;
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function isPidRunning(pid) {
  const numericPid = Number(pid);
  if (!numericPid || Number.isNaN(numericPid)) {
    return false;
  }

  try {
    process.kill(numericPid, 0);
    return true;
  } catch {
    return false;
  }
}

function serializeJsonl(records) {
  return records.map(record => JSON.stringify(record)).join('\n') + (records.length > 0 ? '\n' : '');
}

function boolFromForm(value) {
  return value === 'on' || value === 'true' || value === '1';
}

function normalizeRecordTitle(record) {
  return normalizeTitle(record?.title || '');
}

function upsertJsonlRecord(records, originalTitle, nextRecord) {
  const originalKey = normalizeTitle(originalTitle || nextRecord.title);
  const nextKey = normalizeRecordTitle(nextRecord);
  const filtered = records.filter(record => normalizeRecordTitle(record) !== originalKey && normalizeRecordTitle(record) !== nextKey);
  filtered.push(nextRecord);
  return filtered.sort((left, right) => String(left.title || '').localeCompare(String(right.title || ''), 'en', { sensitivity: 'base' }));
}

function deleteJsonlRecord(records, title) {
  const key = normalizeTitle(title);
  return records.filter(record => normalizeRecordTitle(record) !== key);
}

function markdownInline(text, rootDir = '') {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (fullMatch, label, href) => {
      const rawHref = String(href || '').trim();
      const nextHref = /^https?:\/\//i.test(rawHref)
        ? rawHref
        : (rootDir ? buildFileUrl(rootDir, rawHref) : rawHref);
      return `<a href="${nextHref}" target="_blank" rel="noreferrer">${label}</a>`;
    });
}

function stripMarkdownFrontmatter(markdown) {
  const source = String(markdown || '').replace(/\r/g, '');
  if (!source.startsWith('---\n')) {
    return source;
  }
  const closingIndex = source.indexOf('\n---\n', 4);
  if (closingIndex === -1) {
    return source;
  }
  return source.slice(closingIndex + 5);
}

function parseMarkdownTableRow(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
    return null;
  }
  const cells = trimmed
    .slice(1, -1)
    .split('|')
    .map(cell => cell.trim());
  return cells.length > 0 ? cells : null;
}

function isMarkdownTableSeparator(line) {
  const cells = parseMarkdownTableRow(line);
  return Boolean(
    cells
    && cells.length > 0
    && cells.every(cell => /^:?-{3,}:?$/.test(cell))
  );
}

function markdownToHtml(markdown, rootDir = '') {
  const lines = stripMarkdownFrontmatter(markdown).split('\n');
  const chunks = [];
  let activeList = '';
  let currentListItem = '';
  let inTable = false;

  function closeTable() {
    if (inTable) {
      chunks.push('</tbody></table>');
      inTable = false;
    }
  }

  function closeLists() {
    if (currentListItem) {
      chunks.push(`<li>${currentListItem}</li>`);
      currentListItem = '';
    }
    if (activeList) {
      chunks.push(`</${activeList}>`);
      activeList = '';
    }
  }

  function closeAllBlocks() {
    closeLists();
    closeTable();
  }

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      if (activeList && currentListItem) {
        continue;
      }
      closeAllBlocks();
      continue;
    }

    const headerCells = parseMarkdownTableRow(trimmed);
    const separatorLine = lines[index + 1] || '';
    if (headerCells && isMarkdownTableSeparator(separatorLine)) {
      closeAllBlocks();
      chunks.push('<table class="table"><thead><tr>');
      for (const cell of headerCells) {
        chunks.push(`<th>${markdownInline(cell, rootDir)}</th>`);
      }
      chunks.push('</tr></thead><tbody>');
      inTable = true;
      index += 1;
      while (index + 1 < lines.length) {
        const nextCells = parseMarkdownTableRow(lines[index + 1]);
        if (!nextCells || isMarkdownTableSeparator(lines[index + 1])) {
          break;
        }
        index += 1;
        chunks.push('<tr>');
        for (const cell of nextCells) {
          chunks.push(`<td>${markdownInline(cell, rootDir)}</td>`);
        }
        chunks.push('</tr>');
      }
      continue;
    }

    if (trimmed.startsWith('### ')) {
      closeAllBlocks();
      chunks.push(`<h3>${markdownInline(trimmed.slice(4), rootDir)}</h3>`);
      continue;
    }

    if (trimmed.startsWith('## ')) {
      closeAllBlocks();
      chunks.push(`<h2>${markdownInline(trimmed.slice(3), rootDir)}</h2>`);
      continue;
    }

    if (trimmed.startsWith('# ')) {
      closeAllBlocks();
      chunks.push(`<h1>${markdownInline(trimmed.slice(2), rootDir)}</h1>`);
      continue;
    }

    if (/^- /.test(trimmed)) {
      closeTable();
      if (activeList === 'ol') {
        closeLists();
      }
      if (activeList !== 'ul') {
        closeLists();
        chunks.push('<ul>');
        activeList = 'ul';
      }
      if (currentListItem) {
        chunks.push(`<li>${currentListItem}</li>`);
      }
      currentListItem = markdownInline(trimmed.slice(2), rootDir);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      closeTable();
      if (activeList === 'ul') {
        closeLists();
      }
      if (activeList !== 'ol') {
        closeLists();
        chunks.push('<ol>');
        activeList = 'ol';
      }
      if (currentListItem) {
        chunks.push(`<li>${currentListItem}</li>`);
      }
      currentListItem = markdownInline(trimmed.replace(/^\d+\.\s+/, ''), rootDir);
      continue;
    }

    if (activeList && currentListItem) {
      currentListItem += `<p>${markdownInline(trimmed, rootDir)}</p>`;
      continue;
    }

    closeAllBlocks();
    chunks.push(`<p>${markdownInline(trimmed, rootDir)}</p>`);
  }

  closeAllBlocks();
  return chunks.join('\n');
}

function createSessionToken(sitePassword, sessionSecret) {
  return crypto
    .createHmac('sha256', String(sessionSecret || sitePassword || 'research-intel'))
    .update(`research-intel:${String(sitePassword || '')}`)
    .digest('hex');
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const trimmed = part.trim();
    if (!trimmed || !trimmed.includes('=')) {
      continue;
    }
    const separatorIndex = trimmed.indexOf('=');
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function encodeFilePathForUrl(filePath) {
  return String(filePath || '')
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

function resolveRepoPath(rootDir, relativeOrAbsolutePath) {
  if (!relativeOrAbsolutePath) {
    return '';
  }

  return path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.resolve(rootDir, relativeOrAbsolutePath);
}

function buildFileUrl(rootDir, relativeOrAbsolutePath) {
  if (!relativeOrAbsolutePath) {
    return '';
  }
  const resolved = resolveRepoPath(rootDir, relativeOrAbsolutePath);
  const normalizedRoot = path.resolve(rootDir);
  const normalizedResolved = path.resolve(resolved);
  const pathForUrl = normalizedResolved.startsWith(`${normalizedRoot}${path.sep}`)
    ? path.relative(normalizedRoot, normalizedResolved)
    : normalizedResolved;
  return `${APP_BASE_PATH}/files/${encodeFilePathForUrl(pathForUrl)}`;
}

function extractArxivId(value) {
  const input = String(value || '').trim();
  if (!input) {
    return '';
  }

  const directId = input.match(/^\d{4}\.\d{4,}(?:v\d+)?$|^[a-zA-Z.\-]+\/\d+(?:v\d+)?$/);
  if (directId) {
    return directId[0];
  }

  const modernUrl = input.match(/https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,}(?:v\d+)?)(?:\.pdf)?/i);
  if (modernUrl) {
    return modernUrl[1];
  }

  const legacyUrl = input.match(/https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/([a-zA-Z.\-]+\/\d+(?:v\d+)?)(?:\.pdf)?/i);
  if (legacyUrl) {
    return legacyUrl[1];
  }

  return '';
}

function buildHjfyUrl(paper) {
  const arxivId = extractArxivId(
    paper?.paperCard?.source_links?.arxiv_pdf
    || paper?.paperCard?.source_links?.arxiv_abs
    || paper?.paperMeta?.arxiv?.pdf_url
    || paper?.paperMeta?.arxiv?.abs_url
    || paper?.pdfUrl
    || paper?.absUrl
    || paper?.paperMeta?.arxiv?.id
    || paper?.arxivId
  );
  return arxivId ? `https://hjfy.top/arxiv/${encodeURIComponent(arxivId)}` : '';
}

function ensureAllowedFile(rootDir, requestedPath) {
  const decodedPath = decodeURIComponent(String(requestedPath || ''));
  const absolutePath = resolveRepoPath(rootDir, decodedPath);
  const normalizedRoot = path.resolve(rootDir);
  const allowedRoots = [
    path.join(normalizedRoot, 'work', 'research-intel', 'daily'),
    path.join(normalizedRoot, 'research-intel-records')
  ].map(item => path.resolve(item));

  if (!absolutePath || !fs.existsSync(absolutePath)) {
    throw new Error('文件不存在');
  }

  const resolved = fs.realpathSync(absolutePath);
  const resolvedAllowedRoots = allowedRoots
    .filter(rootPath => fs.existsSync(rootPath))
    .map(rootPath => fs.realpathSync(rootPath));

  if (!resolvedAllowedRoots.some(rootPath => resolved === rootPath || resolved.startsWith(`${rootPath}${path.sep}`))) {
    throw new Error('不允许访问该文件');
  }

  return resolved;
}

function collectDailySnapshots(rootDir) {
  const dailyRoot = path.join(rootDir, 'research-intel-records', 'daily');
  if (!fs.existsSync(dailyRoot)) {
    return [];
  }

  return fs.readdirSync(dailyRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .filter(entry => /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map(entry => {
      const date = entry.name;
      const runDir = path.join(dailyRoot, date);
      const manifest = readJson(path.join(runDir, 'manifest.json'), {});
      const selectedPapers = readJson(path.join(runDir, 'selected_papers.json'), []);
      const watchlistPapers = readJson(path.join(runDir, 'watchlist_papers.json'), []);
      return {
        date,
        manifest,
        selectedPapers,
        watchlistPapers,
        deliveryStatus: readJson(path.join(runDir, 'delivery_status.json'), {}),
        briefPath: path.join(runDir, 'brief.md'),
        readingOrderPath: path.join(runDir, 'reading_order.md'),
        dailyCurationPath: path.join(runDir, 'daily_curation.json'),
        methodTreePath: path.join(runDir, 'method_tree.md'),
        methodTreeDeltaPath: path.join(runDir, 'method_tree_delta.md')
      };
    })
    .sort((left, right) => right.date.localeCompare(left.date));
}

function findDailySnapshot(rootDir, date) {
  return collectDailySnapshots(rootDir).find(item => item.date === date) || null;
}

function getProfilePaths(rootDir) {
  const profileDir = path.join(rootDir, 'work', 'research-intel', 'profile');
  return {
    profileDir,
    researchBriefPath: path.join(profileDir, 'research_brief.md'),
    seedPapersPath: path.join(profileDir, 'seed_papers.jsonl'),
    feedbackPath: path.join(profileDir, 'feedback.jsonl'),
    methodTaxonomyPath: path.join(profileDir, 'method_taxonomy.json'),
    methodTreeNotesPath: path.join(profileDir, 'method_tree_notes.md'),
    runtimeEnvPath: path.join(profileDir, 'runtime.env')
  };
}

function getRuntimePaths(rootDir) {
  const runtimeDir = path.join(rootDir, 'work', 'research-intel', 'runtime');
  return {
    runtimeDir,
    currentRunPath: path.join(runtimeDir, 'current-run.json'),
    heartbeatPath: path.join(runtimeDir, 'heartbeat.json'),
    workerProgressPath: path.join(runtimeDir, 'worker-progress.md'),
    monitorPidPath: path.join(runtimeDir, 'heartbeat-monitor.pid')
  };
}

function loadSettingsState(rootDir) {
  const profilePaths = getProfilePaths(rootDir);
  ensureFile(profilePaths.researchBriefPath, '# Research Brief\n');
  ensureFile(profilePaths.seedPapersPath, '');
  ensureFile(profilePaths.feedbackPath, '');
  ensureFile(profilePaths.methodTaxonomyPath, '{\n  "root_title": "Self-Evolving Agents",\n  "branches": []\n}\n');
  ensureFile(profilePaths.methodTreeNotesPath, '# Method Tree Notes\n\n');

  const researchBrief = readText(profilePaths.researchBriefPath, '');
  return {
    paths: profilePaths,
    researchBrief,
    parsedBrief: parseResearchBrief(researchBrief),
    seeds: readJsonl(profilePaths.seedPapersPath),
    feedback: readJsonl(profilePaths.feedbackPath),
    methodTaxonomyText: readText(profilePaths.methodTaxonomyPath, '{}\n'),
    methodTreeNotes: readText(profilePaths.methodTreeNotesPath, '# Method Tree Notes\n\n')
  };
}

function summarizeHeartbeatState(runtimePaths, currentRun, heartbeat) {
  const nextHeartbeat = {
    ...(heartbeat || {})
  };
  const monitorPidFileValue = readText(runtimePaths.monitorPidPath, '').trim();
  const monitorPid = Number(monitorPidFileValue || currentRun?.monitorPid || 0);
  const monitorAlive = isPidRunning(monitorPid);
  const checkedAtMs = new Date(nextHeartbeat.checkedAt || '').getTime();
  const freshnessExpired = !Number.isFinite(checkedAtMs)
    || (Date.now() - checkedAtMs) > (30 * 60 * 1000);
  const finalRun = FINAL_RUN_STATUSES.has(String(currentRun?.status || ''));
  const historical = Boolean(nextHeartbeat.historical)
    || finalRun
    || (!monitorAlive && freshnessExpired);

  if (historical) {
    nextHeartbeat.alive = false;
  }

  nextHeartbeat.historical = historical;
  nextHeartbeat.monitorAlive = monitorAlive;
  return nextHeartbeat;
}

function loadRuntimeState(rootDir) {
  const runtimePaths = getRuntimePaths(rootDir);
  const currentRun = readJson(runtimePaths.currentRunPath, {});
  const heartbeat = summarizeHeartbeatState(
    runtimePaths,
    currentRun,
    readJson(runtimePaths.heartbeatPath, {})
  );
  return {
    currentRun: reconcileCurrentRunWithHeartbeat(currentRun, heartbeat),
    heartbeat,
    workerProgress: readText(runtimePaths.workerProgressPath, '')
  };
}

function buildPaperLinks(rootDir, paper) {
  const htmlPath = paper.htmlPath || paper.manifestHtmlPath || '';
  const paperCardPath = paper.paperCardPath || paper.paperCard?.paperCardPath || '';
  const pdfPath = paper.paperCard?.source_links?.arxiv_pdf || paper.pdfPath || paper.pdfUrl || '';

  return {
    htmlUrl: buildFileUrl(rootDir, htmlPath),
    paperCardUrl: buildFileUrl(rootDir, paperCardPath),
    pdfUrl: /^https?:\/\//i.test(pdfPath) ? pdfPath : buildFileUrl(rootDir, pdfPath),
    hjfyUrl: buildHjfyUrl(paper),
    htmlPath: resolveRepoPath(rootDir, htmlPath)
  };
}

function summarizePaperMotivation(paper) {
  return paper.motivationSummary
    || paper.paperCard?.core_problem?.find(item => item && !/命中关键词/.test(item))
    || paper.paperCard?.summary_anchor
    || paper.reasonWhyToday
    || '暂无研究动机摘要。';
}

function summarizePaperMethod(paper) {
  if (paper.methodTakeaway) {
    return paper.methodTakeaway;
  }
  const tags = [
    ...(paper.paperCard?.method_tags || []),
    ...(paper.matchedKeywords || []),
    ...(paper.matchedSignals || [])
  ].filter(Boolean);
  if (tags.length > 0) {
    return `主要切口：${tags.slice(0, 3).join('、')}`;
  }
  return '暂无方法切口摘要。';
}

function renderEvidenceTags(paper) {
  const tags = [];
  const codeCount = (paper.webCoverage?.codeRepos || []).length;
  const blogCount = (paper.webCoverage?.chineseBlogs || []).length;
  const coverageCount = (paper.webCoverage?.coverage || []).length;

  if ((paper.relatedSeeds || []).length > 0) {
    tags.push(`<span class="tag">锚点 ${(paper.relatedSeeds || []).length}</span>`);
  }
  if (codeCount > 0) {
    tags.push(`<span class="tag">代码 ${codeCount}</span>`);
  }
  if (blogCount > 0) {
    tags.push(`<span class="tag">中文博客 ${blogCount}</span>`);
  }
  if (coverageCount > 0) {
    tags.push(`<span class="tag">外部报道 ${coverageCount}</span>`);
  }
  if (paper.paperCard?.availability?.has_openreview) {
    tags.push('<span class="tag">OpenReview</span>');
  }
  return tags.join('');
}

function renderPaperInsightCard(rootDir, paper, index) {
  const links = buildPaperLinks(rootDir, paper);
  const codeLinks = paper.webCoverage?.codeRepos || [];
  const coverageLinks = paper.webCoverage?.coverage || [];
  const blogLinks = paper.webCoverage?.chineseBlogs || [];

  const externalCode = Array.isArray(codeLinks)
    ? codeLinks.slice(0, 2).map(item => `<a class="button ghost" href="${escapeAttr(item.html_url || item.url)}" target="_blank" rel="noreferrer">代码</a>`).join('')
    : '';
  const externalCoverage = Array.isArray(coverageLinks)
    ? coverageLinks.slice(0, 2).map(item => `<a class="button ghost" href="${escapeAttr(item.url)}" target="_blank" rel="noreferrer">报道</a>`).join('')
    : '';
  const externalBlogs = Array.isArray(blogLinks)
    ? blogLinks.slice(0, 2).map(item => `<a class="button ghost" href="${escapeAttr(item.url)}" target="_blank" rel="noreferrer">中文长文</a>`).join('')
    : '';

  return [
    '<article class="paper-card">',
    `<div class="meta-row"><span class="tag">Paper ${index + 1}</span>${paper.readingStage ? `<span class="tag">${escapeHtml(paper.readingStage)}</span>` : ''}${renderEvidenceTags(paper)}</div>`,
    `<h3>${escapeHtml(paper.title || `Paper ${index + 1}`)}</h3>`,
    `<p><strong>研究动机：</strong>${escapeHtml(summarizePaperMotivation(paper))}</p>`,
    `<p><strong>为什么今天看：</strong>${escapeHtml(paper.reasonWhyToday || '暂无')}</p>`,
    `<p><strong>排序理由：</strong>${escapeHtml(paper.readingReason || '暂无')}</p>`,
    `<p class="muted"><strong>方法切口：</strong>${escapeHtml(summarizePaperMethod(paper))}</p>`,
    (paper.relatedSeeds || []).length > 0 ? `<p class="muted"><strong>关联锚点：</strong>${escapeHtml((paper.relatedSeeds || []).map(seed => seed.title).join('；'))}</p>` : '',
    '<div class="actions">',
    links.htmlUrl ? `<a class="button" href="${links.htmlUrl}" target="_blank" rel="noreferrer">打开 HTML</a>` : '',
    links.hjfyUrl ? `<a class="button secondary" href="${links.hjfyUrl}" target="_blank" rel="noreferrer">双栏对照</a>` : '',
    links.pdfUrl ? `<a class="button secondary" href="${links.pdfUrl}" target="_blank" rel="noreferrer">原始 PDF</a>` : '',
    links.paperCardUrl ? `<a class="button ghost" href="${links.paperCardUrl}" target="_blank" rel="noreferrer">Paper Card</a>` : '',
    externalCode,
    externalBlogs,
    externalCoverage,
    '</div>',
    '</article>'
  ].filter(Boolean).join('');
}

function renderMethodTreeFromJson(rootDir, tree) {
  if (!tree || !Array.isArray(tree.branches) || tree.branches.length === 0) {
    return '<article class="paper-card"><h3>暂时还没有长期主线</h3><p class="muted">下一次完整运行后，这里会开始积累动机分支。</p></article>';
  }

  return tree.branches.map(branch => {
    const papersHtml = (branch.papers || []).map(paper => {
      const htmlUrl = buildFileUrl(rootDir, paper.htmlPath);
      const cardUrl = buildFileUrl(rootDir, paper.paperCardPath);
      return [
        '<article class="paper-card">',
        `<div class="meta-row"><span class="tag">${paper.anchor ? '锚点' : '论文'}</span>${paper.status ? `<span class="tag">${escapeHtml(paper.status)}</span>` : ''}</div>`,
        `<h3>${escapeHtml(paper.title)}</h3>`,
        ...(paper.details || []).map(detail => `<p class="muted">${escapeHtml(detail)}</p>`),
        '<div class="actions">',
        htmlUrl ? `<a class="button" href="${htmlUrl}" target="_blank" rel="noreferrer">HTML</a>` : '',
        cardUrl ? `<a class="button ghost" href="${cardUrl}" target="_blank" rel="noreferrer">Paper Card</a>` : '',
        '</div>',
        '</article>'
      ].filter(Boolean).join('');
    }).join('');

    return [
      '<section class="panel">',
      `<div class="section-heading"><h2>${escapeHtml(branch.title)}</h2><span class="small muted">${escapeHtml(String((branch.papers || []).length))} papers</span></div>`,
      branch.question ? `<p><strong>这一支在回答：</strong>${escapeHtml(branch.question)}</p>` : '',
      ...(branch.sharedConcepts || []).map(item => `<p class="muted">${escapeHtml(item)}</p>`),
      `<div class="paper-list">${papersHtml}</div>`,
      '</section>'
    ].filter(Boolean).join('');
  }).join('');
}

function defaultRunDaily(rootDir) {
  const scriptPath = path.join(rootDir, 'scripts', 'research-intel', 'run-daily.sh');
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [scriptPath], {
      cwd: rootDir,
      detached: true,
      stdio: 'ignore'
    });
    child.on('error', reject);
    child.unref();
    resolve({ pid: child.pid });
  });
}

function summarizeSnapshotDelivery(snapshot) {
  return summarizeDeliveryStatus(snapshot?.deliveryStatus || {});
}

function isRuntimeBusy(runtime) {
  return ACTIVE_RUN_STATUSES.has(runtime?.currentRun?.status) && !runtime?.heartbeat?.stale;
}

function statusTone(currentRun) {
  const status = String(currentRun?.status || 'unknown');
  if (status === 'completed') {
    return 'good';
  }
  if (status === 'stale') {
    return 'bad';
  }
  if (ACTIVE_RUN_STATUSES.has(status)) {
    return 'warn';
  }
  if (status === 'failed' || status === 'session_missing') {
    return 'bad';
  }
  return 'muted';
}

function renderShell({
  title,
  activeNav,
  content,
  currentRun,
  flashMessage = ''
}) {
  const navItems = [
    { id: 'dashboard', href: `${APP_BASE_PATH}/`, label: '控制台' },
    { id: 'daily', href: `${APP_BASE_PATH}/daily`, label: '历史日报' },
    { id: 'knowledge', href: `${APP_BASE_PATH}/knowledge`, label: '长期账本' },
    { id: 'settings', href: `${APP_BASE_PATH}/settings`, label: '编辑区' }
  ];

  const navHtml = navItems.map(item => (
    `<a class="nav-link ${item.id === activeNav ? 'is-active' : ''}" href="${item.href}">${escapeHtml(item.label)}</a>`
  )).join('');

  const statusClass = statusTone(currentRun);
  const runStatus = currentRun?.status || 'unknown';

  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `  <title>${escapeHtml(title)} | Research Intelligence</title>`,
    '  <link rel="icon" href="data:,">',
    '  <style>',
    '    :root {',
    '      --bg: #f3eee6;',
    '      --ink: #161311;',
    '      --muted: #74685f;',
    '      --panel: rgba(255,255,255,0.78);',
    '      --panel-strong: rgba(255,255,255,0.92);',
    '      --line: rgba(28, 22, 18, 0.08);',
    '      --accent: #bb5a3c;',
    '      --accent-soft: #efe0d6;',
    '      --accent-2: #23443c;',
    '      --good: #215d52;',
    '      --warn: #a15c19;',
    '      --bad: #8f3025;',
    '      --shadow: 0 22px 60px rgba(45, 31, 20, 0.08);',
    '    }',
    '    * { box-sizing: border-box; }',
    '    html, body { margin: 0; padding: 0; background: radial-gradient(circle at top, rgba(255,255,255,0.9), var(--bg)); color: var(--ink); }',
    '    body { font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif; }',
    '    a { color: inherit; }',
    '    .page { min-height: 100vh; padding: 28px; }',
    '    .chrome { max-width: 1440px; margin: 0 auto; display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 24px; }',
    '    .sidebar { position: sticky; top: 20px; align-self: start; background: linear-gradient(180deg, rgba(27,21,18,0.96), rgba(42,30,25,0.9)); color: #f7f1ea; border-radius: 28px; padding: 28px 24px; box-shadow: var(--shadow); }',
    '    .brand-eyebrow { font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; letter-spacing: 0.18em; text-transform: uppercase; font-size: 12px; opacity: 0.75; }',
    '    .brand-title { margin: 14px 0 8px; font-size: 34px; line-height: 0.98; }',
    '    .brand-copy { margin: 0 0 18px; color: rgba(247, 241, 234, 0.72); line-height: 1.6; }',
    '    .status-pill { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 8px 12px; font-size: 13px; font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.08); }',
    '    .status-dot { width: 8px; height: 8px; border-radius: 999px; background: currentColor; }',
    '    .status-good { color: #8be2cc; }',
    '    .status-warn { color: #ffcc84; }',
    '    .status-bad { color: #ff9d8d; }',
    '    .status-muted { color: #cdb6a5; }',
    '    .nav { margin-top: 26px; display: grid; gap: 10px; }',
    '    .nav-link { display: block; padding: 12px 14px; border-radius: 16px; text-decoration: none; color: rgba(247, 241, 234, 0.82); background: rgba(255,255,255,0.04); border: 1px solid transparent; }',
    '    .nav-link:hover, .nav-link.is-active { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.12); color: #fff7ef; }',
    '    .sidebar form { margin-top: 18px; }',
    '    .logout-button { width: 100%; border: 0; border-radius: 14px; padding: 12px 14px; background: rgba(255,255,255,0.12); color: #fff7ef; cursor: pointer; }',
    '    .main { display: grid; gap: 18px; }',
    '    .hero { position: relative; overflow: hidden; background: linear-gradient(135deg, rgba(255,255,255,0.95), rgba(244, 232, 221, 0.88)); border: 1px solid rgba(34, 23, 16, 0.06); border-radius: 32px; padding: 30px; box-shadow: var(--shadow); }',
    '    .hero::after { content: ""; position: absolute; inset: auto -40px -80px auto; width: 240px; height: 240px; border-radius: 50%; background: radial-gradient(circle, rgba(187, 90, 60, 0.18), rgba(187, 90, 60, 0)); }',
    '    .hero-eyebrow { font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; text-transform: uppercase; letter-spacing: 0.18em; font-size: 12px; color: var(--muted); }',
    '    .hero-title { margin: 10px 0 12px; font-size: clamp(34px, 5vw, 62px); line-height: 0.95; max-width: 10ch; }',
    '    .hero-copy { max-width: 60ch; margin: 0; color: #433831; font-size: 17px; line-height: 1.75; }',
    '    .flash { border-radius: 20px; padding: 14px 18px; background: linear-gradient(90deg, rgba(35,68,60,0.11), rgba(35,68,60,0.05)); border: 1px solid rgba(35,68,60,0.15); color: #1d453e; }',
    '    .grid { display: grid; gap: 18px; }',
    '    .grid.metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }',
    '    .panel { background: var(--panel); backdrop-filter: blur(18px); border: 1px solid var(--line); border-radius: 24px; padding: 22px; box-shadow: var(--shadow); }',
    '    .panel h2, .panel h3 { margin: 0 0 14px; }',
    '    .metric-card { display: grid; gap: 8px; min-height: 140px; }',
    '    .metric-label { font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; color: var(--muted); font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; }',
    '    .metric-value { font-size: 40px; line-height: 1; }',
    '    .metric-copy { color: #53463e; line-height: 1.65; }',
    '    .split { display: grid; grid-template-columns: 1.35fr 1fr; gap: 18px; }',
    '    .paper-list, .timeline { display: grid; gap: 14px; }',
    '    .paper-card, .timeline-card { border-radius: 22px; padding: 18px; background: var(--panel-strong); border: 1px solid var(--line); }',
    '    .paper-card h3, .timeline-card h3 { margin: 0 0 10px; font-size: 22px; }',
    '    .muted { color: var(--muted); }',
    '    .meta-row { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; }',
    '    .tag { display: inline-flex; align-items: center; gap: 6px; padding: 7px 11px; border-radius: 999px; background: var(--accent-soft); color: #7c3b27; font-size: 12px; font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; text-transform: uppercase; letter-spacing: 0.08em; }',
    '    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }',
    '    .button, button.button { appearance: none; border: 0; border-radius: 14px; padding: 11px 14px; background: var(--ink); color: #fff; font: inherit; cursor: pointer; text-decoration: none; }',
    '    .button.secondary, button.button.secondary { background: #ede0d3; color: #352822; }',
    '    .button.ghost, button.button.ghost { background: transparent; border: 1px solid var(--line); color: var(--ink); }',
    '    .toolbar { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 16px; align-items: center; }',
    '    .content-prose { color: #2e2622; line-height: 1.8; }',
    '    .content-prose h1, .content-prose h2, .content-prose h3 { margin-top: 1.2em; margin-bottom: 0.5em; }',
    '    .content-prose ul, .content-prose ol { margin: 0.6em 0 1em 1.2em; }',
    '    .content-prose code { padding: 0.1em 0.35em; border-radius: 6px; background: rgba(0,0,0,0.05); font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; }',
    '    textarea, input[type="text"], input[type="password"], select { width: 100%; border-radius: 16px; border: 1px solid rgba(28,22,18,0.12); padding: 12px 14px; background: rgba(255,255,255,0.92); color: var(--ink); font: inherit; }',
    '    textarea { min-height: 220px; resize: vertical; }',
    '    label { display: grid; gap: 8px; color: #463831; font-size: 14px; }',
    '    .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }',
    '    .form-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }',
    '    .table { width: 100%; border-collapse: collapse; }',
    '    .table th, .table td { text-align: left; vertical-align: top; padding: 12px 10px; border-bottom: 1px solid rgba(28,22,18,0.08); }',
    '    .stack { display: grid; gap: 12px; }',
    '    .section-heading { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; margin-bottom: 12px; }',
    '    .small { font-size: 13px; }',
    '    .login-shell { min-height: 100vh; display: grid; place-items: center; padding: 32px; background: radial-gradient(circle at top, rgba(255,255,255,0.92), rgba(243,238,230,1)); }',
    '    .login-card { width: min(520px, 100%); padding: 28px; border-radius: 28px; background: rgba(255,255,255,0.88); border: 1px solid var(--line); box-shadow: var(--shadow); }',
    '    .login-title { margin: 8px 0 12px; font-size: 42px; line-height: 0.94; }',
    '    @media (max-width: 1120px) { .chrome { grid-template-columns: 1fr; } .sidebar { position: relative; top: auto; } .split, .grid.metrics, .form-grid { grid-template-columns: 1fr; } }',
    '  </style>',
    '</head>',
    '<body>',
    '  <div class="page">',
    '    <div class="chrome">',
    '      <aside class="sidebar">',
    '        <div class="brand-eyebrow">Research Intelligence</div>',
    '        <div class="brand-title">Control Room</div>',
    '        <p class="brand-copy">在一个页面里回看历史、管理研究偏好、打开单篇 HTML，并直接写回你的画像与知识账本文件。</p>',
    `        <div class="status-pill status-${statusClass}"><span class="status-dot"></span><span>${escapeHtml(runStatus)}</span></div>`,
    '        <nav class="nav">',
    `          ${navHtml}`,
    '        </nav>',
    `        <form method="post" action="${APP_BASE_PATH}/logout">`,
    '          <button class="logout-button" type="submit">退出</button>',
    '        </form>',
    '      </aside>',
    '      <main class="main">',
    flashMessage ? `        <div class="flash">${flashMessage}</div>` : '',
    content,
    '      </main>',
    '    </div>',
    '  </div>',
    '</body>',
    '</html>'
  ].filter(Boolean).join('\n');
}

function renderLoginPage(error = false) {
  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '  <title>Research Intel 控制台登录</title>',
    '  <link rel="icon" href="data:,">',
    '  <style>',
    '    body { margin: 0; font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif; color: #171412; background: radial-gradient(circle at top, rgba(255,255,255,0.94), #f3eee6); }',
    '    .shell { min-height: 100vh; display: grid; place-items: center; padding: 28px; }',
    '    .card { width: min(520px, 100%); padding: 28px; border-radius: 30px; background: rgba(255,255,255,0.88); border: 1px solid rgba(28,22,18,0.08); box-shadow: 0 22px 60px rgba(45, 31, 20, 0.08); }',
    '    .eyebrow { font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; text-transform: uppercase; letter-spacing: 0.18em; font-size: 12px; color: #7a6f66; }',
    '    h1 { margin: 12px 0; font-size: 44px; line-height: 0.95; }',
    '    p { color: #574a43; line-height: 1.75; }',
    '    label { display: grid; gap: 8px; margin-top: 18px; color: #43362f; }',
    '    input { width: 100%; border-radius: 16px; border: 1px solid rgba(28,22,18,0.12); padding: 13px 15px; font: inherit; box-sizing: border-box; }',
    '    button { margin-top: 18px; width: 100%; border: 0; border-radius: 16px; padding: 13px 15px; background: #171412; color: #fff; font: inherit; cursor: pointer; }',
    '    .error { margin-top: 16px; border-radius: 16px; padding: 12px 14px; background: rgba(143, 48, 37, 0.08); color: #7a2e24; border: 1px solid rgba(143, 48, 37, 0.16); }',
    '  </style>',
    '</head>',
    '<body>',
    '  <div class="shell">',
    '    <div class="card">',
    '      <div class="eyebrow">Research Intel Console</div>',
    '      <h1>进入你的论文控制台</h1>',
    '      <p>这个站点直接映射你的研究文件。你在这里的修改会写回源文件，并影响后续推荐链路。</p>',
    `      <form method="post" action="${APP_BASE_PATH}/login">`,
    '        <label>访问密码',
    '          <input type="password" name="password" autocomplete="current-password" required>',
    '        </label>',
    '        <button type="submit">进入控制台</button>',
    '      </form>',
    error ? '      <div class="error">密码不正确，请重试。</div>' : '',
    '    </div>',
    '  </div>',
    '</body>',
    '</html>'
  ].join('\n');
}

function buildDashboardContent(rootDir) {
  const runtime = loadRuntimeState(rootDir);
  const snapshots = collectDailySnapshots(rootDir);
  const latest = snapshots[0] || null;
  const settings = loadSettingsState(rootDir);
  const latestDelivery = summarizeSnapshotDelivery(latest);
  const busy = isRuntimeBusy(runtime);
  const latestSummary = latest ? {
    selectedCount: latest.manifest?.selectedCount || latest.selectedPapers.length,
    watchlistCount: latest.manifest?.watchlistCount || latest.watchlistPapers.length,
    titles: latest.manifest?.selectedTitles || latest.selectedPapers.map(item => item.title)
  } : { selectedCount: 0, watchlistCount: 0, titles: [] };
  const heartbeatLabel = runtime.heartbeat?.historical
    ? 'historical'
    : (runtime.heartbeat?.alive ? 'alive' : 'not alive');
  const progressLines = runtime.workerProgress.trim().split('\n').filter(Boolean);
  const latestProgressLine = progressLines.length > 0 ? progressLines[progressLines.length - 1] : '暂无';

  return [
    '        <section class="hero">',
    '          <div class="hero-eyebrow">history / curation / runtime / ledger</div>',
    '          <h1 class="hero-title">Research Intelligence 控制台</h1>',
    '          <p class="hero-copy">这是你的研究操作台，而不是一个静态归档页。你可以在这里回看历史日报、直接打开单篇 HTML、检查每日 worker 心跳，并把研究偏好、锚点论文和人工备注直接写回文件系统。</p>',
    '        </section>',
    '        <section class="grid metrics">',
    `          <div class="panel metric-card"><div class="metric-label">最近一次运行</div><div class="metric-value">${escapeHtml(runtime.currentRun?.status || 'unknown')}</div><div class="metric-copy">目标日期：${escapeHtml(runtime.currentRun?.date || '暂无')}<br>最近输出：${escapeHtml(runtime.heartbeat?.lastNonEmptyLine || latestProgressLine)}</div></div>`,
    `          <div class="panel metric-card"><div class="metric-label">最近日报</div><div class="metric-value">${escapeHtml(String(latestSummary.selectedCount))}</div><div class="metric-copy">最近一次日报共收录 ${escapeHtml(String(latestSummary.selectedCount))} 篇主推论文、${escapeHtml(String(latestSummary.watchlistCount))} 篇观察池论文，最新日期 ${escapeHtml(latest?.date || '暂无')}</div></div>`,
    `          <div class="panel metric-card"><div class="metric-label">投递状态</div><div class="metric-value">${escapeHtml(`${latestDelivery.completedCount}/${latestDelivery.expectedCount}`)}</div><div class="metric-copy">最近一次日报 Telegram 已完成 ${escapeHtml(String(latestDelivery.completedCount))} / ${escapeHtml(String(latestDelivery.expectedCount))} 份文件投递。</div></div>`,
    '        </section>',
    '        <section class="split">',
    '          <div class="panel">',
    '            <div class="toolbar"><h2>最近日报</h2><a class="button ghost" href="/research-intel/daily">查看全部</a></div>',
    '            <div class="timeline">',
    latest ? snapshots.slice(0, 7).map(snapshot => {
      const count = snapshot.manifest?.selectedCount || snapshot.selectedPapers.length;
      const watchlistCount = snapshot.manifest?.watchlistCount || snapshot.watchlistPapers.length;
      const delivery = summarizeSnapshotDelivery(snapshot);
      return `<article class="timeline-card"><div class="meta-row"><span class="tag">${escapeHtml(snapshot.date)}</span><span class="tag">${escapeHtml(String(count))} papers</span><span class="tag">watch ${escapeHtml(String(watchlistCount))}</span><span class="tag">send ${escapeHtml(String(delivery.completedCount))}/${escapeHtml(String(delivery.expectedCount))}</span></div><h3>${escapeHtml(snapshot.date)}</h3><p class="muted">${escapeHtml((snapshot.manifest?.selectedTitles || snapshot.selectedPapers.map(item => item.title)).slice(0, 3).join('；') || '暂无')}</p><div class="actions"><a class="button" href="${APP_BASE_PATH}/daily/${encodeURIComponent(snapshot.date)}">进入日报</a></div></article>`;
    }).join('') : '<div class="timeline-card"><h3>还没有日报记录</h3><p class="muted">先跑一次 daily pipeline，这里就会出现历史。</p></div>',
    '            </div>',
    '          </div>',
    '          <div class="stack">',
    '            <section class="panel">',
    '              <div class="section-heading"><h2>运行状态</h2><span class="small muted">来自 runtime/</span></div>',
    `              <p><strong>状态：</strong>${escapeHtml(runtime.currentRun?.status || 'unknown')}</p>`,
    `              <p><strong>Session：</strong>${escapeHtml(runtime.currentRun?.sessionName || '暂无')}</p>`,
    `              <p><strong>Heartbeat：</strong>${escapeHtml(heartbeatLabel)} / stale=${escapeHtml(String(runtime.heartbeat?.stale ?? 'unknown'))}</p>`,
    `              <p><strong>最近进展：</strong>${escapeHtml(latestProgressLine)}</p>`,
    '              <form method="post" action="/research-intel/actions/run">',
    `                <button class="button ${busy ? 'secondary' : ''}" type="submit" ${busy ? 'disabled' : ''}>${busy ? '当前已有运行中的 worker' : '立即手动触发一次今日运行'}</button>`,
    '              </form>',
    '            </section>',
    '            <section class="panel">',
    '              <div class="section-heading"><h2>当前主线</h2><a class="button ghost" href="/research-intel/settings">编辑</a></div>',
    `              <div class="content-prose">${markdownToHtml(settings.researchBrief.split('## Positive Signals')[0], rootDir)}</div>`,
    '            </section>',
    '          </div>',
    '        </section>'
  ].join('\n');
}

function renderDashboard(rootDir, flashMessage = '') {
  const runtime = loadRuntimeState(rootDir);
  return renderShell({
    title: '控制台',
    activeNav: 'dashboard',
    content: buildDashboardContent(rootDir),
    currentRun: runtime.currentRun,
    flashMessage
  });
}

function renderDailyIndex(rootDir) {
  const snapshots = collectDailySnapshots(rootDir);
  const runtime = loadRuntimeState(rootDir);

  const content = [
    '        <section class="hero">',
    '          <div class="hero-eyebrow">History</div>',
    '          <h1 class="hero-title">历史日报回看</h1>',
    '          <p class="hero-copy">按天回看 brief、reading order、长期账本增量和每篇论文 HTML。这个页面解决的是“昨天、前一周、前几次到底推了什么”的问题。</p>',
    '        </section>',
    '        <section class="panel">',
    '          <div class="timeline">',
    snapshots.length > 0 ? snapshots.map(snapshot => {
      const count = snapshot.manifest?.selectedCount || snapshot.selectedPapers.length;
      const watchlistCount = snapshot.manifest?.watchlistCount || snapshot.watchlistPapers.length;
      const titles = snapshot.manifest?.selectedTitles || snapshot.selectedPapers.map(item => item.title);
      const dailyCuration = readJson(snapshot.dailyCurationPath, {});
      const delivery = summarizeSnapshotDelivery(snapshot);
      return `<article class="timeline-card"><div class="meta-row"><span class="tag">${escapeHtml(snapshot.date)}</span><span class="tag">${escapeHtml(String(count))} papers</span><span class="tag">watch ${escapeHtml(String(watchlistCount))}</span><span class="tag">send ${escapeHtml(String(delivery.completedCount))}/${escapeHtml(String(delivery.expectedCount))}</span></div><h3>${escapeHtml(snapshot.date)}</h3><p>${escapeHtml(dailyCuration.overview || '暂无总编概览。')}</p><p class="muted">${escapeHtml(titles.join('；') || '暂无')}</p><div class="actions"><a class="button" href="${APP_BASE_PATH}/daily/${encodeURIComponent(snapshot.date)}">打开这一天</a></div></article>`;
    }).join('') : '<article class="timeline-card"><h3>暂无历史日报</h3><p class="muted">等第一次运行完成，这里会自动出现。</p></article>',
    '          </div>',
    '        </section>'
  ].join('\n');

  return renderShell({
    title: '历史日报',
    activeNav: 'daily',
    content,
    currentRun: runtime.currentRun
  });
}

function renderDailyDetail(rootDir, date) {
  const snapshot = findDailySnapshot(rootDir, date);
  const runtime = loadRuntimeState(rootDir);
  if (!snapshot) {
    return null;
  }

  const dailyCuration = readJson(snapshot.dailyCurationPath, {});
  const delivery = summarizeSnapshotDelivery(snapshot);
  const papersHtml = (snapshot.selectedPapers || []).map((paper, index) => renderPaperInsightCard(rootDir, paper, index)).join('');
  const watchlistHtml = (snapshot.watchlistPapers || []).map((paper, index) => renderPaperInsightCard(rootDir, paper, index)).join('');
  const watchlistCount = snapshot.manifest?.watchlistCount || snapshot.watchlistPapers.length;

  const content = [
    '        <section class="hero">',
    '          <div class="hero-eyebrow">Daily Snapshot</div>',
    `          <h1 class="hero-title">${escapeHtml(date)}</h1>`,
    `          <p class="hero-copy">这一天一共主推 ${escapeHtml(String(snapshot.manifest?.selectedCount || snapshot.selectedPapers.length))} 篇论文，另有 ${escapeHtml(String(watchlistCount))} 篇观察池论文。这里先看主线和必读项，再决定是否回补观察池。</p>`,
    '        </section>',
    '        <section class="panel">',
    '          <div class="section-heading"><h2>总编路线</h2><span class="small muted">来自 daily_curation.json</span></div>',
    `          <p><strong>今日主线：</strong>${escapeHtml(dailyCuration.overview || '暂无总编概览。')}</p>`,
    `          <p class="muted"><strong>排序逻辑：</strong>${escapeHtml(dailyCuration.route_logic || '暂无排序逻辑说明。')}</p>`,
    '        </section>',
    '        <section class="panel">',
    '          <div class="section-heading"><h2>投递状态</h2><span class="small muted">来自 delivery_status.json</span></div>',
    `          <p><strong>完成度：</strong>${escapeHtml(String(delivery.completedCount))} / ${escapeHtml(String(delivery.expectedCount))}</p>`,
    `          <p class="muted"><strong>失败：</strong>${escapeHtml(String(delivery.failedCount))}，<strong>待补：</strong>${escapeHtml(String(delivery.pendingCount))}</p>`,
    '        </section>',
    '        <section class="panel">',
    '          <div class="toolbar"><h2>今日论文</h2><a class="button ghost" href="/research-intel/daily">返回历史列表</a></div>',
    `          <div class="paper-list">${papersHtml || '<article class="paper-card"><h3>暂无论文</h3></article>'}</div>`,
    '        </section>',
    (snapshot.watchlistPapers || []).length > 0 ? [
      '        <section class="panel">',
      '          <div class="toolbar"><h2>观察池</h2><span class="small muted">这些论文先保留在当天情报流中，供你决定是否回补精读。</span></div>',
      `          <div class="paper-list">${watchlistHtml}</div>`,
      '        </section>'
    ].join('\n') : '',
    '        <section class="split">',
    `          <div class="panel"><div class="section-heading"><h2>Raw Brief</h2><a class="button ghost" href="${buildFileUrl(rootDir, snapshot.briefPath)}" target="_blank" rel="noreferrer">原文件</a></div><div class="content-prose">${markdownToHtml(readText(snapshot.briefPath, '暂无简报。'), rootDir)}</div></div>`,
    `          <div class="panel"><div class="section-heading"><h2>Raw Reading Order</h2><a class="button ghost" href="${buildFileUrl(rootDir, snapshot.readingOrderPath)}" target="_blank" rel="noreferrer">原文件</a></div><div class="content-prose">${markdownToHtml(readText(snapshot.readingOrderPath, '暂无阅读顺序。'), rootDir)}</div></div>`,
    '        </section>'
  ].join('\n');

  return renderShell({
    title: `${date} 日报`,
    activeNav: 'daily',
    content,
    currentRun: runtime.currentRun
  });
}

function renderKnowledgePage(rootDir) {
  const runtime = loadRuntimeState(rootDir);
  const settings = loadSettingsState(rootDir);
  const methodTreePath = path.join(rootDir, 'research-intel-records', 'knowledge', 'method_tree.md');
  const methodTreeJsonPath = path.join(rootDir, 'research-intel-records', 'knowledge', 'method_tree.json');
  const methodTreeMarkdown = readText(methodTreePath, '# Method Tree\n\n暂无方法树。');
  const methodTree = readJson(methodTreeJsonPath, {});

  const content = [
    '        <section class="hero">',
    '          <div class="hero-eyebrow">Knowledge Ledger</div>',
    '          <h1 class="hero-title">长期研究主线</h1>',
    '          <p class="hero-copy">这里不再把账本当成 raw markdown dump。主视图优先按“研究动机”展开，再往下挂具体论文、方法切口和入口文件。</p>',
    '        </section>',
    `        <section class="stack">${renderMethodTreeFromJson(rootDir, methodTree)}</section>`,
    '        <section class="split">',
    `          <div class="panel"><div class="section-heading"><h2>Raw method_tree.md</h2><a class="button ghost" href="${buildFileUrl(rootDir, methodTreePath)}" target="_blank" rel="noreferrer">原文件</a></div><div class="content-prose">${markdownToHtml(methodTreeMarkdown, rootDir)}</div></div>`,
    '          <div class="panel">',
    '            <div class="section-heading"><h2>账本策略备注</h2><span class="small muted">写回 profile/method_tree_notes.md</span></div>',
    `            <form method="post" action="${APP_BASE_PATH}/settings/method-tree-notes">`,
    `              <label>你希望账本如何长期组织<textarea name="content">${escapeHtml(settings.methodTreeNotes)}</textarea></label>`,
    '              <div class="form-actions"><button class="button" type="submit">保存人工备注</button></div>',
    '            </form>',
    '          </div>',
    '        </section>'
  ].join('\n');

  return renderShell({
    title: '长期账本',
    activeNav: 'knowledge',
    content,
    currentRun: runtime.currentRun
  });
}

function renderRecordCards(records, formAction, deleteAction, emptyCopy) {
  if (!records.length) {
    return `<article class="paper-card"><p class="muted">${escapeHtml(emptyCopy)}</p></article>`;
  }

  return records.map(record => [
    '<article class="paper-card">',
    `<form class="stack" method="post" action="${formAction}">`,
    `<input type="hidden" name="originalTitle" value="${escapeAttr(record.title || '')}">`,
    '<div class="form-grid">',
    `<label>标题<input type="text" name="title" value="${escapeAttr(record.title || '')}" required></label>`,
    `<label>状态<select name="status"><option value="read" ${record.status === 'read' ? 'selected' : ''}>read</option><option value="skimmed" ${record.status === 'skimmed' ? 'selected' : ''}>skimmed</option><option value="queued" ${record.status === 'queued' ? 'selected' : ''}>queued</option><option value="archived" ${record.status === 'archived' ? 'selected' : ''}>archived</option></select></label>`,
    '</div>',
    '<div class="form-grid">',
    `<label>Anchor <input type="checkbox" name="anchor" ${record.anchor ? 'checked' : ''}></label>`,
    `<label>Liked <input type="checkbox" name="liked" ${record.liked ? 'checked' : ''}></label>`,
    '</div>',
    `<label>备注<textarea name="notes">${escapeHtml(record.notes || '')}</textarea></label>`,
    '<div class="form-actions">',
    '<button class="button" type="submit">保存</button>',
    '</div>',
    '</form>',
    `<form method="post" action="${deleteAction}" class="form-actions" style="margin-top:10px;"><input type="hidden" name="title" value="${escapeAttr(record.title || '')}"><button class="button ghost" type="submit">删除</button></form>`,
    '</article>'
  ].join('')).join('');
}

function renderSettingsPage(rootDir, flashMessage = '') {
  const runtime = loadRuntimeState(rootDir);
  const settings = loadSettingsState(rootDir);
  const parsedTaxonomy = (() => {
    try {
      const parsed = JSON.parse(settings.methodTaxonomyText || '{}');
      return Array.isArray(parsed.branches) ? parsed.branches : [];
    } catch {
      return [];
    }
  })();

  const currentGoal = (settings.parsedBrief.currentGoal || []).map(item => `<span class="tag">${escapeHtml(item)}</span>`).join('');

  const content = [
    '        <section class="hero">',
    '          <div class="hero-eyebrow">Editable Research Controls</div>',
    '          <h1 class="hero-title">研究控制面板</h1>',
    '          <p class="hero-copy">这里改的不是展示文案，而是明天推荐链路真正会读取的控制面。主标题按研究对象组织，raw 文件名只退到次级说明。</p>',
    '        </section>',
    '        <section class="panel">',
    '          <div class="toolbar"><h2>当前研究主线</h2><span class="small muted">解析自 research_brief.md</span></div>',
    `          <div class="meta-row">${currentGoal || '<span class="tag">暂无 Current Goal</span>'}</div>`,
    `          <p class="muted">每日范围：${escapeHtml(String(settings.parsedBrief.minPapers))} - ${escapeHtml(String(settings.parsedBrief.maxPapers))}，目标 ${escapeHtml(String(settings.parsedBrief.targetPapers))}，发送时间 ${escapeHtml(settings.parsedBrief.sendTime)}</p>`,
    '        </section>',
    '        <section class="panel">',
    '          <div class="section-heading"><h2>研究主线说明</h2><span class="small muted">raw source: research_brief.md</span></div>',
    `          <form method="post" action="${APP_BASE_PATH}/settings/brief">`,
    `            <label>你当前的研究目标、正向信号、负向信号<textarea name="content">${escapeHtml(settings.researchBrief)}</textarea></label>`,
    '            <div class="form-actions"><button class="button" type="submit">保存 brief</button></div>',
    '          </form>',
    '        </section>',
    '        <section class="split">',
    '          <div class="panel">',
    '            <div class="section-heading"><h2>长期主线分支模板</h2><span class="small muted">raw source: method_taxonomy.json</span></div>',
    parsedTaxonomy.length > 0 ? `<div class="paper-list">${parsedTaxonomy.map(branch => `<article class="paper-card"><h3>${escapeHtml(branch.title || branch.id)}</h3><p class="muted">${escapeHtml(branch.question || '未填写分支问题。')}</p><p class="muted">${escapeHtml((branch.keywords || []).join('、') || '暂无关键词')}</p></article>`).join('')}</div>` : '<p class="muted">当前 taxonomy 还不能被解析成结构化分支。</p>',
    `            <form method="post" action="${APP_BASE_PATH}/settings/method-taxonomy">`,
    `              <label>分支 JSON<textarea name="content">${escapeHtml(settings.methodTaxonomyText)}</textarea></label>`,
    '              <div class="form-actions"><button class="button" type="submit">保存 taxonomy</button></div>',
    '            </form>',
    '          </div>',
    '          <div class="panel">',
    '            <div class="section-heading"><h2>长期账本策略备注</h2><span class="small muted">raw source: method_tree_notes.md</span></div>',
    `            <form method="post" action="${APP_BASE_PATH}/settings/method-tree-notes">`,
    `              <label>告诉后续 worker 这张长期主线图应该怎么维护<textarea name="content">${escapeHtml(settings.methodTreeNotes)}</textarea></label>`,
    '              <div class="form-actions"><button class="button" type="submit">保存 notes</button></div>',
    '            </form>',
    '          </div>',
    '        </section>',
    '        <section class="panel">',
    '          <div class="section-heading"><h2>Seed Papers</h2><span class="small muted">锚点论文与偏好</span></div>',
    '          <div class="stack">',
    '            <form method="post" action="/research-intel/settings/seeds/save" class="panel" style="padding:18px;">',
    '              <input type="hidden" name="originalTitle" value="">',
    '              <div class="form-grid">',
    '                <label>标题<input type="text" name="title" required></label>',
    '                <label>状态<select name="status"><option value="read">read</option><option value="skimmed">skimmed</option><option value="queued">queued</option><option value="archived">archived</option></select></label>',
    '              </div>',
    '              <div class="form-grid">',
    '                <label>Anchor <input type="checkbox" name="anchor"></label>',
    '                <label>Liked <input type="checkbox" name="liked"></label>',
    '              </div>',
    '              <label>备注<textarea name="notes"></textarea></label>',
    '              <div class="form-actions"><button class="button" type="submit">新增 Seed</button></div>',
    '            </form>',
    '            <div class="paper-list">',
    renderRecordCards(settings.seeds, `${APP_BASE_PATH}/settings/seeds/save`, `${APP_BASE_PATH}/settings/seeds/delete`, '暂无种子论文。'),
    '            </div>',
    '          </div>',
    '        </section>',
    '        <section class="panel">',
    '          <div class="section-heading"><h2>Feedback / 阅读状态</h2><span class="small muted">对已看论文的持续判断</span></div>',
    '          <div class="stack">',
    '            <form method="post" action="/research-intel/settings/feedback/save" class="panel" style="padding:18px;">',
    '              <input type="hidden" name="originalTitle" value="">',
    '              <div class="form-grid">',
    '                <label>标题<input type="text" name="title" required></label>',
    '                <label>状态<select name="status"><option value="read">read</option><option value="skimmed">skimmed</option><option value="queued">queued</option><option value="archived">archived</option></select></label>',
    '              </div>',
    '              <div class="form-grid">',
    '                <label>Anchor <input type="checkbox" name="anchor"></label>',
    '                <label>Liked <input type="checkbox" name="liked"></label>',
    '              </div>',
    '              <label>备注<textarea name="notes"></textarea></label>',
    '              <div class="form-actions"><button class="button" type="submit">新增 Feedback</button></div>',
    '            </form>',
    '            <div class="paper-list">',
    renderRecordCards(settings.feedback, `${APP_BASE_PATH}/settings/feedback/save`, `${APP_BASE_PATH}/settings/feedback/delete`, '暂无反馈记录。'),
    '            </div>',
    '          </div>',
    '        </section>'
  ].join('\n');

  return renderShell({
    title: '编辑区',
    activeNav: 'settings',
    content,
    currentRun: runtime.currentRun,
    flashMessage
  });
}

function parseFlashMessage(query) {
  const saved = String(query.saved || '').trim();
  if (String(query.triggered || '') === '1') {
    return '已触发一次手动运行，worker 会在后台继续执行。';
  }
  if (String(query.busy || '') === '1') {
    return '当前已经有运行中的 worker，控制台没有再次触发。';
  }
  if (!saved) {
    return '';
  }

  const mapping = {
    brief: 'research_brief.md 已保存。',
    taxonomy: 'method_taxonomy.json 已保存。',
    notes: 'method_tree_notes.md 已保存。',
    seeds: 'seed_papers.jsonl 已更新。',
    feedback: 'feedback.jsonl 已更新。'
  };
  return escapeHtml(mapping[saved] || '已保存。');
}

function createResearchIntelWebApp({
  rootDir,
  sitePassword,
  sessionSecret = '',
  runDaily = null
}) {
  if (!rootDir) {
    throw new Error('createResearchIntelWebApp requires rootDir');
  }
  if (!sitePassword) {
    throw new Error('createResearchIntelWebApp requires sitePassword');
  }

  const app = express();
  const sessionToken = createSessionToken(sitePassword, sessionSecret || sitePassword);
  const runDailyHandler = runDaily || (() => defaultRunDaily(rootDir));

  app.use(express.urlencoded({ extended: false, limit: '3mb' }));

  function requireAuth(req, res, next) {
    if (req.path === `${APP_BASE_PATH}/login` || req.path === `${APP_BASE_PATH}/health`) {
      return next();
    }

    const cookies = parseCookies(req.headers.cookie);
    if (cookies[SESSION_COOKIE_NAME] && safeCompare(cookies[SESSION_COOKIE_NAME], sessionToken)) {
      return next();
    }

    return res.redirect(302, `${APP_BASE_PATH}/login`);
  }

  app.use(requireAuth);

  app.get(`${APP_BASE_PATH}/health`, (req, res) => {
    res.json({ ok: true, service: 'research-intel-web' });
  });

  app.get(`${APP_BASE_PATH}/login`, (req, res) => {
    res.type('html').send(renderLoginPage(String(req.query.error || '') === '1'));
  });

  app.post(`${APP_BASE_PATH}/login`, (req, res) => {
    const password = String(req.body.password || '');
    if (!safeCompare(password, sitePassword)) {
      return res.redirect(303, `${APP_BASE_PATH}/login?error=1`);
    }

    res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}; Path=${APP_BASE_PATH}; HttpOnly; SameSite=Strict; Max-Age=604800`);
    return res.redirect(303, `${APP_BASE_PATH}/`);
  });

  app.post(`${APP_BASE_PATH}/logout`, (req, res) => {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; Path=${APP_BASE_PATH}; HttpOnly; SameSite=Strict; Max-Age=0`);
    res.redirect(303, `${APP_BASE_PATH}/login`);
  });

  app.get(`${APP_BASE_PATH}/`, (req, res) => {
    res.type('html').send(renderDashboard(rootDir, parseFlashMessage(req.query)));
  });

  app.get(`${APP_BASE_PATH}/daily`, (req, res) => {
    res.type('html').send(renderDailyIndex(rootDir));
  });

  app.get(`${APP_BASE_PATH}/daily/:date`, (req, res) => {
    const page = renderDailyDetail(rootDir, req.params.date);
    if (!page) {
      return res.status(404).type('html').send(renderShell({
        title: '未找到日报',
        activeNav: 'daily',
        content: '<section class="panel"><h2>未找到这一天的日报</h2></section>',
        currentRun: loadRuntimeState(rootDir).currentRun
      }));
    }
    return res.type('html').send(page);
  });

  app.get(`${APP_BASE_PATH}/knowledge`, (req, res) => {
    res.type('html').send(renderKnowledgePage(rootDir));
  });

  app.get(`${APP_BASE_PATH}/settings`, (req, res) => {
    res.type('html').send(renderSettingsPage(rootDir, parseFlashMessage(req.query)));
  });

  app.get(`${APP_BASE_PATH}/files/*`, (req, res) => {
    try {
      const filePath = ensureAllowedFile(rootDir, req.params[0]);
      return res.sendFile(filePath);
    } catch (error) {
      return res.status(404).type('html').send(renderShell({
        title: '文件不可用',
        activeNav: 'daily',
        content: `<section class="panel"><h2>文件不可用</h2><p class="muted">${escapeHtml(error.message)}</p></section>`,
        currentRun: loadRuntimeState(rootDir).currentRun
      }));
    }
  });

  app.post(`${APP_BASE_PATH}/settings/brief`, (req, res) => {
    const { researchBriefPath } = getProfilePaths(rootDir);
    fs.writeFileSync(researchBriefPath, String(req.body.content || ''), 'utf8');
    res.redirect(303, `${APP_BASE_PATH}/settings?saved=brief`);
  });

  app.post(`${APP_BASE_PATH}/settings/method-taxonomy`, (req, res) => {
    const { methodTaxonomyPath } = getProfilePaths(rootDir);
    const content = String(req.body.content || '').trim();
    JSON.parse(content || '{}');
    fs.writeFileSync(methodTaxonomyPath, `${content}\n`, 'utf8');
    res.redirect(303, `${APP_BASE_PATH}/settings?saved=taxonomy`);
  });

  app.post(`${APP_BASE_PATH}/settings/method-tree-notes`, (req, res) => {
    const { methodTreeNotesPath } = getProfilePaths(rootDir);
    fs.writeFileSync(methodTreeNotesPath, String(req.body.content || ''), 'utf8');
    res.redirect(303, `${APP_BASE_PATH}/settings?saved=notes`);
  });

  app.post(`${APP_BASE_PATH}/settings/seeds/save`, (req, res) => {
    const { seedPapersPath } = getProfilePaths(rootDir);
    const records = readJsonl(seedPapersPath);
    const nextRecord = {
      title: String(req.body.title || '').trim(),
      status: String(req.body.status || 'queued').trim() || 'queued',
      anchor: boolFromForm(req.body.anchor),
      liked: boolFromForm(req.body.liked),
      notes: String(req.body.notes || '').trim()
    };
    if (!nextRecord.title) {
      throw new Error('Seed title is required.');
    }
    const nextRecords = upsertJsonlRecord(records, req.body.originalTitle, nextRecord);
    fs.writeFileSync(seedPapersPath, serializeJsonl(nextRecords), 'utf8');
    res.redirect(303, `${APP_BASE_PATH}/settings?saved=seeds`);
  });

  app.post(`${APP_BASE_PATH}/settings/seeds/delete`, (req, res) => {
    const { seedPapersPath } = getProfilePaths(rootDir);
    const records = readJsonl(seedPapersPath);
    const nextRecords = deleteJsonlRecord(records, req.body.title);
    fs.writeFileSync(seedPapersPath, serializeJsonl(nextRecords), 'utf8');
    res.redirect(303, `${APP_BASE_PATH}/settings?saved=seeds`);
  });

  app.post(`${APP_BASE_PATH}/settings/feedback/save`, (req, res) => {
    const { feedbackPath } = getProfilePaths(rootDir);
    const records = readJsonl(feedbackPath);
    const nextRecord = {
      title: String(req.body.title || '').trim(),
      status: String(req.body.status || 'queued').trim() || 'queued',
      anchor: boolFromForm(req.body.anchor),
      liked: boolFromForm(req.body.liked),
      notes: String(req.body.notes || '').trim()
    };
    if (!nextRecord.title) {
      throw new Error('Feedback title is required.');
    }
    const nextRecords = upsertJsonlRecord(records, req.body.originalTitle, nextRecord);
    fs.writeFileSync(feedbackPath, serializeJsonl(nextRecords), 'utf8');
    res.redirect(303, `${APP_BASE_PATH}/settings?saved=feedback`);
  });

  app.post(`${APP_BASE_PATH}/settings/feedback/delete`, (req, res) => {
    const { feedbackPath } = getProfilePaths(rootDir);
    const records = readJsonl(feedbackPath);
    const nextRecords = deleteJsonlRecord(records, req.body.title);
    fs.writeFileSync(feedbackPath, serializeJsonl(nextRecords), 'utf8');
    res.redirect(303, `${APP_BASE_PATH}/settings?saved=feedback`);
  });

  app.post(`${APP_BASE_PATH}/actions/run`, async (req, res, next) => {
    try {
      const runtime = loadRuntimeState(rootDir);
      if (isRuntimeBusy(runtime)) {
        return res.redirect(303, `${APP_BASE_PATH}/?busy=1`);
      }
      await runDailyHandler();
      return res.redirect(303, `${APP_BASE_PATH}/?triggered=1`);
    } catch (error) {
      return next(error);
    }
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      return next(error);
    }

    return res.status(500).type('html').send(renderShell({
      title: '控制台错误',
      activeNav: 'dashboard',
      content: `<section class="panel"><h2>控制台错误</h2><p class="muted">${escapeHtml(error.message || 'unknown error')}</p></section>`,
      currentRun: loadRuntimeState(rootDir).currentRun
    }));
  });

  return app;
}

module.exports = {
  APP_BASE_PATH,
  collectDailySnapshots,
  createResearchIntelWebApp,
  getProfilePaths,
  getRuntimePaths,
  loadSettingsState,
  loadRuntimeState,
  serializeJsonl,
  upsertJsonlRecord,
  deleteJsonlRecord
};
