#!/usr/bin/env node

function parseFrontmatter(markdown) {
  const source = String(markdown || '').replace(/\r/g, '');
  const match = source.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return {};
  }

  const data = {};
  for (const rawLine of match[1].split('\n')) {
    const line = rawLine.trim();
    if (!line || !line.includes(':')) {
      continue;
    }
    const separatorIndex = line.indexOf(':');
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    value = value.replace(/^"(.*)"$/, '$1');

    if (/^\d+$/.test(value)) {
      data[key] = Number(value);
    } else {
      data[key] = value;
    }
  }
  return data;
}

function parseBulletSection(markdown, heading) {
  const source = String(markdown || '').replace(/\r/g, '');
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`## ${escapedHeading}\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = source.match(regex);
  if (!match) {
    return [];
  }

  return match[1]
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('- '))
    .map(line => line.slice(2).trim())
    .filter(Boolean);
}

function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeArxivId(arxivId) {
  return String(arxivId || '')
    .trim()
    .replace(/^arxiv:/i, '')
    .replace(/v\d+$/i, '');
}

function tokenize(text) {
  return normalizeTitle(text)
    .split(' ')
    .filter(token => token.length > 1);
}

function canonicalToken(token) {
  const normalized = String(token || '').trim().toLowerCase();
  if (normalized.length <= 3) {
    return normalized;
  }
  if (normalized.endsWith('ies') && normalized.length > 4) {
    return `${normalized.slice(0, -3)}y`;
  }
  if (normalized.endsWith('es') && normalized.length > 4 && !normalized.endsWith('ses')) {
    return normalized.slice(0, -2);
  }
  if (normalized.endsWith('s') && !normalized.endsWith('ss')) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function keywordTokens(text) {
  return tokenize(text).map(canonicalToken);
}

const GENERIC_TOPIC_TOKENS = new Set([
  'agent',
  'agents',
  'framework',
  'frameworks',
  'machine',
  'machines',
  'system',
  'systems',
  'model',
  'models',
  'method',
  'methods'
]);

const RELEVANCE_STOP_TOKENS = new Set([
  ...GENERIC_TOPIC_TOKENS,
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
  'scientific',
  'discovery',
  'research',
  'self',
  'paper',
  'papers',
  'multi'
]);

const BROAD_THEME_PHRASES = new Set([
  'scientific discovery',
  'agent framework',
  'automated research'
].map(normalizeTitle));

const BROAD_SELECTION_KEYWORDS = new Set([
  'automated discovery',
  'open-ended evolution',
  'scientific discovery',
  'self-evolving agents',
  'self-improving agents'
].map(normalizeTitle));

const WEAK_METHOD_THEME_PHRASES = new Set([
  'inter-task learning',
  'minimal necessary structure',
  'minimal scaffolding',
  'evolutionary search',
  'open-ended evolution',
  'open-ended self-improvement',
  'recursive self-improvement',
  'sample efficiency',
  'search policy',
  'self-evolving agents',
  'self-improving agents',
  'self-referential agent',
  'long-term memory',
  'strong code agent baseline'
].map(normalizeTitle));

const MIN_SEED_ALIGNMENT_SCORE = 2;

const APPLIED_DOMAIN_PHRASES = [
  'financial alpha',
  'service dialogue',
  'recommender systems',
  'e commerce',
  'customer service',
  'time series forecasting',
  'clinical workflows',
  'physics collaborations',
  'requirements engineering',
  'image restoration',
  'breast ultrasound',
  'molecular design',
  'material models'
];

const APPLIED_DOMAIN_BASE_PENALTY = 18;
const APPLIED_DOMAIN_LOW_METHOD_PENALTY = 12;
const ACTIONABLE_METHOD_PHRASES = [
  'code agent',
  'experience sharing',
  'hard scientific task',
  'memory archive',
  'memory generation',
  'meta-evolution',
  'policy evolution',
  'program evolution',
  'retrieval-augmented memory',
  'scientific task',
  'skill library',
  'teacher llm',
  'trajectory-informed',
  'verifier loop'
];
const METHOD_CONTEXT_PHRASES = [
  'evolving agents',
  'group-evolving agents',
  'self-evolving',
  'self-improving',
  'recursive self-improvement',
  'open-ended evolution',
  'program evolution',
  'meta-evolution',
  'agent evolution'
];
const DIAGNOSTIC_METHOD_PHRASES = [
  'metric',
  'diagnostic',
  'diagnostics',
  'measure',
  'measurement',
  'model independent',
  'quantify',
  'quantification',
  'characterizing',
  'undecidability',
  'evaluation',
  'benchmark oriented',
  'attractor cycle',
  'novelty',
  'benchmark',
  'ablation'
];
const ABSTRACT_SYSTEMS_FRAMING_PHRASES = [
  'systems thinking',
  'equilibrium',
  'adaptive dynamics',
  'state spaces',
  'economics',
  'policy',
  'systems biology',
  'random boolean network',
  'random boolean networks',
  'synthetic circuit',
  'synthetic circuits',
  'boolean dynamics',
  'paraconsistent logic',
  'quantum inspired',
  'attractor'
];

const SECURITY_NEIGHBORHOOD_PHRASES = [
  'attack',
  'attacker',
  'payload',
  'poisoned',
  'prompt injection',
  'injection',
  'unauthorized',
  'compromise',
  'security risk',
  'persistent control',
  'deception',
  'defense',
  'defences',
  'defenses'
];

const SURVEY_STYLE_PHRASES = [
  'survey',
  'taxonomy',
  'literature review',
  'systematic review',
  'techniques and applications',
  'applications'
];

function hasDirectMethodEvidence({
  matchedKeywords = [],
  matchedSignals = [],
  actionableMethodScore = 0,
  diagnosticEvidenceScore = 0,
  methodContextScore = 0
} = {}) {
  return matchedKeywords.length > 0
    || (matchedSignals.length > 0 && Number(methodContextScore || 0) >= 2)
    || (Number(actionableMethodScore || 0) >= 2 && Number(methodContextScore || 0) >= 2)
    || Number(diagnosticEvidenceScore || 0) >= 4;
}

function isWeakMethodTheme(keyword) {
  return WEAK_METHOD_THEME_PHRASES.has(normalizeTitle(keyword));
}

function parseResearchBrief(markdown) {
  const frontmatter = parseFrontmatter(markdown);
  return {
    timezone: frontmatter.timezone || 'Asia/Shanghai',
    sendTime: frontmatter.send_time || '06:00',
    minPapers: frontmatter.min_papers || 3,
    targetPapers: frontmatter.target_papers || 5,
    maxPapers: frontmatter.max_papers || 8,
    currentGoal: parseBulletSection(markdown, 'Current Goal'),
    focusKeywords: parseBulletSection(markdown, 'Focus Keywords'),
    positiveSignals: parseBulletSection(markdown, 'Positive Signals'),
    negativeSignals: parseBulletSection(markdown, 'Negative Signals'),
    readingPreference: parseBulletSection(markdown, 'Reading Preference'),
    readTitles: new Set()
  };
}

function titleSimilarity(left, right) {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
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

function dedupePapers(papers) {
  const deduped = [];
  const seenIds = new Set();
  const seenTitles = [];

  for (const paper of papers) {
    const normalizedId = normalizeArxivId(paper.arxivId || paper.arxiv_id);
    const normalizedTitle = normalizeTitle(paper.title);

    if (normalizedId && seenIds.has(normalizedId)) {
      continue;
    }

    if (seenTitles.some(title => titleSimilarity(title, normalizedTitle) >= 0.95)) {
      continue;
    }

    if (normalizedId) {
      seenIds.add(normalizedId);
    }
    seenTitles.push(normalizedTitle);
    deduped.push(paper);
  }

  return deduped;
}

function keywordSpecificity(keyword) {
  return tokenize(keyword).filter(token => !GENERIC_TOPIC_TOKENS.has(token)).length;
}

function isBroadThemePhrase(keyword) {
  return BROAD_THEME_PHRASES.has(normalizeTitle(keyword));
}

function informativeTokens(text) {
  return tokenize(text).filter(token => !RELEVANCE_STOP_TOKENS.has(token));
}

function countInformativeOverlap(leftText, rightText) {
  const leftTokens = new Set(informativeTokens(leftText));
  const rightTokens = new Set(informativeTokens(rightText));
  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap;
}

function keywordMatchesText(text, keyword) {
  const normalized = normalizeTitle(text);
  const normalizedKeyword = normalizeTitle(keyword);
  if (normalized.includes(normalizedKeyword)) {
    return true;
  }

  const keywordTokenSet = [...new Set(keywordTokens(keyword))];
  if (keywordTokenSet.length === 0) {
    return false;
  }

  const textTokens = keywordTokens(text);
  if (keywordTokenSet.length === 1) {
    return textTokens.includes(keywordTokenSet[0]);
  }

  for (let index = 0; index <= textTokens.length - keywordTokenSet.length; index += 1) {
    let matched = true;
    for (let offset = 0; offset < keywordTokenSet.length; offset += 1) {
      if (textTokens[index + offset] !== keywordTokenSet[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return true;
    }
  }

  return false;
}

function scoreSeedAlignment(paper, seed) {
  const seedText = [seed?.title, seed?.notes].filter(Boolean).join(' ');
  if (!seedText) {
    return 0;
  }

  const titleOverlap = countInformativeOverlap(paper.title, seedText);
  const summaryOverlap = countInformativeOverlap(paper.summary, seedText);
  return (titleOverlap * 2) + summaryOverlap;
}

function findRelatedSeeds(paper, seeds, maxResults = 2) {
  return (seeds || [])
    .map(seed => ({ ...seed, score: scoreSeedAlignment(paper, seed) }))
    .filter(seed => seed.score >= MIN_SEED_ALIGNMENT_SCORE)
    .sort((left, right) => right.score - left.score)
    .slice(0, maxResults);
}

function isDirectImportSeedMatch(paper, seed) {
  if (!seed?.directImport) {
    return false;
  }

  const paperArxivId = normalizeArxivId(paper?.arxivId || paper?.arxiv_id);
  const seedArxivId = normalizeArxivId(seed?.arxivId);
  const normalizedPaperTitle = normalizeTitle(paper?.title || '');
  const normalizedSeedTitle = normalizeTitle(seed?.title || '');

  if (paperArxivId && seedArxivId) {
    const paperBaseId = paperArxivId.replace(/v\d+$/i, '');
    const seedBaseId = seedArxivId.replace(/v\d+$/i, '');
    if (paperBaseId === seedBaseId) {
      return true;
    }
  }

  if (normalizedPaperTitle && normalizedSeedTitle && titleSimilarity(normalizedPaperTitle, normalizedSeedTitle) >= 0.95) {
    return true;
  }

  return false;
}

function scoreFeedbackAlignment(paper, feedback) {
  const feedbackText = [feedback?.title, feedback?.notes].filter(Boolean).join(' ');
  if (!feedbackText) {
    return 0;
  }

  const titleOverlap = countInformativeOverlap(paper.title, feedbackText);
  const summaryOverlap = countInformativeOverlap(paper.summary, feedbackText);
  return titleOverlap + summaryOverlap;
}

function findRelatedFeedback(paper, feedbackRecords, maxResults = 2) {
  return (feedbackRecords || [])
    .map(record => ({ ...record, score: scoreFeedbackAlignment(paper, record) }))
    .filter(record => record.score >= 2)
    .sort((left, right) => right.score - left.score)
    .slice(0, maxResults);
}

function findMatchedKeywords(text, keywords, { requireSpecificity = false, skipBroadThemes = false } = {}) {
  return keywords.filter(keyword => {
    if (!keywordMatchesText(text, keyword)) {
      return false;
    }
    if (skipBroadThemes && isBroadThemePhrase(keyword)) {
      return false;
    }
    if (requireSpecificity && keywordSpecificity(keyword) === 0) {
      return false;
    }
    return true;
  });
}

function countKeywordMatches(text, keywords, weight = 1, { useSpecificity = false, skipBroadThemes = false } = {}) {
  let score = 0;
  for (const keyword of keywords) {
    if (skipBroadThemes && isBroadThemePhrase(keyword)) {
      continue;
    }
    if (keywordMatchesText(text, keyword)) {
      const specificity = useSpecificity ? keywordSpecificity(keyword) : 1;
      score += weight * specificity;
    }
  }
  return score;
}

function daysSince(published, now) {
  const publishedDate = new Date(published);
  if (Number.isNaN(publishedDate.getTime())) {
    return 365;
  }
  const diffMs = now.getTime() - publishedDate.getTime();
  return Math.max(0, diffMs / (24 * 60 * 60 * 1000));
}

function countAppliedDomainMatches(text) {
  const normalized = normalizeTitle(text);
  return APPLIED_DOMAIN_PHRASES.reduce(
    (total, phrase) => total + (normalized.includes(phrase) ? 1 : 0),
    0
  );
}

function countPhraseHits(text, phrases = []) {
  return (phrases || []).reduce((total, phrase) => {
    if (!phrase || !keywordMatchesText(text, phrase)) {
      return total;
    }
    return total + Math.max(1, normalizeTitle(phrase).split(' ').length);
  }, 0);
}

function scoreBranchAlignment(paper, branches = []) {
  const blob = normalizeTitle([paper.title, paper.summary].filter(Boolean).join(' '));
  const scored = (branches || [])
    .map(branch => {
      let phraseScore = 0;
      let singleHits = 0;
      for (const keyword of branch?.keywords || []) {
        const normalizedKeyword = normalizeTitle(keyword);
        if (!normalizedKeyword) {
          continue;
        }
        if (isWeakMethodTheme(normalizedKeyword)) {
          continue;
        }
        if (!keywordMatchesText(blob, normalizedKeyword)) {
          continue;
        }
        const tokenCount = normalizedKeyword.split(' ').length;
        if (tokenCount >= 2) {
          phraseScore += Math.max(2, tokenCount);
        } else if (!GENERIC_TOPIC_TOKENS.has(normalizedKeyword)) {
          singleHits += 1;
        }
      }
      const score = phraseScore + (singleHits >= 2 ? singleHits : 0);
      return {
        id: String(branch?.id || ''),
        title: String(branch?.title || ''),
        score
      };
    })
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));

  return scored[0] || {
    id: '',
    title: '',
    score: 0
  };
}

function isBroadSelectionKeyword(keyword) {
  return BROAD_SELECTION_KEYWORDS.has(normalizeTitle(keyword));
}

function scorePaper(paper, profile, now = new Date()) {
  const normalizedTitle = normalizeTitle(paper.title);
  if (profile.readTitles.has(normalizedTitle)) {
    return {
      score: -100,
      reasons: ['already_read'],
      matchedKeywords: [],
      matchedSignals: [],
      matchedFeedback: [],
      avoidedFeedback: []
    };
  }

  const relatedSeeds = findRelatedSeeds(paper, profile.seeds || [], 3);
  const directImportMatch = relatedSeeds.some(seed => isDirectImportSeedMatch(paper, seed));
  const relatedPositiveFeedback = findRelatedFeedback(
    paper,
    (profile.feedback || []).filter(record => record?.liked),
    2
  );
  const relatedNegativeFeedback = findRelatedFeedback(
    paper,
    (profile.feedback || []).filter(record => !record?.liked && record?.status === 'archived'),
    2
  );
  const matchedKeywords = findMatchedKeywords(
    `${paper.title} ${paper.summary}`,
    profile.focusKeywords,
    { requireSpecificity: true, skipBroadThemes: true }
  );
  const effectivePositiveSignals = (profile.positiveSignals || []).filter(signal => !isWeakMethodTheme(signal));
  const matchedSignals = findMatchedKeywords(
    `${paper.title} ${paper.summary}`,
    effectivePositiveSignals,
    { requireSpecificity: true, skipBroadThemes: true }
  );
  const coreMatchedKeywords = matchedKeywords.filter(keyword => !isWeakMethodTheme(keyword));
  const coreMatchedSignals = matchedSignals.filter(signal => !isWeakMethodTheme(signal));
  const titleKeywordScore = countKeywordMatches(paper.title, profile.focusKeywords, 8, {
    useSpecificity: true,
    skipBroadThemes: true
  });
  const abstractKeywordScore = countKeywordMatches(paper.summary, profile.focusKeywords, 4, {
    useSpecificity: true,
    skipBroadThemes: true
  });
  const positiveSignalScore = countKeywordMatches(
    `${paper.title} ${paper.summary}`,
    effectivePositiveSignals,
    3,
    {
      useSpecificity: true,
      skipBroadThemes: true
    }
  );
  const seedAlignmentScore = Math.min(
    relatedSeeds.reduce((total, seed) => total + seed.score, 0) * 3,
    18
  );
  const feedbackAlignmentScore = Math.min(
    relatedPositiveFeedback.reduce((total, record) => total + record.score, 0) * 3,
    18
  );
  const negativeSignalPenalty = countKeywordMatches(
    `${paper.title} ${paper.summary}`,
    profile.negativeSignals,
    10
  );
  const feedbackAvoidPenalty = Math.min(
    relatedNegativeFeedback.reduce((total, record) => total + record.score, 0) * 4,
    24
  );
  const freshnessDays = daysSince(paper.published, now);
  const freshnessScore = Math.max(0, 45 - Math.min(freshnessDays, 45));
  const appliedDomainMatches = countAppliedDomainMatches(`${paper.title} ${paper.summary}`);
  const branchAlignment = scoreBranchAlignment(paper, profile.methodTaxonomy || []);
  const branchFitScore = Math.min(branchAlignment.score * 2, 16);
  const actionableMethodScore = countPhraseHits(`${paper.title} ${paper.summary}`, ACTIONABLE_METHOD_PHRASES);
  const methodContextScore = countPhraseHits(`${paper.title} ${paper.summary}`, METHOD_CONTEXT_PHRASES);
  const diagnosticEvidenceScore = countPhraseHits(`${paper.title} ${paper.summary}`, DIAGNOSTIC_METHOD_PHRASES);
  const abstractSystemsFramingScore = countPhraseHits(`${paper.title} ${paper.summary}`, ABSTRACT_SYSTEMS_FRAMING_PHRASES);
  const securityAdjacentScore = countPhraseHits(`${paper.title} ${paper.summary}`, SECURITY_NEIGHBORHOOD_PHRASES);
  const surveyStyleScore = countPhraseHits(`${paper.title} ${paper.summary}`, SURVEY_STYLE_PHRASES);
  const specificMatchedKeywords = matchedKeywords.filter(keyword => !isBroadSelectionKeyword(keyword));
  const weakThemeOnlyPenalty = (
    (matchedKeywords.length > 0 || matchedSignals.length > 0)
      && coreMatchedKeywords.length === 0
      && coreMatchedSignals.length === 0
      && actionableMethodScore < 2
      && diagnosticEvidenceScore < 4
  ) ? 24 : 0;
  const thinMethodEvidencePenalty = (
    matchedKeywords.length > 0
      && specificMatchedKeywords.length === 0
      && matchedSignals.length === 0
      && relatedSeeds.length === 0
      && relatedPositiveFeedback.length === 0
      && branchAlignment.score === 0
      && actionableMethodScore < 2
      && diagnosticEvidenceScore < 4
  ) ? 22 : 0;
  const diagnosticWithoutActionableMethodPenalty = (
    branchAlignment.id === 'open-endedness-diagnostics'
      && actionableMethodScore < 4
      && diagnosticEvidenceScore < 4
      && matchedSignals.length === 0
      && relatedPositiveFeedback.length === 0
  ) ? 28 : 0;
  const abstractSystemsPenalty = (
    branchAlignment.id === 'open-endedness-diagnostics'
      && abstractSystemsFramingScore >= 3
      && actionableMethodScore < 6
      && diagnosticEvidenceScore < 6
  ) ? 16 : 0;
  const securityAdjacentPenalty = (
    securityAdjacentScore >= 3
      && coreMatchedKeywords.length === 0
      && coreMatchedSignals.length === 0
  ) ? 28 : 0;
  const surveyStylePenalty = (
    surveyStyleScore >= 2
      && coreMatchedKeywords.length === 0
      && coreMatchedSignals.length === 0
  ) ? 24 : 0;
  const staticBranchWeakPenalty = (
    branchAlignment.id === 'static-agents-limit'
      && coreMatchedKeywords.length === 0
      && coreMatchedSignals.length === 0
  ) ? 22 : 0;
  const staleNoCorePenalty = (
    freshnessDays > 120
      && coreMatchedKeywords.length === 0
      && coreMatchedSignals.length === 0
  ) ? 22 : 0;
  const veryOldPenalty = freshnessDays > 180 ? 26 : 0;
  const inferredDirectMethodEvidence = hasDirectMethodEvidence({
    matchedKeywords: coreMatchedKeywords,
    matchedSignals: coreMatchedSignals,
    actionableMethodScore,
    diagnosticEvidenceScore,
    methodContextScore
  });
  const directMethodEvidence = inferredDirectMethodEvidence || directImportMatch;
  const indirectAlignmentOnlyPenalty = (
    !directMethodEvidence
      && (relatedSeeds.length > 0 || relatedPositiveFeedback.length > 0)
  ) ? 18 : 0;
  const directImportBoost = directImportMatch ? 36 : 0;
  const methodEvidenceScore = (
    specificMatchedKeywords.length * 6
      + matchedSignals.length * 6
      + branchFitScore
      + (relatedSeeds.length > 0 ? 4 : 0)
      + (relatedPositiveFeedback.length > 0 ? 4 : 0)
      + Math.min(actionableMethodScore, 8)
      + Math.min(diagnosticEvidenceScore, 8)
  );
  const appliedDomainPenalty = appliedDomainMatches === 0
    ? 0
    : (appliedDomainMatches * APPLIED_DOMAIN_BASE_PENALTY)
      + ((matchedSignals.length === 0 && methodEvidenceScore < 14) ? appliedDomainMatches * APPLIED_DOMAIN_LOW_METHOD_PENALTY : 0);

  const score = titleKeywordScore
    + abstractKeywordScore
    + positiveSignalScore
    + seedAlignmentScore
    + feedbackAlignmentScore
    + branchFitScore
    + freshnessScore
    + directImportBoost
    - negativeSignalPenalty
    - feedbackAvoidPenalty
    - weakThemeOnlyPenalty
    - thinMethodEvidencePenalty
    - diagnosticWithoutActionableMethodPenalty
    - abstractSystemsPenalty
    - securityAdjacentPenalty
    - surveyStylePenalty
    - staticBranchWeakPenalty
    - staleNoCorePenalty
    - veryOldPenalty
    - indirectAlignmentOnlyPenalty
    - appliedDomainPenalty;
  const reasons = [];
  if (titleKeywordScore > 0 || abstractKeywordScore > 0) reasons.push('keyword_match');
  if (positiveSignalScore > 0) reasons.push('positive_signal');
  if (seedAlignmentScore > 0) reasons.push('seed_match');
  if (directImportMatch) reasons.push('direct_import');
  if (feedbackAlignmentScore > 0) reasons.push('feedback_match');
  if (branchFitScore > 0) reasons.push('branch_fit');
  if (freshnessScore > 20) reasons.push('fresh');
  if (negativeSignalPenalty > 0) reasons.push('negative_signal');
  if (feedbackAvoidPenalty > 0) reasons.push('feedback_avoid');
  if (weakThemeOnlyPenalty > 0) reasons.push('weak_theme_only');
  if (thinMethodEvidencePenalty > 0) reasons.push('thin_method_evidence');
  if (diagnosticWithoutActionableMethodPenalty > 0) reasons.push('diagnostic_without_actionable_method');
  if (abstractSystemsPenalty > 0) reasons.push('abstract_systems_framing');
  if (securityAdjacentPenalty > 0) reasons.push('security_adjacent');
  if (surveyStylePenalty > 0) reasons.push('survey_style');
  if (staticBranchWeakPenalty > 0) reasons.push('static_branch_weak');
  if (staleNoCorePenalty > 0) reasons.push('stale_without_core');
  if (veryOldPenalty > 0) reasons.push('very_old');
  if (indirectAlignmentOnlyPenalty > 0) reasons.push('indirect_alignment_only');
  if ((diagnosticWithoutActionableMethodPenalty > 0 || abstractSystemsPenalty > 0) && branchAlignment.id === 'open-endedness-diagnostics') {
    reasons.push('thin_diagnostic_theory');
  }
  if (appliedDomainPenalty > 0) reasons.push('applied_domain');

  const selectionBand = score <= 0
    || weakThemeOnlyPenalty > 0
    || thinMethodEvidencePenalty > 0
    || diagnosticWithoutActionableMethodPenalty > 0
    || abstractSystemsPenalty > 0
    || securityAdjacentPenalty > 0
    || surveyStylePenalty > 0
    || staticBranchWeakPenalty > 0
    || staleNoCorePenalty > 0
    || veryOldPenalty > 0
    || indirectAlignmentOnlyPenalty > 0
    || !directMethodEvidence
    || (appliedDomainMatches > 0 && methodEvidenceScore < 10)
    ? 'reject'
    : (methodEvidenceScore >= 10 || branchFitScore > 0 || matchedSignals.length > 0)
      ? 'strong'
      : 'borderline';

  return {
    score,
    reasons,
    matchedKeywords,
    matchedSignals,
    directMethodEvidence,
    selectionBand,
    branchId: branchAlignment.id,
    branchFitScore: branchAlignment.score,
    matchedFeedback: relatedPositiveFeedback.map(record => record.title),
    avoidedFeedback: relatedNegativeFeedback.map(record => record.title)
  };
}

function selectPapers(candidates, profile, now = new Date()) {
  return dedupePapers(candidates)
    .map(paper => {
      const scored = scorePaper(paper, profile, now);
      return { ...paper, ...scored };
    })
    .filter(paper => paper.score > 0)
    .filter(paper => paper.selectionBand !== 'reject')
    .filter(
      paper => paper.reasons.includes('keyword_match')
        || paper.reasons.includes('positive_signal')
        || paper.reasons.includes('seed_match')
        || paper.reasons.includes('direct_import')
        || paper.reasons.includes('feedback_match')
    )
    .sort((left, right) => right.score - left.score)
    .slice(0, profile.maxPapers);
}

module.exports = {
  normalizeTitle,
  normalizeArxivId,
  parseResearchBrief,
  dedupePapers,
  findRelatedSeeds,
  scorePaper,
  selectPapers
};
