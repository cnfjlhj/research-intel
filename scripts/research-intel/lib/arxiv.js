#!/usr/bin/env node

const { normalizeArxivId } = require('./core');

const QUERY_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'beyond',
  'broad',
  'by',
  'for',
  'from',
  'guide',
  'guided',
  'in',
  'into',
  'is',
  'loop',
  'loops',
  'of',
  'on',
  'only',
  'or',
  'over',
  'prefer',
  'stories',
  'story',
  'the',
  'to',
  'via',
  'with',
  'without'
]);

const STRATEGIC_QUERY_TOKENS = new Set([
  'agent',
  'agents',
  'archive',
  'curriculum',
  'discovery',
  'evolution',
  'evolving',
  'experience',
  'improvement',
  'improving',
  'memory',
  'meta',
  'program',
  'recursive',
  'retrieval',
  'self',
  'sharing',
  'verifier'
]);

const HIGH_SIGNAL_QUERY_TOKENS = new Set([
  'archive',
  'curriculum',
  'discovery',
  'experience',
  'memory',
  'meta',
  'program',
  'recursive',
  'retrieval',
  'sharing',
  'verifier'
]);

const BROAD_SOLO_QUERY_PHRASES = new Set([
  'automated discovery',
  'autoformalization',
  'evolutionary search',
  'experience sharing',
  'long-term memory',
  'meta-evolution',
  'open-ended evolution',
  'open-ended self-improvement',
  'program evolution',
  'sample efficiency',
  'self-referential agent',
  'scientific discovery'
]);

const GENERIC_AUXILIARY_QUERY_PHRASES = new Set([
  'agent framework',
  'architecture',
  'context',
  'godel',
  'memory',
  'reflection',
  'reward',
  'self-referential',
  'tool use',
  'trajectory'
]);

const PRIORITY_METHOD_QUERY_PHRASES = new Set([
  'archive',
  'code agent',
  'experience sharing',
  'hard scientific tasks',
  'inter-task learning',
  'memory archive',
  'minimal necessary structure',
  'minimal scaffolding',
  'retry policy',
  'search policy',
  'strong code agent baseline',
  'verifier',
  'verifier loop'
]);

const PRIORITY_BROAD_QUERY_PHRASES = new Set([
  'automated discovery',
  'autoformalization',
  'meta-evolution',
  'program evolution'
]);

const DEPRIORITIZED_SIGNAL_QUERY_PHRASES = new Set([
  'open-ended evolution',
  'open-ended self-improvement',
  'recursive agent improvement',
  'sample efficiency',
  'self-referential agent'
]);

function htmlDecode(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? htmlDecode(match[1].replace(/\s+/g, ' ').trim()) : '';
}

function extractAuthors(block) {
  return [...block.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/gi)]
    .map(match => htmlDecode(match[1].replace(/\s+/g, ' ').trim()))
    .filter(Boolean);
}

function extractCategories(block) {
  return [...block.matchAll(/<category[^>]*term="([^"]+)"/gi)]
    .map(match => match[1].trim())
    .filter(Boolean);
}

function extractLinkAttributes(block) {
  return [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map(match => {
    const attributes = {};
    for (const attributeMatch of match[1].matchAll(/([a-zA-Z_:][a-zA-Z0-9_:\-.]*)="([^"]*)"/g)) {
      attributes[attributeMatch[1].toLowerCase()] = htmlDecode(attributeMatch[2]);
    }
    return attributes;
  });
}

function extractPdfUrl(block) {
  for (const attributes of extractLinkAttributes(block)) {
    if (attributes.title === 'pdf' && attributes.href) {
      return attributes.href;
    }
  }
  for (const attributes of extractLinkAttributes(block)) {
    if (attributes.type === 'application/pdf' && attributes.href) {
      return attributes.href;
    }
  }
  return '';
}

