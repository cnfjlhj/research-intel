#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildBriefMarkdown,
  buildReadingRouteMarkdown,
  buildMethodTreeDeltaMarkdown,
  buildTelegramMessage,
  findRelatedSeeds
} = require('../scripts/research-intel/lib/render');

test('buildBriefMarkdown includes motivation, method takeaway, and discovery fields', () => {
  const markdown = buildBriefMarkdown([
    {
      title: 'SAHOO',
      published: '2026-03-06T14:44:51Z',
      reasonWhyToday: '命中关键词',
      motivationSummary: '想解决静态 agent 无法持续提升的问题。',
      methodTakeaway: '用 recursive self-improvement 做主切口。',
      relatedSeeds: [{ title: 'Gödel Agent' }],
      webCoverage: {
        codeRepos: [
          { full_name: 'SubramanyamSahoo/SAHOO', html_url: 'https://github.com/SubramanyamSahoo/SAHOO' }
        ],
        chineseBlogs: [
          { title: 'SAHOO 论文解读', url: 'https://zhuanlan.zhihu.com/p/123456' }
        ],
        coverage: [
          { title: 'OpenTrain summary', url: 'https://www.opentrain.ai/example' }
        ]
      }
    }
  ], '2026-03-13', {
    overview: '今天先看主问题，再看机制。',
    route_logic: '先基础，再机制。'
  }, [
    {
      title: 'Older Neighbor Paper',
      selectionBand: 'reject',
      reasons: ['very_old'],
      motivationSummary: '这篇更适合作为回补材料。',
      methodTakeaway: '它补充了 archive 方向。',
      relatedSeeds: [{ title: 'Darwin Godel Machine' }]
    }
  ]);

  assert.match(markdown, /## 今日主线/);
  assert.match(markdown, /\| 研究动机 \| 方法切口 \| 为什么今天看 \| 线索 \|/);
  assert.match(markdown, /Quick Takes/);
  assert.match(markdown, /观察池 \/ Watchlist/);
  assert.match(markdown, /Older Neighbor Paper/);
  assert.match(markdown, /想解决静态 agent 无法持续提升的问题/);
  assert.match(markdown, /\[SubramanyamSahoo\/SAHOO\]/);
  assert.match(markdown, /\[SAHOO 论文解读\]/);
  assert.match(markdown, /\[OpenTrain summary\]/);
});

test('buildTelegramMessage summarizes enrichment counts for each selected paper', () => {
  const text = buildTelegramMessage({
    dateString: '2026-03-13',
    selectedPapers: [
      {
        title: 'SAHOO',
        reasonWhyToday: '命中关键词',
        webCoverage: {
          codeRepos: [{ full_name: 'SubramanyamSahoo/SAHOO' }],
          chineseBlogs: [{ title: 'SAHOO 论文解读' }],
          coverage: [{ title: 'OpenTrain summary' }, { title: 'Another coverage' }]
        }
      }
    ],
    watchlistPapers: [
      {
        title: 'Older Neighbor Paper'
      }
    ],
    artifactPackage: '/tmp/research-intelligence-2026-03-13.tar.gz'
  });

  assert.match(text, /代码 1/);
  assert.match(text, /中文博客 1/);
  assert.match(text, /外部报道 2/);
  assert.match(text, /观察池 1 篇/);
});

test('buildBriefMarkdown and buildTelegramMessage stay usable when no paper passes the daily gate', () => {
  const markdown = buildBriefMarkdown([], '2026-03-17', {
    overview: '今天先保持主线收敛，不强推边缘论文。',
    route_logic: '主推为空时，先看观察池。'
  }, [
    {
      title: 'Watchlist Only Paper',
      selectionBand: 'borderline',
      reasons: ['thin_method_evidence'],
      motivationSummary: '这篇和当前方向相关，但证据还不够硬。',
      methodTakeaway: '它补的是 memory archive 侧面材料。',
      relatedSeeds: [{ title: 'Darwin Godel Machine' }]
    }
  ]);

  const text = buildTelegramMessage({
    dateString: '2026-03-17',
    selectedPapers: [],
    watchlistPapers: [
      {
        title: 'Watchlist Only Paper'
      }
    ],
    artifactPackage: '/tmp/research-intelligence-2026-03-17.tar.gz'
  });

  assert.match(markdown, /今天没有论文通过主推筛选/);
  assert.match(markdown, /观察池 \/ Watchlist/);
  assert.match(markdown, /Watchlist Only Paper/);
  assert.match(text, /今天没有论文通过主推筛选/);
  assert.match(text, /已保留 1 篇观察池论文/);
});

test('buildMethodTreeDeltaMarkdown summarizes method-tree updates and paper cards', () => {
  const markdown = buildMethodTreeDeltaMarkdown({
    dateString: '2026-03-13',
    delta: {
      summary: '新增方法分支 1，新增论文 1，新增共享线索 1',
      addedBranches: [
        { id: 'recursive-self-improvement', title: 'Recursive Self-Improvement' }
      ],
      addedPapers: [
        { branchTitle: 'Recursive Self-Improvement', title: 'SAHOO' }
      ],
      addedSharedConcepts: [
        { branchTitle: 'Recursive Self-Improvement', concept: '共同线索：recursive self-improvement' }
      ]
    },
    paperCards: [
      {
        title: 'SAHOO',
        relation_to_seeds: ['Gödel Agent'],
        method_tags: ['recursive self-improvement']
      }
    ]
  });

  assert.match(markdown, /# 2026-03-13 Method Tree Delta/);
  assert.match(markdown, /新增方法分支 1/);
  assert.match(markdown, /SAHOO/);
  assert.match(markdown, /Gödel Agent/);
  assert.match(markdown, /recursive self-improvement/);
});

test('buildReadingRouteMarkdown renders route roles and compare axes', () => {
  const markdown = buildReadingRouteMarkdown({
    date: '2026-03-17',
    routeLogic: '先建立问题定义，再看主方法。',
    orderedPapers: [
      {
        rank: 1,
        title: 'Paper A',
        routeRole: 'prerequisite',
        whyHere: '先定义问题边界',
        compareAxes: ['problem framing', 'feedback loop']
      }
    ]
  });

  assert.match(markdown, /# 2026-03-17 Reading Route/);
  assert.match(markdown, /prerequisite/);
  assert.match(markdown, /problem framing/);
  assert.match(markdown, /先定义问题边界/);
});

test('findRelatedSeeds ignores generic agent overlap and prefers method-line anchors', () => {
  const related = findRelatedSeeds(
    {
      title: 'Multi-Agent Collaboration for Automated Design Exploration on High Performance Computing Systems',
      summary: 'A multi-agent system for scientific design exploration.'
    },
    [
      { title: 'Gödel Agent: A Self-Referential Agent Framework for Recursive Self-Improvement' },
      { title: 'Darwin Godel Machine: Open-Ended Evolution of Self-Improving Agents' }
    ]
  );

  assert.equal(related.length, 0);
});
