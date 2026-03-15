#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyDailyCuration,
  buildDailyCurationPrompt,
  fallbackCurateSelection,
  shouldRejectModelCuration
} = require('../scripts/research-intel/lib/curation');

test('buildDailyCurationPrompt encodes taxonomy, anchors, and strict json requirement', () => {
  const prompt = buildDailyCurationPrompt({
    dateString: '2026-03-14',
    profile: {
      currentGoal: ['持续跟踪 self-evolving agents 的方法演化。'],
      readingPreference: ['当前仍以积累方法组件为主。'],
      methodTreeNotes: '先问它为什么超过强 code agent baseline，再问具体机制。',
      seeds: [{ title: 'ShinkaEvolve' }],
      feedback: [
        {
          title: 'Prefer minimal necessary structure',
          liked: true,
          notes: '优先明确说明最小必要结构的论文。'
        }
      ]
    },
    taxonomy: [
      {
        id: 'static-agents-limit',
        title: '为什么静态 Agent 不够',
        question: '为什么 agent 还是静态脚本？',
        keywords: ['self-evolving agents']
      }
    ],
    papers: [
      {
        title: 'Towards AGI A Pragmatic Approach Towards Self Evolving Agent',
        matchedKeywords: ['self-evolving agents'],
        relatedSeeds: [{ title: 'ShinkaEvolve' }],
        paperCard: {
          summary_anchor: 'LLM agents 部署后仍然是静态的。',
          core_problem: ['LLM agents 部署后仍然是静态的。'],
          method_tags: ['self-evolving agents']
        },
        webCoverage: {
          codeRepos: [],
          chineseBlogs: [],
          coverage: [{ title: 'HF papers', url: 'https://huggingface.co/papers/2601.11658' }]
        }
      }
    ]
  });

  assert.match(prompt, /只返回一个 JSON 对象/);
  assert.match(prompt, /static-agents-limit/);
  assert.match(prompt, /ShinkaEvolve/);
  assert.match(prompt, /本地固定路线/);
  assert.match(prompt, /你不要重新排序/);
  assert.match(prompt, /只输出 \{\"overview\":\"\.\.\.\",\"route_logic\":\"\.\.\.\"\}/);
  assert.match(prompt, /阅读偏好/);
  assert.match(prompt, /长期账本维护备注/);
  assert.match(prompt, /Prefer minimal necessary structure/);
});

test('fallbackCurateSelection produces non-template reading route and branch assignments', () => {
  const curation = fallbackCurateSelection({
    dateString: '2026-03-14',
    taxonomy: [
      {
        id: 'static-agents-limit',
        title: '为什么静态 Agent 不够',
        question: '为什么现有 agent 还是静态脚本？',
        keywords: ['self-evolving agents', 'self-improving agents', 'framework']
      },
      {
        id: 'open-endedness-diagnostics',
        title: '如何判断开放式演化真的发生了',
        question: '如何度量 open-endedness？',
        keywords: ['open-ended evolution', 'characterizing', 'metric', 'undecidability']
      },
      {
        id: 'transfer-and-application',
        title: '这些方法如何迁移到具体任务',
        question: '这些方法迁移到真实任务会发生什么？',
        keywords: ['retrieval', 'application', 'ranking']
      }
    ],
    papers: [
      {
        title: 'RankEvolve: Automating the Discovery of Retrieval Algorithms via LLM-Driven Evolution',
        matchedKeywords: ['program evolution'],
        paperCard: {
          summary_anchor: '把演化式搜索用于 retrieval algorithm discovery。',
          core_problem: ['如何把 evolutionary search 用到 retrieval 自动发现。'],
          method_tags: ['retrieval', 'program evolution']
        },
        relatedSeeds: [{ title: 'ShinkaEvolve' }],
        webCoverage: {
          codeRepos: [],
          chineseBlogs: [],
          coverage: [{ title: 'alphaXiv', url: 'https://www.alphaxiv.org/overview/2602.16932v1' }]
        }
      },
      {
        title: 'Towards AGI A Pragmatic Approach Towards Self Evolving Agent',
        matchedKeywords: ['self-evolving agents', 'self-improving agents'],
        paperCard: {
          summary_anchor: 'LLM agents 部署后仍然是静态的，缺少持续自我改进能力。',
          core_problem: ['LLM agents 部署后仍然是静态的，缺少持续自我改进能力。'],
          method_tags: ['self-evolving agents']
        },
        relatedSeeds: [{ title: 'Group-Evolving Agents' }, { title: 'ShinkaEvolve' }],
        webCoverage: {
          codeRepos: [],
          chineseBlogs: [],
          coverage: [
            { title: 'ResearchTrend', url: 'https://www.researchtrend.ai/papers/2601.11658' },
            { title: 'HF papers', url: 'https://huggingface.co/papers/2601.11658' }
          ]
        }
      },
      {
        title: 'Characterizing Open-Ended Evolution Through Undecidability Mechanisms in Random Boolean Networks',
        matchedKeywords: ['open-ended evolution'],
        paperCard: {
          summary_anchor: '我们缺少能够诊断 open-ended evolution 是否真的发生的统一指标。',
          core_problem: ['我们缺少能够诊断 open-ended evolution 是否真的发生的统一指标。'],
          method_tags: ['open-ended evolution', 'metric']
        },
        relatedSeeds: [{ title: 'Darwin Godel Machine' }],
        webCoverage: {
          codeRepos: [{ full_name: 'amahury/OEE-metric', html_url: 'https://github.com/amahury/OEE-metric' }],
          chineseBlogs: [],
          coverage: [{ title: 'Complexity Digest', url: 'https://www.comdig.org/blog/example' }]
        }
      }
    ]
  });

  assert.equal(curation.papers.length, 3);
  assert.equal(curation.papers[0].title, 'Towards AGI A Pragmatic Approach Towards Self Evolving Agent');
  assert.equal(curation.papers[0].branch_id, 'static-agents-limit');
  assert.equal(curation.papers[1].branch_id, 'open-endedness-diagnostics');
  assert.equal(curation.papers[2].branch_id, 'transfer-and-application');
  assert.match(curation.papers[0].why_today, /静态|主线/);
  assert.match(curation.papers[1].reading_reason, /怎么判断|度量|验证/);
  assert.match(curation.papers[2].reading_reason, /具体任务|落地|最后看/);
  assert.equal(/命中关键词/.test(curation.papers[0].why_today), false);
});

test('fallbackCurateSelection prefers method-first branches over generic application branches', () => {
  const curation = fallbackCurateSelection({
    dateString: '2026-03-15',
    taxonomy: [
      {
        id: 'minimal-necessary-structure',
        title: '超出强 Code Agent baseline 的最小必要结构',
        question: '相比强 code agent baseline，加什么结构才必要？',
        keywords: ['verifier loop', 'memory archive', 'code agent']
      },
      {
        id: 'automated-discovery-hard-science',
        title: '这些方法能否撑住 hard scientific tasks',
        question: '这些方法到了 hard scientific tasks 还成立吗？',
        keywords: ['automated discovery', 'scientific discovery']
      }
    ],
    papers: [
      {
        title: 'A Verifier-Guided Memory Archive Beyond Strong Code Agents',
        matchedKeywords: ['self-improving agents'],
        matchedSignals: ['verifier loop', 'memory archive', 'strong code agent baseline'],
        relatedSeeds: [{ title: 'Darwin Godel Machine' }, { title: 'Group-Evolving Agents' }],
        paperCard: {
          summary_anchor: '相比强 code agent baseline，本文只增加 verifier loop 和 memory archive。',
          core_problem: ['相比强 code agent baseline，到底哪些额外结构是必要的？'],
          method_tags: ['verifier loop', 'memory archive']
        },
        webCoverage: {
          codeRepos: [{ full_name: 'demo/verifier-archive', html_url: 'https://github.com/demo/verifier-archive' }],
          chineseBlogs: [],
          coverage: []
        }
      },
      {
        title: 'SciencePilot: Automated Discovery for Biology Workflows',
        matchedKeywords: ['automated discovery'],
        matchedSignals: [],
        relatedSeeds: [{ title: 'EvoX' }],
        paperCard: {
          summary_anchor: '把 agent 用在 biology workflow。',
          core_problem: ['把 agent 用在 biology workflow。'],
          method_tags: ['automated discovery']
        },
        webCoverage: {
          codeRepos: [],
          chineseBlogs: [],
          coverage: [{ title: 'blog', url: 'https://example.com' }]
        }
      }
    ]
  });

  assert.equal(curation.papers[0].title, 'A Verifier-Guided Memory Archive Beyond Strong Code Agents');
  assert.match(curation.papers[0].why_today, /baseline|必要/);
  assert.match(curation.papers[1].reading_reason, /落地|最后看|外延/);
});

test('applyDailyCuration reorders papers and attaches enriched fields', () => {
  const curated = applyDailyCuration(
    [
      { title: 'B paper', reasonWhyToday: 'old', readingReason: 'old' },
      { title: 'A paper', reasonWhyToday: 'old', readingReason: 'old' }
    ],
    {
      papers: [
        {
          title: 'A paper',
          branch_id: 'alpha',
          motivation_summary: 'A motive',
          method_takeaway: 'A method',
          why_today: 'A why',
          reading_stage: '先看',
          reading_reason: 'A reason'
        },
        {
          title: 'B paper',
          branch_id: 'beta',
          motivation_summary: 'B motive',
          method_takeaway: 'B method',
          why_today: 'B why',
          reading_stage: '第二篇接着看',
          reading_reason: 'B reason'
        }
      ]
    },
    []
  );

  assert.equal(curated[0].title, 'A paper');
  assert.equal(curated[0].motivationSummary, 'A motive');
  assert.equal(curated[1].readingStage, '第二篇接着看');
});

test('shouldRejectModelCuration rejects routes that lead with diagnostics while direct method papers exist', () => {
  const taxonomy = [
    {
      id: 'static-agents-limit',
      title: '为什么静态 Agent 不够'
    },
    {
      id: 'open-endedness-diagnostics',
      title: '如何判断开放式演化真的发生了'
    }
  ];

  const papers = [
    {
      title: 'Towards AGI A Pragmatic Approach Towards Self Evolving Agent',
      branchId: 'static-agents-limit',
      paperCard: {
        core_problem: ['LLM agents 部署后仍然是静态的。'],
        method_tags: ['self-evolving agents']
      }
    },
    {
      title: 'Characterizing Open-Ended Evolution Through Undecidability Mechanisms in Random Boolean Networks',
      branchId: 'open-endedness-diagnostics',
      paperCard: {
        core_problem: ['我们缺少统一的 open-endedness 诊断指标。'],
        method_tags: ['metric']
      }
    }
  ];

  const reject = shouldRejectModelCuration({
    papers,
    taxonomy,
    curation: {
      overview: '先从一般系统论出发。',
      route_logic: '先看诊断，再看 agent 主线。',
      papers: [
        {
          title: 'Characterizing Open-Ended Evolution Through Undecidability Mechanisms in Random Boolean Networks',
          branch_id: 'open-endedness-diagnostics',
          why_today: '它解释如何度量开放性。',
          reading_reason: '先从诊断讲起。'
        },
        {
          title: 'Towards AGI A Pragmatic Approach Towards Self Evolving Agent',
          branch_id: 'static-agents-limit',
          why_today: '它提出一个 agent 框架。',
          reading_reason: '后面再看实现。'
        }
      ]
    }
  });

  const accept = shouldRejectModelCuration({
    papers,
    taxonomy,
    curation: {
      overview: '先钉住静态 agent 为什么不够，再补诊断。',
      route_logic: '先看 agent 主线，再补 open-endedness 量化。',
      papers: [
        {
          title: 'Towards AGI A Pragmatic Approach Towards Self Evolving Agent',
          branch_id: 'static-agents-limit',
          why_today: '它直接回答为什么静态 agent 不够。',
          reading_reason: '先把主问题钉住。'
        },
        {
          title: 'Characterizing Open-Ended Evolution Through Undecidability Mechanisms in Random Boolean Networks',
          branch_id: 'open-endedness-diagnostics',
          why_today: '它补开放性诊断。',
          reading_reason: '第二篇补度量。'
        }
      ]
    }
  });

  assert.equal(reject, true);
  assert.equal(accept, false);
});