function parseArxivFeed(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map(match => {
    const block = match[1];
    const absUrl = extractTag(block, 'id');
    const arxivId = normalizeArxivId(absUrl.split('/abs/')[1] || absUrl.split('/pdf/')[1] || '');
    return {
      arxivId,
      title: extractTag(block, 'title'),
      summary: extractTag(block, 'summary'),
      published: extractTag(block, 'published'),
      updated: extractTag(block, 'updated'),
      authors: extractAuthors(block),
      categories: extractCategories(block),
      absUrl,
      pdfUrl: extractPdfUrl(block) || `https://arxiv.org/pdf/${arxivId}`
    };
  });
}

async function fetchArxivQuery(query, maxResults = 12) {
  const url = new URL('https://export.arxiv.org/api/query');
  url.searchParams.set('search_query', query);
  url.searchParams.set('start', '0');
  url.searchParams.set('max_results', String(maxResults));
  url.searchParams.set('sortBy', 'submittedDate');
  url.searchParams.set('sortOrder', 'descending');

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'research-intel-bot/0.1 (+local)'
    }
  });

  if (!response.ok) {
    throw new Error(`arXiv query failed (${response.status}) for ${query}`);
  }

  return parseArxivFeed(await response.text());
}

function buildPdfCandidateUrls(paper) {
  const urls = [];
  const seen = new Set();
  const add = (value) => {
    const url = String(value || '').trim();
    if (!url || seen.has(url)) {
      return;
    }
    seen.add(url);
    urls.push(url);
  };

  const absUrl = String(paper?.absUrl || '').trim();
  const versionedId = absUrl
    ? absUrl.split('/abs/')[1] || absUrl.split('/pdf/')[1] || ''
    : '';
  const cleanVersionedId = versionedId.replace(/\.pdf$/i, '');
  const baseId = normalizeArxivId(paper?.arxivId || cleanVersionedId);
  const rawPdfUrl = String(paper?.pdfUrl || '').trim();
  const cleanPdfUrl = rawPdfUrl.replace(/\.pdf$/i, '');

  add(rawPdfUrl);
  if (cleanPdfUrl && cleanPdfUrl !== rawPdfUrl) {
    add(cleanPdfUrl);
  }
  if (cleanPdfUrl && !cleanPdfUrl.endsWith('.pdf')) {
    add(`${cleanPdfUrl}.pdf`);
  }

  if (cleanVersionedId) {
    add(`https://arxiv.org/pdf/${cleanVersionedId}`);
    add(`https://arxiv.org/pdf/${cleanVersionedId}.pdf`);
  }

  if (baseId) {
    add(`https://arxiv.org/pdf/${baseId}`);
    add(`https://arxiv.org/pdf/${baseId}.pdf`);
  }

  return urls;
}

