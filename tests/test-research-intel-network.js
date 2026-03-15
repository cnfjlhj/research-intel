#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createEmptyResearchNetwork,
  buildPaperCard,
  buildNetworkDelta,
  updateResearchNetwork,
  renderResearchNetworkMarkdown,
  slugifyNodeId
} = require('../scripts/research-intel/lib/network');

test('slugifyNodeId creates stable ids for papers and topics', () => {
  assert.equal(slugifyNodeId('Recursive Self-Improvement'), 'recursive-self-improvement');
});

test('updateResearchNetwork adds anchors, topics, papers, and edges without duplication', () => {
  const network = createEmptyResearchNetwork();
  const profile = {
    seeds: [
      { title: 'Gödel Agent: A Self-Referential Agent Framework for Recursive Self-Improvement', anchor: true }
    ]
  };
  const selectedPapers = [
    {
      title: 'SAHOO: Safeguarded Alignment for High-Order Optimization Objectives in Recursive Self-Improvement',
      arxivId: '2603.06333',
      published: '2026-03-06T14:44:51Z',
      matchedKeywords: ['recursive self-improvement'],
      relatedSeeds: [
        { title: 'Gödel Agent: A Self-Referential Agent Framework for Recursive Self-Improvement' }
      ],
      webCoverage: {
        chineseBlogs: [
          { title: 'SAHOO 论文解读', url: 'https://zhuanlan.zhihu.com/p/123456', domain: 'zhuanlan.zhihu.com' }
        ],
        codeRepos: [
          { full_name: 'SubramanyamSahoo/SAHOO', html_url: 'https://github.com/SubramanyamSahoo/SAHOO', stargazers_count: 42 }
        ]
      }
    }
  ];

  const updated = updateResearchNetwork({
    network,
    profile,
    selectedPapers,
    dateString: '2026-03-13'
  });

  assert.ok(updated.nodes.some(node => node.type === 'anchor' && /self-referential agent/i.test(node.label)));
  assert.ok(updated.nodes.some(node => node.type === 'paper' && /SAHOO/i.test(node.label)));
  assert.ok(updated.nodes.some(node => node.type === 'topic' && /recursive self-improvement/i.test(node.label)));
  assert.ok(updated.nodes.some(node => node.type === 'blog' && /论文解读/.test(node.label)));
  assert.ok(updated.nodes.some(node => node.type === 'repo' && /SubramanyamSahoo\/SAHOO/.test(node.label)));
  assert.ok(updated.edges.some(edge => edge.type === 'related_seed'));
  assert.ok(updated.edges.some(edge => edge.type === 'matched_keyword'));
  assert.ok(updated.edges.some(edge => edge.type === 'has_blog'));
  assert.ok(updated.edges.some(edge => edge.type === 'has_code'));
});

