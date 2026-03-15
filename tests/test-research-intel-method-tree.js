#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createEmptyMethodTree,
  buildPaperLeaf,
  buildMethodTreeDelta,
  renderMethodTreeMarkdown,
  rebuildMethodTree,
  updateMethodTree
} = require('../scripts/research-intel/lib/method-tree');

test('buildPaperLeaf keeps only a few durable details plus artifact links', () => {
  const leaf = buildPaperLeaf({
    paper: {
      title: 'Group-Evolving Agents: Open-Ended Self-Improvement via Experience Sharing',
      slug: 'group-evolving-agents',
      reasonWhyToday: '这是最近 1 天内的新论文；与锚点论文直接相关',
      paperCard: {
        summary_anchor: '把群体而不是单个 agent 作为进化单位。',
        main_claims: [
          'SWE-bench Verified 达到 71.0%',
          'Polyglot 达到 88.3%'
        ],
        method_tags: [
          'experience sharing',
          'open-ended self-improvement',
          'group evolution'
        ],
        open_questions: [
          '更大 group size 是否仍然稳定？'
        ]
      },
      htmlPath: '/repo/papers/group-evolving-agents/index.html',
      paperCardPath: '/repo/papers/group-evolving-agents/paper_card.json'
    }
  });

  assert.equal(leaf.title, 'Group-Evolving Agents: Open-Ended Self-Improvement via Experience Sharing');
  assert.ok(leaf.details.length >= 3);
  assert.ok(leaf.details.length <= 6);
  assert.ok(leaf.details.some(item => /71\.0%|88\.3%/.test(item)));
  assert.ok(leaf.details.some(item => /开放问题/.test(item)));
  assert.match(leaf.htmlPath, /index\.html$/);
  assert.match(leaf.paperCardPath, /paper_card\.json$/);
});

test('buildPaperLeaf drops long raw english abstract sentences and keeps durable ledger facts', () => {
  const leaf = buildPaperLeaf({
    paper: {
      title: 'A speciation simulation that partly passes open-endedness tests',
      reasonWhyToday: '命中关键词：open-ended evolution；和 Darwin Godel Machine 主线直接相关',
      paperCard: {
        summary_anchor: 'One of the main goals of artificial life research is to recreate in artificial systems the trends for ever more complex and novel entities.',
        main_claims: [
          'One of the main goals of artificial life research is to recreate in artificial systems the trends for ever more complex and novel entities.',
          '20 runs 中 new evolutionary activity 始终为 0',
          '归一化 cumulative activity 呈现 bounded / negative 趋势'
        ],
        method_tags: ['open-ended evolution'],
        open_questions: ['暂无公开 OpenReview 讨论，后续可继续观察外部反馈。'],
        external_links: {
          code: ['https://github.com/LanaSina/speciation']
        }
      }
    }
  });

  assert.ok(leaf.details.some(item => /今日理由/.test(item)));
  assert.ok(leaf.details.some(item => /方法标签：open-ended evolution/.test(item)));
  assert.ok(leaf.details.some(item => /开源：有代码仓库/.test(item)));
  assert.ok(leaf.details.some(item => /20 runs/.test(item)));
  assert.ok(leaf.details.every(item => !/One of the main goals of artificial life research/i.test(item)));
  assert.equal(
    leaf.details.filter(item => /结论：/.test(item)).length,
    2
  );
});

test('updateMethodTree groups papers by method strand and preserves anchors', () => {
  const previousTree = createEmptyMethodTree();
  const profile = {
    currentGoal: ['持续跟踪 self-evolving agents 方向的方法论文。'],
    methodTaxonomy: [
      {
        id: 'group-evolution',
        title: 'Group Evolution & Experience Sharing',
        keywords: ['group evolution', 'experience sharing', 'parent group']
      },
      {
        id: 'recursive-self-improvement',
        title: 'Recursive Self-Improvement',
        keywords: ['recursive self-improvement', 'godel', 'self-referential']
      }
    ],
    seeds: [
      {
        title: 'Group-Evolving Agents: Open-Ended Self-Improvement via Experience Sharing',
        liked: true,
        status: 'read',
        notes: '关注多智能体经验共享。'
      },
      {
        title: 'Gödel Agent: A Self-Referential Agent Framework for Recursive Self-Improvement',
        liked: true,
        status: 'read',
        notes: 'recursive self-improvement 核心方向。'
      }
    ]
  };

  const nextTree = updateMethodTree({
    tree: previousTree,
    profile,
    selectedPapers: [
      {
        title: 'Group-Evolving Agents: Open-Ended Self-Improvement via Experience Sharing',
        slug: 'group-evolving-agents',
        matchedKeywords: ['open-ended self-improvement'],
        matchedSignals: ['experience sharing'],
        reasonWhyToday: '这是最近 1 天内的新论文；与锚点论文直接相关',
        relatedSeeds: [{ title: 'Group-Evolving Agents: Open-Ended Self-Improvement via Experience Sharing' }],
        paperCard: {
          method_tags: ['experience sharing', 'group evolution'],
          main_claims: ['SWE-bench Verified 71.0%', 'Polyglot 88.3%'],
          summary_anchor: '把群体作为进化单位。'
        },
        htmlPath: '/repo/group-evolving-agents/index.html',
        paperCardPath: '/repo/group-evolving-agents/paper_card.json'
      },
      {
        title: 'Gödel Agent: A Self-Referential Agent Framework for Recursive Self-Improvement',
        slug: 'godel-agent',
        matchedKeywords: ['recursive self-improvement'],
        matchedSignals: ['self-referential agent'],
        reasonWhyToday: '补足 recursive self-improvement 主线',
        relatedSeeds: [{ title: 'Gödel Agent: A Self-Referential Agent Framework for Recursive Self-Improvement' }],
        paperCard: {
          method_tags: ['recursive self-improvement', 'self-referential agent'],
          main_claims: ['提出自指式 agent framework'],
          summary_anchor: '递归式自我改进框架。'
        },
        htmlPath: '/repo/godel-agent/index.html',
        paperCardPath: '/repo/godel-agent/paper_card.json'
      }
    ],
    dateString: '2026-03-14'
  });

  assert.equal(nextTree.branches.length, 2);
  assert.ok(nextTree.branches.some(branch => branch.title === 'Group Evolution & Experience Sharing'));
  assert.ok(nextTree.branches.some(branch => branch.title === 'Recursive Self-Improvement'));
  assert.ok(nextTree.branches.find(branch => branch.id === 'group-evolution').papers.some(paper => /Group-Evolving Agents/.test(paper.title)));
  assert.ok(nextTree.branches.find(branch => branch.id === 'recursive-self-improvement').papers.some(paper => /Gödel Agent/.test(paper.title)));
});