function buildSearchQueries(profile) {
  const queries = new Set();

  const addQuery = value => {
    const query = String(value || '').trim();
    if (!query) {
      return;
    }
    queries.add(query);
  };
  const addPhrase = (phrase, source = 'generic') => {
    const clean = cleanQueryPhrase(phrase);
    if (!clean) {
      return;
    }
    if (BROAD_SOLO_QUERY_PHRASES.has(clean.toLowerCase())) {
      return;
    }
    if (source !== 'focus' && shouldSkipAuxiliaryPhrase(clean)) {
      return;
    }
    addQuery(`all:"${clean}"`);
  };
  const addCompoundQuery = (left, right) => {
    const cleanLeft = cleanQueryPhrase(left);
    const cleanRight = cleanQueryPhrase(right);
    if (!cleanLeft || !cleanRight || cleanLeft === cleanRight) {
      return;
    }
    addQuery(`all:"${cleanLeft}" AND all:"${cleanRight}"`);
  };

  const focusKeywords = (profile.focusKeywords || []).slice(0, 8);
  const positiveSignals = (profile.positiveSignals || []).slice(0, 10);
  const taxonomyKeywords = (profile.methodTaxonomy || [])
    .flatMap(branch => branch?.keywords || [])
    .slice(0, 16);
  const likedFeedbackPhrases = (profile.feedback || [])
    .filter(item => item?.liked)
    .flatMap(item => extractStrategicPhrases(item.notes || '', 3));
  const sortedSignals = uniqueCleanPhrases(positiveSignals).sort(compareQueryPhrasePriority);
  const sortedTaxonomyKeywords = uniqueCleanPhrases(taxonomyKeywords).sort(compareQueryPhrasePriority);
  const sortedFeedbackHints = uniqueCleanPhrases(likedFeedbackPhrases).sort(compareQueryPhrasePriority);

  for (const keyword of focusKeywords) {
    addPhrase(keyword, 'focus');
  }
  for (const signal of sortedSignals.slice(0, 4)) {
    addPhrase(signal, 'signal');
  }
  for (const keyword of sortedTaxonomyKeywords.slice(0, 6)) {
    addPhrase(keyword, 'taxonomy');
  }

  const discoveryBroadPhrases = uniqueCleanPhrases([
    ...focusKeywords,
    ...sortedSignals,
    ...sortedTaxonomyKeywords,
    ...sortedFeedbackHints
  ]).filter(isBroadDiscoveryPhrase);
  const methodComponents = uniqueCleanPhrases([
    ...sortedSignals,
    ...sortedTaxonomyKeywords,
    ...sortedFeedbackHints,
    ...focusKeywords
  ]).filter(phrase => {
    if (!phrase || isBroadDiscoveryPhrase(phrase)) {
      return false;
    }
    if (tokenCount(phrase) < 2 || tokenCount(phrase) > 3) {
      return false;
    }
    return !shouldSkipAuxiliaryPhrase(phrase) || phraseHasHighSignalTokens(phrase);
  }).sort(compareQueryPhrasePriority);
  const agentAnchors = uniqueCleanPhrases([
    ...focusKeywords,
    'self-improving agents',
    'self-evolving agents'
  ]).filter(phrase => phraseMentionsAgent(phrase));

  for (const anchor of agentAnchors.slice(0, 2)) {
    for (const methodPhrase of methodComponents.slice(0, 6)) {
      if (phrasesShareTooMuchSurface(anchor, methodPhrase)) {
        continue;
      }
      addCompoundQuery(anchor, methodPhrase);
    }
  }

  for (const broadPhrase of discoveryBroadPhrases.slice(0, 6)) {
    if (phraseMentionsAgent(broadPhrase)) {
      continue;
    }
    for (const anchor of agentAnchors.slice(0, 2)) {
      if (phrasesShareTooMuchSurface(broadPhrase, anchor)) {
        continue;
      }
      addCompoundQuery(broadPhrase, anchor);
    }
  }

  for (const broadPhrase of discoveryBroadPhrases.slice(0, 6)) {
    for (const methodPhrase of methodComponents.slice(0, 6)) {
      if (phrasesShareTooMuchSurface(broadPhrase, methodPhrase)) {
        continue;
      }
      addCompoundQuery(broadPhrase, methodPhrase);
    }
  }

  for (const focus of focusKeywords.slice(0, 4)) {
    for (const signal of sortedSignals.slice(0, 4)) {
      addCompoundQuery(focus, signal);
    }
  }

  addPhrase('self-improving agents');
  addPhrase('self-evolving agents');

  return [...queries].slice(0, 24);
}