test('renderResearchNetworkMarkdown outputs a mermaid graph with recent papers', () => {
  const network = updateResearchNetwork({
    network: createEmptyResearchNetwork(),
    profile: { seeds: [] },
    selectedPapers: [
      {
        title: 'SAHOO: Safeguarded Alignment for High-Order Optimization Objectives in Recursive Self-Improvement',
        arxivId: '2603.06333',
        published: '2026-03-06T14:44:51Z',
        matchedKeywords: ['recursive self-improvement'],
        relatedSeeds: [],
        webCoverage: { chineseBlogs: [], codeRepos: [] }
      }
    ],
    dateString: '2026-03-13'
  });

  const markdown = renderResearchNetworkMarkdown(network);
  assert.match(markdown, /```mermaid/);
  assert.match(markdown, /SAHOO/);
  assert.match(markdown, /recursive self-improvement/i);
});

test('buildPaperCard extracts durable paper-level network facts', () => {
  const card = buildPaperCard({
    paper: {
      title: 'SAHOO: Safeguarded Alignment for High-Order Optimization Objectives in Recursive Self-Improvement',
      arxivId: '2603.06333',
      matchedKeywords: ['recursive self-improvement'],
      matchedSignals: ['recursive agent improvement'],
      reasonWhyToday: '命中关键词：recursive self-improvement；这是最近 1 天内的新论文',
      readingReason: '先看这篇，因为它足够新。',
      relatedSeeds: [{ title: 'Gödel Agent: A Self-Referential Agent Framework for Recursive Self-Improvement' }],
      webCoverage: {
        codeRepos: [{ full_name: 'SubramanyamSahoo/SAHOO', html_url: 'https://github.com/SubramanyamSahoo/SAHOO' }],
        chineseBlogs: [{ title: 'SAHOO 论文解读', url: 'https://zhuanlan.zhihu.com/p/123456' }]
      }
    },
    meta: {
      title: 'SAHOO: Safeguarded Alignment for High-Order Optimization Objectives in Recursive Self-Improvement',
      abstract: 'We study safeguarded alignment in recursive self-improvement systems.',
      recommendation_context: {
        reason_today: '命中关键词：recursive self-improvement',
        reading_reason: '先看这篇，因为它足够新。',
        matched_keywords: ['recursive self-improvement'],
        matched_signals: ['recursive agent improvement']
      }
    },
    openreviewSummary: '暂无公开 OpenReview 信息。',
    dateString: '2026-03-13'
  });

  assert.equal(card.paper_id, 'arxiv:2603.06333');
  assert.match(card.summary_anchor, /We study safeguarded alignment/i);
  assert.ok(card.method_tags.includes('recursive self-improvement'));
  assert.ok(card.relation_to_seeds.some(item => /Gödel Agent/i.test(item)));
  assert.ok(card.external_links.code[0].includes('github.com/SubramanyamSahoo/SAHOO'));
  assert.ok(card.external_links.blogs[0].includes('zhuanlan.zhihu.com'));
});

test('buildPaperCard keeps internal recommendation scaffolding out of core_problem', () => {
  const card = buildPaperCard({
    paper: {
      title: 'Verifier-Guided Archive Search for Self-Evolving Agents',
      arxivId: '2603.99999',
      matchedKeywords: ['self-evolving agents'],
      matchedSignals: ['verifier-guided search'],
      reasonWhyToday: '命中关键词：self-evolving agents；这是最近 1 天内的新论文',
      relatedSeeds: []
    },
    meta: {
      title: 'Verifier-Guided Archive Search for Self-Evolving Agents',
      abstract: 'This paper studies how verifier-guided archive search can stabilize experience reuse in self-evolving agents.',
      recommendation_context: {
        reason_today: '命中关键词：self-evolving agents；这是最近 1 天内的新论文',
        reading_reason: '先看这篇。',
        matched_keywords: ['self-evolving agents'],
        matched_signals: ['verifier-guided search']
      }
    },
    openreviewSummary: '暂无公开 OpenReview 信息。',
    dateString: '2026-03-15'
  });

  assert.ok(card.core_problem.every(item => !/命中关键词/.test(item)));
  assert.match(card.core_problem[0], /verifier-guided archive search/i);
});

test('buildNetworkDelta reports added node and edge counts between snapshots', () => {
  const previous = {
    version: 2,
    nodes: [{ id: 'paper:a', type: 'paper', label: 'A' }],
    edges: [{ source: 'paper:a', target: 'topic:x', type: 'matched_keyword', label: '命中关键词' }]
  };
  const next = {
    version: 2,
    nodes: [
      { id: 'paper:a', type: 'paper', label: 'A' },
      { id: 'paper:b', type: 'paper', label: 'B' },
      { id: 'concept:y', type: 'concept', label: 'Y' }
    ],
    edges: [
      { source: 'paper:a', target: 'topic:x', type: 'matched_keyword', label: '命中关键词' },
      { source: 'paper:b', target: 'concept:y', type: 'addresses', label: '解决问题' }
    ]
  };

  const delta = buildNetworkDelta(previous, next);
  assert.equal(delta.addedNodes.length, 2);
  assert.equal(delta.addedEdges.length, 1);
  assert.equal(delta.removedNodes.length, 0);
  assert.ok(delta.summary.includes('新增节点 2'));
  assert.ok(delta.summary.includes('新增边 1'));
});
