#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPaperSlug,
  buildRecordPaths,
  buildRunPaths,
  decorateSelectedPapers
} = require('../scripts/research-intel/lib/daily');
const {
  minimumArtifactCount,
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
  assert.equal(
    paths.packagePath,
    '/tmp/research-intel/daily/2026-03-13/research-intelligence-2026-03-13.tar.gz'
  );
});

test('buildRecordPaths creates tracked record layout separate from heavy run outputs', () => {
  const paths = buildRecordPaths('/tmp/research-intel-records', '2026-03-13');

  assert.equal(paths.runDir, '/tmp/research-intel-records/daily/2026-03-13');
  assert.equal(paths.knowledgeDir, '/tmp/research-intel-records/knowledge');
  assert.equal(paths.methodTreeJsonPath, '/tmp/research-intel-records/knowledge/method_tree.json');
  assert.equal(paths.methodTreeMarkdownPath, '/tmp/research-intel-records/knowledge/method_tree.md');
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