function cleanQueryPhrase(phrase) {
  return String(phrase || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^["']|["']$/g, '');
}

function shouldSkipAuxiliaryPhrase(phrase) {
  const normalized = String(phrase || '').trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (GENERIC_AUXILIARY_QUERY_PHRASES.has(normalized)) {
    return true;
  }
  return normalized.split(/\s+/).length < 2;
}

function extractStrategicPhrases(text, maxPhrases = 3) {
  const tokens = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length > 1 && !QUERY_STOPWORDS.has(token));

  const ranked = [];
  const seen = new Set();
  for (let size = 2; size <= 4; size += 1) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      const phraseTokens = tokens.slice(index, index + size);
      if (!phraseTokens.some(token => STRATEGIC_QUERY_TOKENS.has(token))) {
        continue;
      }
      if (!isUsefulStrategicPhrase(phraseTokens)) {
        continue;
      }
      const phrase = phraseTokens.join(' ');
      if (seen.has(phrase)) {
        continue;
      }
      seen.add(phrase);
      ranked.push({
        phrase,
        score: phraseTokens.filter(token => STRATEGIC_QUERY_TOKENS.has(token)).length * 4 + size
      });
    }
  }

  return ranked
    .sort((left, right) => right.score - left.score || left.phrase.localeCompare(right.phrase))
    .map(item => item.phrase)
    .slice(0, maxPhrases);
}

function isUsefulStrategicPhrase(tokens) {
  if (!tokens.length) {
    return false;
  }
  if (new Set(tokens).size !== tokens.length) {
    return false;
  }
  if (!tokens.some(token => HIGH_SIGNAL_QUERY_TOKENS.has(token))) {
    return false;
  }
  return true;
}

function uniqueCleanPhrases(phrases) {
  const ordered = [];
  const seen = new Set();
  for (const phrase of phrases || []) {
    const clean = cleanQueryPhrase(phrase);
    if (!clean) {
      continue;
    }
    const key = clean.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    ordered.push(clean);
  }
  return ordered;
}

function isBroadDiscoveryPhrase(phrase) {
  return BROAD_SOLO_QUERY_PHRASES.has(cleanQueryPhrase(phrase).toLowerCase());
}

function phraseHasHighSignalTokens(phrase) {
  return cleanQueryPhrase(phrase)
    .toLowerCase()
    .split(/\s+/)
    .some(token => HIGH_SIGNAL_QUERY_TOKENS.has(token));
}

function phraseMentionsAgent(phrase) {
  return /\bagent(s)?\b/i.test(cleanQueryPhrase(phrase));
}

function phrasesShareTooMuchSurface(left, right) {
  const leftTokens = new Set(cleanQueryPhrase(left).toLowerCase().split(/\s+/).filter(Boolean));
  const rightTokens = new Set(cleanQueryPhrase(right).toLowerCase().split(/\s+/).filter(Boolean));
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap >= Math.min(leftTokens.size, rightTokens.size);
}

function compareQueryPhrasePriority(left, right) {
  const score = phraseQueryPriority(right) - phraseQueryPriority(left);
  if (score !== 0) {
    return score;
  }
  const lengthScore = tokenCount(left) - tokenCount(right);
  if (lengthScore !== 0) {
    return lengthScore;
  }
  return left.localeCompare(right);
}

function phraseQueryPriority(phrase) {
  const clean = cleanQueryPhrase(phrase).toLowerCase();
  let score = 0;
  if (PRIORITY_METHOD_QUERY_PHRASES.has(clean)) {
    score += 30;
  }
  if (PRIORITY_BROAD_QUERY_PHRASES.has(clean)) {
    score += 14;
  }
  if (DEPRIORITIZED_SIGNAL_QUERY_PHRASES.has(clean)) {
    score -= 15;
  }
  if (phraseHasHighSignalTokens(clean)) {
    score += 8;
  }
  if (phraseMentionsAgent(clean)) {
    score += 4;
  }
  if (isBroadDiscoveryPhrase(clean)) {
    score -= 6;
  }
  return score;
}

function tokenCount(phrase) {
  return cleanQueryPhrase(phrase).split(/\s+/).filter(Boolean).length;
}

module.exports = {
  buildPdfCandidateUrls,
  buildSearchQueries,
  fetchArxivQuery,
  parseArxivFeed
};
