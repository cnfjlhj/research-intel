#!/usr/bin/env node

const { normalizeTitle } = require('./core');

const BLOCKED_COVERAGE_DOMAINS = new Set([
  'arxiv.org',
  'openreview.net',
  'github.com',
  'huggingface.co',
  'paperswithcode.com',
  'zhidao.baidu.com',
  'baike.baidu.com',
  'wenku.baidu.com',
  'dict.youdao.com',
  'www.iciba.com',
  'dict.cn',
  'ejje.weblio.jp',
  'eow.alc.co.jp'
]);

const PREFERRED_CHINESE_BLOG_DOMAINS = [
  'mp.weixin.qq.com',
  'zhuanlan.zhihu.com',
  'www.zhihu.com',
  'www.jiqizhixin.com',
  'jiqizhixin.com',
  'www.qbitai.com',
  'qbitai.com',
  'paperweekly.site',
  'www.infoq.cn',
  'infoq.cn',
  'www.36kr.com',
  '36kr.com',
  'blog.csdn.net',
  'www.cnblogs.com'
];

const OVERLAP_STOP_TOKENS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'into',
  'of',
  'on',
  'or',
  'the',
  'to',
  'via',
  'with',
  'multi',
  'paper',
  'papers',
  'scientific',
  'discovery',
  'research'
]);

const LOW_QUALITY_TITLE_PATTERNS = [
  /是什么意思/,
  /what does .* mean/i,
  /definition/i,
  /英和辞書/,
  /読み方/,
  /使い方/,
  /例文/,
  /ネイティブに聞いた/,
  /on the web/i
];

const WEAK_PAPER_TITLE_TOKENS = new Set([
  ...OVERLAP_STOP_TOKENS,
  'agent',
  'agents',
  'alignment',
  'ended',
  'evolution',
  'evolve',
  'evolved',
  'evolving',
  'framework',
  'improvement',
  'improving',
  'open',
  'paper',
  'partly',
  'passes',
  'results',
  'self',
  'simulation',
  'study',
  'test',
  'tests',
  'towards',
  'using',
  'when',
  'wins'
]);

const CHINESE_BLOG_SIGNAL_PATTERNS = [
  /论文/,
  /解读/,
  /精读/,
  /速读/,
  /综述/,
  /复现/,
  /方法/,
  /实验/,
  /模型/,
  /研究/
];

const TARGETED_CHINESE_SITE_HINTS = [
  'zhuanlan.zhihu.com',
  'mp.weixin.qq.com',
  'www.jiqizhixin.com'
];

function htmlDecode(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/');
}