test('renderMethodTreeMarkdown emits a method-first markdown tree with shared nodes and linked papers', () => {
  const tree = {
    version: 1,
    updatedAt: '2026-03-14',
    rootTitle: 'Self-Evolving Agents',
    summary: ['围绕研究动机组织，而不是按论文平铺。'],
    branches: [
      {
        id: 'group-evolution',
        title: 'Group Evolution & Experience Sharing',
        question: '为什么要让经验在群体里传播？',
        sharedConcepts: [
          '常见切口：把群体作为进化单位',
          '常见切口：显式经验共享'
        ],
        papers: [
          {
            title: 'Group-Evolving Agents',
            details: ['SWE-bench 71.0%', 'Polyglot 88.3%', 'K=2, M=4'],
            htmlPath: '/repo/group-evolving-agents/index.html'
          }
        ]
      }
    ]
  };

  const markdown = renderMethodTreeMarkdown(tree);
  assert.match(markdown, /^# Self-Evolving Agents/m);
  assert.match(markdown, /## Group Evolution & Experience Sharing/);
  assert.match(markdown, /- 这个分支在回答：为什么要让经验在群体里传播/);
  assert.match(markdown, /- 常见切口：把群体作为进化单位/);
  assert.match(markdown, /- 论文：Group-Evolving Agents/);
  assert.match(markdown, /- 详情入口：\[HTML\]\(\/repo\/group-evolving-agents\/index.html\)/);
});

test('buildMethodTreeDelta reports branch and paper additions in human-readable markdown input', () => {
  const previousTree = {
    version: 1,
    updatedAt: '2026-03-13',
    rootTitle: 'Self-Evolving Agents',
    summary: [],
    branches: []
  };
  const nextTree = {
    version: 1,
    updatedAt: '2026-03-14',
    rootTitle: 'Self-Evolving Agents',
    summary: [],
    branches: [
      {
        id: 'group-evolution',
        title: 'Group Evolution & Experience Sharing',
        sharedConcepts: ['共同线索：显式经验共享'],
        papers: [
          { title: 'Group-Evolving Agents', details: ['SWE-bench 71.0%'] }
        ]
      }
    ]
  };

  const delta = buildMethodTreeDelta(previousTree, nextTree);
  assert.equal(delta.addedBranches.length, 1);
  assert.equal(delta.addedPapers.length, 1);
  assert.match(delta.summary, /新增方法分支 1/);
  assert.match(delta.summary, /新增论文 1/);
});

test('rebuildMethodTree uses accepted runs instead of carrying over stale papers from old snapshots', () => {
  const profile = {
    rootTitle: 'Self-Evolving Agents',
    currentGoal: ['持续跟踪 self-evolving agents 方向的方法论文。'],
    seeds: [
      {
        title: 'ShinkaEvolve: Towards Open-Ended and Sample-Efficient Program Evolution',
        liked: true,
        status: 'read',
        notes: '关键锚点。'
      }
    ]
  };

  const tree = rebuildMethodTree({
    profile,
    runs: [
      {
        dateString: '2026-03-13',
        selectedPapers: [
          {
            title: 'CADEvolve: Creating Realistic CAD via Program Evolution',
            matchedKeywords: ['program evolution'],
            reasonWhyToday: '命中关键词：program evolution',
            paperCard: {
              method_tags: ['program evolution'],
              summary_anchor: '把 program evolution 用到 CAD 场景。'
            }
          }
        ]
      },
      {
        dateString: '2026-03-14',
        selectedPapers: [
          {
            title: 'RankEvolve: Automating the Discovery of Retrieval Algorithms via LLM-Driven Evolution',
            matchedKeywords: ['program evolution'],
            matchedSignals: ['evolutionary search'],
            reasonWhyToday: '命中关键词：program evolution；命中正向信号：evolutionary search',
            paperCard: {
              method_tags: ['program evolution', 'evolutionary search'],
              summary_anchor: '用 LLM 驱动演化搜索自动发现排序算法。'
            }
          }
        ]
      }
    ],
    defaultDateString: '2026-03-14'
  });

  const titles = tree.branches.flatMap(branch => branch.papers.map(paper => paper.title));
  assert.ok(titles.includes('ShinkaEvolve: Towards Open-Ended and Sample-Efficient Program Evolution'));
  assert.ok(titles.includes('CADEvolve: Creating Realistic CAD via Program Evolution'));
  assert.ok(titles.includes('RankEvolve: Automating the Discovery of Retrieval Algorithms via LLM-Driven Evolution'));
  assert.ok(!titles.includes('FactorMiner: A Self-Evolving Agent with Skills and Experience Memory for Financial Alpha Discovery'));
});
