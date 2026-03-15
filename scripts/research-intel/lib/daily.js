#!/usr/bin/env node

const path = require('path');

const { findRelatedSeeds } = require('./render');

function stripDiacritics(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

function buildPaperSlug(title) {
  return stripDiacritics(title)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function buildRunPaths(baseDir, dateString) {
  const runDir = path.join(baseDir, 'daily', dateString);
  return {
    runDir,
    papersDir: path.join(runDir, 'papers'),
    packagePath: path.join(runDir, `research-intelligence-${dateString}.tar.gz`)
  };
}

function buildRecordPaths(recordsDir, dateString) {
  const runDir = path.join(recordsDir, 'daily', dateString);
  const knowledgeDir = path.join(recordsDir, 'knowledge');
  return {
    runDir,
    knowledgeDir,
    methodTreeJsonPath: path.join(knowledgeDir, 'method_tree.json'),
    methodTreeMarkdownPath: path.join(knowledgeDir, 'method_tree.md')
  };
}

function daysSince(published, now = new Date()) {
  const publishedDate = new Date(published);
  if (Number.isNaN(publishedDate.getTime())) {
    return null;
  }

  const diffMs = now.getTime() - publishedDate.getTime();
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

function formatList(items) {
  const filtered = (items || []).filter(Boolean);
  return filtered.join('、');
}

function buildReasonWhyToday(paper, relatedSeeds, now) {
  const parts = [];
  const ageDays = daysSince(paper.published, now);

  if (typeof ageDays === 'number') {
    if (ageDays <= 1) {
      parts.push('这是最近 1 天内的新论文');
    } else if (ageDays <= 7) {
      parts.push(`这是最近 ${ageDays} 天内的新论文`);
    }
  }

  if ((paper.matchedKeywords || []).length > 0) {
    parts.push(`命中关键词：${formatList(paper.matchedKeywords.slice(0, 3))}`);
  }

  if ((paper.matchedSignals || []).length > 0) {
    parts.push(`命中正向信号：${formatList(paper.matchedSignals.slice(0, 2))}`);
  }

  if (relatedSeeds.length > 0) {
    parts.push(`与锚点论文 ${formatList(relatedSeeds.map(seed => seed.title).slice(0, 2))} 直接相关`);
  }

  if (parts.length === 0) {
    parts.push('与当前研究主线相关，适合作为今天的方法情报输入');
  }

  return parts.join('；');
}

function buildReadingReason(paper, relatedSeeds, index, now) {
  const ageDays = daysSince(paper.published, now);
  const freshnessText = typeof ageDays === 'number' && ageDays <= 7
    ? `它足够新，处在最近 ${Math.max(ageDays, 1)} 天的更新窗口里`
    : '它能补足当前主线里的方法视角';
  const keywordText = (paper.matchedKeywords || []).length > 0
    ? `而且直接命中 ${formatList(paper.matchedKeywords.slice(0, 2))}`
    : '并且和当前兴趣方向相邻';
  const anchorText = relatedSeeds.length > 0
    ? `还能和 ${formatList(relatedSeeds.map(seed => seed.title).slice(0, 1))} 串起来读`
    : '适合作为独立情报样本先过一遍';

  const lead = index === 0 ? '先看这篇' : '再看这篇';
  return `${lead}，因为${freshnessText}，${keywordText}，${anchorText}。`;
}

function decorateSelectedPapers(papers, profile, now = new Date()) {
  return papers.map((paper, index) => {
    const relatedSeeds = findRelatedSeeds(paper, profile.seeds || []);
    return {
      ...paper,
      slug: paper.slug || buildPaperSlug(paper.title),
      relatedSeeds,
      reasonWhyToday: buildReasonWhyToday(paper, relatedSeeds, now),
      readingReason: buildReadingReason(paper, relatedSeeds, index, now)
    };
  });
}

module.exports = {
  buildPaperSlug,
  buildRecordPaths,
  buildRunPaths,
  decorateSelectedPapers
};