function stripTags(text) {
  return htmlDecode(String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function unwrapDuckDuckGoUrl(rawUrl) {
  if (!rawUrl) {
    return '';
  }

  const normalized = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
  try {
    const url = new URL(normalized, 'https://duckduckgo.com');
    const uddg = url.searchParams.get('uddg');
    if (uddg) {
      return decodeURIComponent(uddg);
    }
    return url.toString();
  } catch {
    return normalized;
  }
}

function safeDomain(rawUrl) {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return '';
  }
}

function canonicalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    if (url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function dedupeSearchResults(results) {
  const seen = new Set();
  const deduped = [];

  for (const result of results) {
    const key = canonicalizeUrl(result.url);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(result);
  }

  return deduped;
}

function parseDuckDuckGoHtml(html) {
  const source = String(html || '');
  const anchors = [...source.matchAll(/class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];

  const parsed = anchors.map(match => {
    const start = match.index || 0;
    const block = source.slice(start, start + 1800);
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
    const url = unwrapDuckDuckGoUrl(match[1]);
    return {
      title: stripTags(match[2]),
      url,
      domain: safeDomain(url),
      snippet: stripTags(snippetMatch ? snippetMatch[1] : '')
    };
  }).filter(result => result.title && result.url);

  return dedupeSearchResults(parsed);
}

function parseBingRss(xml) {
  const items = [...String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/gi)];
  return dedupeSearchResults(items.map(match => {
    const block = match[1];
    const title = stripTags((block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
    const url = htmlDecode((block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '').trim();
    const snippet = stripTags((block.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '');
    return {
      title,
      url,
      domain: safeDomain(url),
      snippet
    };
  }).filter(item => item.title && item.url));
}

function isChineseText(text) {
  return /[\u4e00-\u9fff]/.test(String(text || ''));
}

function preferredChineseDomainRank(domain) {
  const index = PREFERRED_CHINESE_BLOG_DOMAINS.indexOf(domain);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function isBlockedCoverageResult(result) {
  return BLOCKED_COVERAGE_DOMAINS.has(result.domain)
    || /\.pdf($|\?)/i.test(result.url)
    || LOW_QUALITY_TITLE_PATTERNS.some(pattern => pattern.test(result.title || ''));
}

function selectChineseBlogResults(results, maxResults = 3, paperTitle = '') {
  return dedupeSearchResults(results)
    .filter(result => !isBlockedCoverageResult(result))
    .filter(result => isRelevantCoverageResult(result, paperTitle))
    .filter(result => hasChineseBlogSignals(result))
    .sort((left, right) => {
      const leftRank = preferredChineseDomainRank(left.domain);
      const rightRank = preferredChineseDomainRank(right.domain);
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return (right.snippet.length + right.title.length) - (left.snippet.length + left.title.length);
    })
    .slice(0, maxResults);
}

function selectCoverageResults(results, maxResults = 4, paperTitle = '') {
  return dedupeSearchResults(results)
    .filter(result => !isBlockedCoverageResult(result))
    .filter(result => isRelevantCoverageResult(result, paperTitle))
    .slice(0, maxResults);
}

function tokenize(text) {
  return normalizeTitle(text)
    .split(' ')
    .filter(Boolean)
    .filter(token => !OVERLAP_STOP_TOKENS.has(token));
}

function rawTokens(text) {
  return normalizeTitle(text)
    .split(' ')
    .filter(Boolean);
}

function overlapScore(leftText, rightText) {
  const leftTokens = new Set(tokenize(leftText));
  const rightTokens = new Set(tokenize(rightText));
  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function salientPaperTokens(paperTitle) {
  return [...new Set(
    rawTokens(paperTitle)
      .filter(token => !WEAK_PAPER_TITLE_TOKENS.has(token))
      .filter(token => token.length >= 3)
  )];
}

function exactPaperPhraseMatches(haystack, paperTitle) {
  const normalizedTitle = normalizeTitle(paperTitle);
  if (!normalizedTitle) {
    return false;
  }

  if (haystack.includes(normalizedTitle)) {
    return true;
  }

  const titlePrefix = normalizeTitle(String(paperTitle || '').split(':')[0]);
  return Boolean(titlePrefix && titlePrefix !== normalizedTitle && titlePrefix.split(' ').length >= 2 && haystack.includes(titlePrefix));
}

function paperRelevanceScore(result, paperTitle) {
  if (!paperTitle) {
    return 1;
  }

  const haystack = normalizeTitle(`${result.title} ${result.snippet}`);
  if (!haystack) {
    return 0;
  }

  if (exactPaperPhraseMatches(haystack, paperTitle)) {
    return 10;
  }

  const resultTokens = new Set(rawTokens(`${result.title} ${result.snippet}`));
  const salientOverlap = salientPaperTokens(paperTitle).filter(token => resultTokens.has(token)).length;
  if (salientOverlap > 0) {
    return 5 + salientOverlap;
  }

  let overlap = 0;
  for (const token of tokenize(paperTitle)) {
    if (resultTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap >= 2 ? overlap : 0;
}

function isRelevantCoverageResult(result, paperTitle) {
  return paperRelevanceScore(result, paperTitle) > 0;
}

function hasChineseBlogSignals(result) {
  const blob = `${result.title} ${result.snippet}`;
  return preferredChineseDomainRank(result.domain) !== Number.MAX_SAFE_INTEGER
    || (isChineseText(blob) && CHINESE_BLOG_SIGNAL_PATTERNS.some(pattern => pattern.test(blob)));
}

function repoMatchScore(repo, paperTitle, arxivId) {
  const haystack = [repo.full_name, repo.description, repo.homepage].filter(Boolean).join(' ');
  let score = overlapScore(haystack, paperTitle);

  const normalizedHaystack = normalizeTitle(haystack);
  const arxivDigits = String(arxivId || '').replace(/v\d+$/i, '');
  if (arxivDigits && normalizedHaystack.includes(arxivDigits.replace(/\./g, ' '))) {
    score += 0.6;
  }

  const titlePrefix = tokenize(paperTitle).slice(0, 2).join(' ');
  if (titlePrefix && normalizedHaystack.includes(titlePrefix)) {
    score += 0.25;
  }

  return score;
}

function selectRelevantGitHubRepos({ repos, paperTitle, arxivId, maxResults = 3 }) {
  return (repos || [])
    .map(repo => ({
      ...repo,
      _matchScore: repoMatchScore(repo, paperTitle, arxivId)
    }))
    .filter(repo => repo._matchScore >= 0.35)
    .sort((left, right) => right._matchScore - left._matchScore || (right.stargazers_count || 0) - (left.stargazers_count || 0))
    .slice(0, maxResults)
    .map(repo => ({
      full_name: repo.full_name,
      html_url: repo.html_url,
      description: repo.description || '',
      stargazers_count: repo.stargazers_count || 0
    }));
}

async function searchDuckDuckGo(query, maxResults = 8) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; research-intel-bot/0.1)'
    }
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo search failed (${response.status}) for query: ${query}`);
  }

  return parseDuckDuckGoHtml(await response.text()).slice(0, maxResults);
}

async function searchBingRss(query, maxResults = 8) {
  const url = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0'
    }
  });

  if (!response.ok) {
    throw new Error(`Bing RSS search failed (${response.status}) for query: ${query}`);
  }

  return parseBingRss(await response.text()).slice(0, maxResults);
}

async function searchGitHubRepositories({ paperTitle, arxivId, maxResults = 5 }) {
  const titlePrefix = paperTitle.split(':')[0].trim();
  const condensedQuery = tokenize(paperTitle)
    .filter(token => token.length > 3)
    .slice(0, 6)
    .join(' ');
  const queries = [
    condensedQuery,
    titlePrefix,
    paperTitle,
    arxivId ? arxivId.replace(/v\d+$/i, '') : ''
  ].filter(Boolean);

  const collected = [];
  for (const query of queries) {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${maxResults}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'research-intel-bot/0.1',
        Accept: 'application/vnd.github+json'
      }
    });

    if (!response.ok) {
      continue;
    }

    const payload = await response.json();
    for (const item of payload.items || []) {
      collected.push(item);
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const repo of collected) {
    if (!repo.full_name || seen.has(repo.full_name)) {
      continue;
    }
    seen.add(repo.full_name);
    deduped.push(repo);
  }

  return selectRelevantGitHubRepos({
    repos: deduped,
    paperTitle,
    arxivId,
    maxResults
  });
}

function buildEnrichmentQueries({ paperTitle, arxivId }) {
  const quotedTitle = `"${paperTitle}"`;
  const titlePrefix = paperTitle.split(':')[0].trim();
  const arxivStem = String(arxivId || '').replace(/v\d+$/i, '');
  const generalQueries = [
    `${quotedTitle} arxiv`,
    quotedTitle,
    titlePrefix ? `"${titlePrefix}" paper` : '',
    titlePrefix ? `${titlePrefix} arxiv` : '',
    arxivStem ? `${arxivStem}` : ''
  ].filter(Boolean);
  const zhQueries = [
    `${quotedTitle} 中文 论文 解读`,
    `${quotedTitle} 中文 博客`,
    `${quotedTitle} 论文速读`,
    titlePrefix ? `"${titlePrefix}" 中文 解读` : '',
    titlePrefix ? `${titlePrefix} 论文 解读` : '',
    arxivStem ? `${arxivStem} 中文` : '',
    arxivStem ? `${arxivStem} 论文 解读` : '',
    ...TARGETED_CHINESE_SITE_HINTS.map(domain => {
      if (arxivStem) {
        return `site:${domain} ${arxivStem}`;
      }
      if (titlePrefix) {
        return `site:${domain} ${titlePrefix} 论文`;
      }
      return '';
    })
  ].filter(Boolean);

  return {
    generalQueries: [...new Set(generalQueries)],
    zhQueries: [...new Set(zhQueries)]
  };
}

async function discoverPaperEnrichment({ paperTitle, arxivId }) {
  const { generalQueries, zhQueries } = buildEnrichmentQueries({ paperTitle, arxivId });

  const [bingGeneralResults, bingZhResults, ddgGeneralResults, ddgZhResults, codeRepos] = await Promise.all([
    Promise.all(generalQueries.map(query => searchBingRss(query, 8).catch(() => []))),
    Promise.all(zhQueries.map(query => searchBingRss(query, 8).catch(() => []))),
    Promise.all(generalQueries.map(query => searchDuckDuckGo(query, 8).catch(() => []))),
    Promise.all(zhQueries.map(query => searchDuckDuckGo(query, 8).catch(() => []))),
    searchGitHubRepositories({ paperTitle, arxivId, maxResults: 3 }).catch(() => [])
  ]);

  const scoredCoverage = dedupeSearchResults([
    ...bingGeneralResults.flat().filter(item => item.url),
    ...bingZhResults.flat().filter(item => item.url),
    ...ddgGeneralResults.flat().filter(item => item.url),
    ...ddgZhResults.flat().filter(item => item.url)
  ]).map(item => ({
    ...item,
    _score: overlapScore(`${item.title} ${item.snippet}`, paperTitle)
  })).filter(item => item._score >= 0.15);

  return {
    queriedAt: new Date().toISOString(),
    coverage: selectCoverageResults(scoredCoverage, 4, paperTitle),
    chineseBlogs: selectChineseBlogResults(scoredCoverage, 3, paperTitle),
    codeRepos
  };
}

module.exports = {
  buildEnrichmentQueries,
  dedupeSearchResults,
  discoverPaperEnrichment,
  parseBingRss,
  parseDuckDuckGoHtml,
  searchBingRss,
  searchDuckDuckGo,
  searchGitHubRepositories,
  selectChineseBlogResults,
  selectCoverageResults,
  selectRelevantGitHubRepos
};
