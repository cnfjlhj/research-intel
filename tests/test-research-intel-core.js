#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseResearchBrief,
  dedupePapers,
  scorePaper,
  selectPapers
} = require('../scripts/research-intel/lib/core');
const {
  buildPaperhash
} = require('../scripts/research-intel/lib/openreview');

const SAMPLE_BRIEF = `---
timezone: Asia/Shanghai
send_time: "06:00"
min_papers: 3
target_papers: 5
max_papers: 8
---

# Research Brief

## Current Goal
- 持续跟踪 self-evolving agents、self-improving agents 和 automated discovery 的最新方法
- 当前重点是积累方法，不是先找落地产品

## Focus Keywords
- self-evolving agents
- self-improving agents
- recursive self-improvement
- open-ended evolution
- automated discovery
- scientific discovery
- program evolution

## Positive Signals
- meta-evolution
- experience sharing
- recursive agent improvement
- sample efficiency

## Negative Signals
- pure survey
- pure application without new method

## Reading Preference
- 优先积累方法组件，而不是产品化案例
- 推荐理由要说明这篇论文补的是哪块方法拼图
`;

test('parseResearchBrief extracts frontmatter and bullet sections', () => {
  const profile = parseResearchBrief(SAMPLE_BRIEF);
  assert.equal(profile.timezone, 'Asia/Shanghai');
  assert.equal(profile.sendTime, '06:00');
  assert.equal(profile.minPapers, 3);
  assert.equal(profile.targetPapers, 5);
  assert.equal(profile.maxPapers, 8);
  assert.ok(profile.focusKeywords.includes('self-evolving agents'));
  assert.ok(profile.positiveSignals.includes('sample efficiency'));
  assert.ok(profile.negativeSignals.includes('pure survey'));
  assert.ok(profile.readingPreference.includes('优先积累方法组件，而不是产品化案例'));
});

test('parseResearchBrief handles CRLF line endings without dropping bullet sections', () => {
  const profile = parseResearchBrief(SAMPLE_BRIEF.replace(/\n/g, '\r\n'));
  assert.ok(profile.focusKeywords.includes('self-evolving agents'));
  assert.ok(profile.positiveSignals.includes('experience sharing'));
  assert.ok(profile.readingPreference.includes('优先积累方法组件，而不是产品化案例'));
});

test('dedupePapers collapses arxiv version duplicates and near-identical titles', () => {
  const papers = [
    { title: 'ShinkaEvolve: Towards Open-Ended And Sample-Efficient Program Evolution', arxivId: '2509.19349v1' },
    { title: 'ShinkaEvolve: Towards Open-Ended and Sample-Efficient Program Evolution', arxivId: '2509.19349v2' },
    { title: 'EvoX: Meta-Evolution for Automated Discovery', arxivId: '2602.23413v1' }
  ];

  const deduped = dedupePapers(papers);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].arxivId, '2509.19349v1');
});

test('scorePaper rewards freshness and keyword matches while penalizing already-read titles', () => {
  const profile = parseResearchBrief(SAMPLE_BRIEF);
  profile.readTitles = new Set([
    'darwin godel machine open ended evolution of self improving agents'
  ]);

  const freshRelevant = {
    title: 'Recursive Self-Improvement for Self-Evolving Agents',
    summary: 'We study recursive self-improvement and open-ended evolution for agents.',
    published: '2026-03-10T00:00:00Z'
  };

  const alreadyRead = {
    title: 'Darwin Godel Machine: Open-Ended Evolution of Self-Improving Agents',
    summary: 'Open-ended evolution of self-improving agents.',
    published: '2026-03-12T00:00:00Z'
  };

  const now = new Date('2026-03-13T00:00:00Z');
  const freshScore = scorePaper(freshRelevant, profile, now).score;
  const readScore = scorePaper(alreadyRead, profile, now).score;

  assert.ok(freshScore > readScore);
  assert.ok(readScore < 0);
});

test('scorePaper matches singular-plural variants of focus keywords before falling back to seed overlap', () => {
  const profile = parseResearchBrief(SAMPLE_BRIEF);
  profile.seeds = [
    { title: 'Darwin Godel Machine: Open-Ended Evolution of Self-Improving Agents' }
  ];

  const paper = {
    title: 'Trajectory-Informed Memory Generation for Self-Improving Agent Systems',
    summary: 'A memory framework for self-improving agent systems with trajectory-aware retrieval.',
    published: '2026-03-13T00:00:00Z'
  };

  const scored = scorePaper(paper, profile, new Date('2026-03-14T00:00:00Z'));
  assert.ok(scored.matchedKeywords.includes('self-improving agents'));
  assert.ok(scored.reasons.includes('keyword_match'));
});

test('selectPapers returns highest scoring unread papers first', () => {
  const profile = parseResearchBrief(SAMPLE_BRIEF);
  profile.readTitles = new Set([
    'godel agent a self referential agent framework for recursive self improvement'
  ]);

  const candidates = [
    {
      title: 'Verifier-Guided Memory Archive for Self-Evolving Agents',
      summary: 'A verifier-guided memory archive with retry policies for self-evolving agents.',
      published: '2026-03-12T00:00:00Z'
    },
    {
      title: 'Graph Compression for Vision Tokens',
      summary: 'An unrelated computer vision paper.',
      published: '2026-03-12T00:00:00Z'
    },
    {
      title: 'Gödel Agent: A Self-Referential Agent Framework for Recursive Self-Improvement',
      summary: 'A self-referential agent framework.',
      published: '2026-03-12T00:00:00Z'
    }
  ];

  const selected = selectPapers(candidates, profile, new Date('2026-03-13T00:00:00Z'));
  assert.equal(selected[0].title, 'Verifier-Guided Memory Archive for Self-Evolving Agents');
  assert.equal(selected.length, 1);
});

test('selectPapers filters out papers that only match overly generic keywords', () => {
  const profile = parseResearchBrief(SAMPLE_BRIEF);
  profile.focusKeywords.push('agent framework');

  const candidates = [
    {
      title: 'CogSearch: A Cognitive-Aligned Multi-Agent Framework for Proactive Decision Support in E-Commerce Search',
      summary: 'A multi-agent framework for e-commerce search and decision support.',
      published: '2026-03-12T00:00:00Z'
    },
    {
      title: 'Program Evolution for Recursive Self-Improvement',
      summary: 'We study recursive self-improvement with explicit program evolution and verifier-guided search.',
      published: '2026-03-12T00:00:00Z'
    }
  ];

  const selected = selectPapers(candidates, profile, new Date('2026-03-13T00:00:00Z'));
  assert.equal(selected.length, 1);
  assert.equal(selected[0].title, 'Program Evolution for Recursive Self-Improvement');
});

test('selectPapers rejects broad discovery papers that still lack direct method hooks after seed matching', () => {
  const profile = parseResearchBrief(SAMPLE_BRIEF);
  profile.seeds = [
    { title: 'Gödel Agent: A Self-Referential Agent Framework for Recursive Self-Improvement' },
    { title: 'Darwin Godel Machine: Open-Ended Evolution of Self-Improving Agents' },
    { title: 'Group-Evolving Agents: Open-Ended Self-Improvement via Experience Sharing' },
    { title: 'EvoX: Meta-Evolution for Automated Discovery' }
  ];

  const candidates = [
    {
      title: 'EvoScientist: Towards Multi-Agent Evolving AI Scientists for End-to-End Scientific Discovery',
      summary: 'We build evolving AI scientists for end-to-end scientific discovery with adaptive multi-agent coordination.',
      published: '2026-03-12T00:00:00Z'
    },
    {
      title: 'Learning Adaptive Force Control for Contact-Rich Sample Scraping with Heterogeneous Materials',
      summary: 'The increasing demand for accelerated scientific discovery highlights the need for advanced AI-driven robotics.',
      published: '2026-03-12T00:00:00Z'
    }
  ];

  const selected = selectPapers(candidates, profile, new Date('2026-03-13T00:00:00Z'));
  assert.deepEqual(selected, []);
});

test('selectPapers does not admit papers based on weak one-token seed overlap alone', () => {
  const profile = parseResearchBrief(SAMPLE_BRIEF);
  profile.seeds = [
    { title: 'Darwin Godel Machine: Open-Ended Evolution of Self-Improving Agents' },
    { title: 'EvoX: Meta-Evolution for Automated Discovery' }
  ];

  const candidates = [
    {
      title: 'Trajectory-Informed Memory Generation for Self-Improving Agent Systems',
      summary: 'Memory generation can improve self-improving agent systems through trajectory summaries.',
      published: '2026-03-13T00:00:00Z'
    },
    {
      title: 'Kinetic SIS opinion-driven models with asymmetric awareness feedback: macroscopic limit and polarization',
      summary: 'We study a kinetic SIS model with awareness feedback and polarization dynamics.',
      published: '2026-03-13T00:00:00Z'
    }
  ];

  const selected = selectPapers(candidates, profile, new Date('2026-03-14T00:00:00Z'));
  assert.deepEqual(
    selected.map(item => item.title),
    ['Trajectory-Informed Memory Generation for Self-Improving Agent Systems']
  );
});

test('selectPapers keeps explicitly imported seeds even when topic overlap is thin', () => {
  const profile = parseResearchBrief(SAMPLE_BRIEF);
  profile.seeds = [
    {
      title: 'Mechanistic Protein Search with Reflective Verifiers',
      arxivId: '2603.12345',
      directImport: true,
      status: 'queued',
      notes: '用户明确要求直接导入并生成单篇结果'
    }
  ];

  const candidates = [
    {
      title: 'Mechanistic Protein Search with Reflective Verifiers',
      arxivId: '2603.12345',
      summary: 'We study reflective verifiers for protein search with automated experiment planning.',
      published: '2026-03-13T00:00:00Z'
    }
  ];

  const selected = selectPapers(candidates, profile, new Date('2026-03-14T00:00:00Z'));
  assert.equal(selected.length, 1);
  assert.equal(selected[0].title, 'Mechanistic Protein Search with Reflective Verifiers');
  assert.ok(selected[0].reasons.includes('direct_import'));
});

test('scorePaper strongly downweights vertical application papers when method evidence is thin', () => {
  const profile = parseResearchBrief(SAMPLE_BRIEF);
  profile.seeds = [
    { title: 'Group-Evolving Agents: Open-Ended Self-Improvement via Experience Sharing' },
    { title: 'ShinkaEvolve: Towards Open-Ended and Sample-Efficient Program Evolution' }
  ];
  profile.positiveSignals.push('retrieval algorithm', 'evolutionary search');

  const applied = scorePaper({
    title: 'FactorMiner: A Self-Evolving Agent with Skills and Experience Memory for Financial Alpha Discovery',
    summary: 'A self-evolving agent for financial alpha discovery.',
    published: '2026-02-16T00:00:00Z'
  }, profile, new Date('2026-03-14T00:00:00Z'));

  const method = scorePaper({
    title: 'RankEvolve: Automating the Discovery of Retrieval Algorithms via LLM-Driven Evolution',
    summary: 'LLM-driven evolution with retrieval algorithm discovery and evolutionary search.',
    published: '2026-02-18T00:00:00Z'
  }, profile, new Date('2026-03-14T00:00:00Z'));

  assert.ok(applied.reasons.includes('applied_domain'));
  assert.ok(method.reasons.includes('positive_signal'));
  assert.ok(applied.score < method.score);
});

test('scorePaper rejects adjacent open-ended diagnostics papers that never connect back to actionable agent methods', () => {
  const profile = parseResearchBrief(SAMPLE_BRIEF);
  profile.methodTaxonomy = [
    {
      id: 'open-endedness-diagnostics',
      title: '如何判断系统真的在持续进化',
      keywords: ['open-ended evolution', 'metric', 'characterizing', 'systems thinking']
    }
  ];

  const adjacentTheory = scorePaper({
    title: 'Characterizing Open-Ended Evolution Through Undecidability Mechanisms in Random Boolean Networks',
    summary: 'Systems biology still lacks substrate-agnostic diagnostics for open-ended evolution, so we study random Boolean networks and attractor dynamics.',
    published: '2026-03-12T00:00:00Z'
  }, profile, new Date('2026-03-14T00:00:00Z'));

  assert.ok(adjacentTheory.reasons.includes('diagnostic_without_actionable_method') || adjacentTheory.reasons.includes('abstract_systems_framing'));
  assert.equal(adjacentTheory.selectionBand, 'reject');
});

test('scorePaper downweights broad diagnostic theory papers when they do not connect back to agent methods', () => {
  const profile = parseResearchBrief(SAMPLE_BRIEF);
  profile.seeds = [
    { title: 'Darwin Godel Machine: Open-Ended Evolution of Self-Improving Agents' },
    { title: 'ShinkaEvolve: Towards Open-Ended and Sample-Efficient Program Evolution' }
  ];
  profile.methodTaxonomy = [
    {
      id: 'open-endedness-diagnostics',
      title: '如何判断开放式演化真的发生了',
      keywords: ['open-ended evolution', 'metric', 'diagnostic', 'characterizing', 'systems thinking']
    }
  ];

  const theoryOnly = scorePaper({
    title: 'Evolutionary Systems Thinking -- From Equilibrium Models to Open-Ended Adaptive Dynamics',
    summary: 'This paper argues for evolutionary systems thinking in economics and policy modeling, emphasizing non-equilibrium adaptive dynamics.',
    categories: ['q-bio.PE', 'econ.TH'],
    published: '2026-02-17T00:00:00Z'
  }, profile, new Date('2026-03-14T00:00:00Z'));

  const diagnosticMethod = scorePaper({
    title: 'Characterizing Open-Ended Evolution Through Undecidability Mechanisms in Random Boolean Networks',
    summary: 'We introduce a model-independent metric and benchmark-oriented diagnostic for sustained novelty, with experimental comparisons across mechanisms.',
    categories: ['q-bio.PE'],
    published: '2025-12-17T00:00:00Z'
  }, profile, new Date('2026-03-14T00:00:00Z'));

  assert.ok(theoryOnly.reasons.includes('thin_diagnostic_theory'));
  assert.ok(diagnosticMethod.score > theoryOnly.score);
  assert.equal(theoryOnly.selectionBand, 'reject');
});

test('scorePaper uses liked feedback records as an extra preference signal', () => {
  const profile = parseResearchBrief(SAMPLE_BRIEF);
  profile.feedback = [
    {
      title: 'Prefer minimal necessary structure',
      liked: true,
      status: 'read',
      notes: 'Prefer papers that justify minimal scaffolding, verifier loop, and memory archive beyond a strong code agent baseline.'
    }
  ];

  const aligned = scorePaper({
    title: 'Verifier-Guided Memory Archive for Self-Improving Agents',
    summary: 'We study verifier-guided memory archive scaffolding beyond a strong code agent baseline.',
    published: '2026-03-12T00:00:00Z'
  }, profile, new Date('2026-03-14T00:00:00Z'));

  assert.ok(aligned.reasons.includes('feedback_match'));
  assert.ok(aligned.matchedFeedback.includes('Prefer minimal necessary structure'));
});

test('scorePaper rejects papers that only inherit generic seed and feedback alignment without direct method hooks', () => {
  const profile = parseResearchBrief(SAMPLE_BRIEF);
  profile.seeds = [
    {
      title: 'ShinkaEvolve: Towards Open-Ended and Sample-Efficient Program Evolution',
      notes: 'Prefer minimal necessary structure beyond a strong code agent baseline.'
    }
  ];
  profile.feedback = [
    {
      title: 'Strong code agent baseline first',
      liked: true,
      status: 'read',
      notes: 'Prefer papers that justify extra structure beyond a strong code agent baseline on hard scientific tasks.'
    }
  ];

  const adjacentInfrastructurePaper = scorePaper({
    title: 'GUI-GENESIS: Automated Synthesis of Efficient Environments with Verifiable Rewards for GUI Agent Post-Training',
    summary: 'We use code generation to build efficient GUI environments with verifiable rewards for agent post-training.',
    published: '2026-03-14T00:00:00Z'
  }, profile, new Date('2026-03-15T00:00:00Z'));

  assert.ok(adjacentInfrastructurePaper.reasons.includes('indirect_alignment_only'));
  assert.equal(adjacentInfrastructurePaper.selectionBand, 'reject');
  assert.equal(adjacentInfrastructurePaper.directMethodEvidence, false);
});

test('scorePaper does not promote a paper from a lone generic taxonomy token match', () => {
  const profile = parseResearchBrief(SAMPLE_BRIEF);
  profile.methodTaxonomy = [
    {
      id: 'what-evolves',
      title: '到底让什么东西在演化',
      keywords: ['context', 'architecture', 'tool use']
    }
  ];

  const genericContextPaper = scorePaper({
    title: 'Context Compression for Adaptive Agents',
    summary: 'We study context compression for adaptive agents in long-horizon settings.',
    published: '2026-03-14T00:00:00Z'
  }, profile, new Date('2026-03-15T00:00:00Z'));

  assert.equal(genericContextPaper.branchFitScore, 0);
  assert.equal(genericContextPaper.directMethodEvidence, false);
  assert.ok(!genericContextPaper.reasons.includes('branch_fit'));
});

test('scorePaper does not promote broad search-policy papers without self-improving method evidence', () => {
  const profile = parseResearchBrief(SAMPLE_BRIEF);
  profile.positiveSignals.push('search policy', 'inter-task learning');
  profile.methodTaxonomy = [
    {
      id: 'what-evolves',
      title: '到底让什么东西在演化',
      keywords: ['search policy', 'inter-task learning']
    }
  ];

  const searchPolicyPaper = scorePaper({
    title: 'Aligning Tree-Search Policies with Fixed Token Budgets in Test-Time Scaling of LLMs',
    summary: 'We optimize tree-search policies under fixed token budgets for general LLM inference.',
    published: '2026-03-14T00:00:00Z'
  }, profile, new Date('2026-03-15T00:00:00Z'));

  assert.equal(searchPolicyPaper.selectionBand, 'reject');
  assert.equal(searchPolicyPaper.directMethodEvidence, false);
  assert.ok(!searchPolicyPaper.reasons.includes('branch_fit'));
  assert.ok(!searchPolicyPaper.reasons.includes('positive_signal'));
});

test('scorePaper does not treat generic memory-archive papers as direct method evidence without evolution context', () => {
  const profile = parseResearchBrief(SAMPLE_BRIEF);
  profile.positiveSignals.push('memory archive');
  profile.methodTaxonomy = [
    {
      id: 'experience-accumulation',
      title: '如何让经验被持续积累',
      keywords: ['memory archive', 'verifier loop']
    }
  ];

  const socioTechnicalPaper = scorePaper({
    title: 'Designing the Interactive Memory Archive for AI-Mediated Cultural Memory Preservation',
    summary: 'We study an interactive memory archive for reminiscence, cultural memory, and museum storytelling.',
    published: '2026-03-14T00:00:00Z'
  }, profile, new Date('2026-03-15T00:00:00Z'));

  assert.equal(socioTechnicalPaper.selectionBand, 'reject');
  assert.equal(socioTechnicalPaper.directMethodEvidence, false);
});

test('scorePaper does not treat generic agent-and-benchmark wording as actionable method evidence', () => {
  const profile = parseResearchBrief(SAMPLE_BRIEF);

  const genericAgentPaper = scorePaper({
    title: 'Adaptive Agents with Benchmark Improvements',
    summary: 'We study adaptive agents and report benchmark improvements on evaluation suites.',
    published: '2026-03-14T00:00:00Z'
  }, profile, new Date('2026-03-15T00:00:00Z'));

  assert.equal(genericAgentPaper.directMethodEvidence, false);
  assert.equal(genericAgentPaper.selectionBand, 'reject');
});

test('scorePaper rejects security-adjacent self-evolving papers that only match weak theme phrases', () => {
  const profile = parseResearchBrief(SAMPLE_BRIEF);
  profile.focusKeywords.push('long-term memory');
  profile.positiveSignals.push('long-term memory');
  profile.methodTaxonomy = [
    {
      id: 'what-evolves',
      title: '到底让什么东西在演化',
      keywords: ['tool use', 'memory archive', 'search policy']
    }
  ];

  const securityAdjacentPaper = scorePaper({
    title: 'Zombie Agents: Persistent Control of Self-Evolving LLM Agents via Self-Reinforcing Injections',
    summary: 'Self-evolving LLM agents write and reuse long-term memory across sessions. We study a persistent attack where poisoned web content survives memory updates and later triggers unauthorized tool behavior.',
    published: '2026-03-14T00:00:00Z'
  }, profile, new Date('2026-03-15T00:00:00Z'));

  assert.equal(securityAdjacentPaper.directMethodEvidence, false);
  assert.equal(securityAdjacentPaper.selectionBand, 'reject');
});

test('scorePaper does not let sample-efficiency alone promote an unrelated application paper', () => {
  const profile = parseResearchBrief(SAMPLE_BRIEF);

  const applicationPaper = scorePaper({
    title: 'Adaptive RAN Slicing Control via Reward-Free Self-Finetuning Agents',
    summary: 'We improve sample efficiency for telecom control with reward-free self-finetuning agents in a domain-specific deployment setting.',
    published: '2026-03-14T00:00:00Z'
  }, profile, new Date('2026-03-15T00:00:00Z'));

  assert.equal(applicationPaper.directMethodEvidence, false);
  assert.equal(applicationPaper.selectionBand, 'reject');
});

test('scorePaper rejects taxonomy-style memory overviews that only overlap on broad theme phrases', () => {
  const profile = parseResearchBrief(SAMPLE_BRIEF);
  profile.focusKeywords.push('long-term memory');
  profile.positiveSignals.push('long-term memory');

  const surveyLikePaper = scorePaper({
    title: 'Graph-based Agent Memory: Taxonomy, Techniques, and Applications',
    summary: 'We present a taxonomy of graph-based agent memory techniques, long-term memory designs, and applications for self-evolving agents.',
    published: '2026-03-14T00:00:00Z'
  }, profile, new Date('2026-03-15T00:00:00Z'));

  assert.ok(surveyLikePaper.reasons.includes('survey_style'));
  assert.equal(surveyLikePaper.selectionBand, 'reject');
});

test('scorePaper does not match multiword method phrases when their tokens are scattered across the sentence', () => {
  const profile = parseResearchBrief(SAMPLE_BRIEF);
  profile.positiveSignals.push('code agent');

  const scatteredTokensPaper = scorePaper({
    title: 'GUI Agent Post-Training via Code Generation',
    summary: 'We use code generation to build efficient GUI environments for agent post-training.',
    published: '2026-03-14T00:00:00Z'
  }, profile, new Date('2026-03-15T00:00:00Z'));

  assert.equal(scatteredTokensPaper.matchedSignals.includes('code agent'), false);
});

test('scorePaper marks broad fresh papers with thin method evidence as reject band', () => {
  const profile = parseResearchBrief(SAMPLE_BRIEF);
  profile.seeds = [
    { title: 'Group-Evolving Agents: Open-Ended Self-Improvement via Experience Sharing' }
  ];
  profile.methodTaxonomy = [
    {
      id: 'experience-accumulation',
      title: '如何让经验被持续积累',
      keywords: ['experience sharing', 'memory archive']
    }
  ];

  const broadPaper = scorePaper({
    title: 'Automated Discovery Agents for Broad Scientific Workflows',
    summary: 'A broad automated discovery story with fresh agents, but little concrete method detail.',
    published: '2026-03-14T00:00:00Z'
  }, profile, new Date('2026-03-15T00:00:00Z'));

  const methodPaper = scorePaper({
    title: 'Verifier-Guided Memory Archive for Group-Evolving Agents',
    summary: 'We introduce verifier-guided memory archive updates and experience sharing for group-evolving agents.',
    published: '2026-03-14T00:00:00Z'
  }, profile, new Date('2026-03-15T00:00:00Z'));

  assert.equal(broadPaper.selectionBand, 'reject');
  assert.equal(methodPaper.selectionBand, 'strong');
  assert.ok(broadPaper.reasons.includes('thin_method_evidence'));
  assert.ok(methodPaper.reasons.includes('branch_fit'));
});

test('scorePaper can downweight papers that match archived negative feedback preferences', () => {
  const profile = parseResearchBrief(SAMPLE_BRIEF);
  profile.feedback = [
    {
      title: 'Avoid coding benchmark only gains',
      liked: false,
      status: 'archived',
      notes: 'Downweight papers that only report coding benchmark gains without scientific task justification.'
    }
  ];

  const benchmarkOnly = scorePaper({
    title: 'A Framework for Coding Benchmark Gains in Self-Improving Agents',
    summary: 'We improve coding benchmark results for self-improving agents without broader scientific task evidence.',
    published: '2026-03-12T00:00:00Z'
  }, profile, new Date('2026-03-14T00:00:00Z'));

  assert.ok(benchmarkOnly.reasons.includes('feedback_avoid'));
  assert.ok(benchmarkOnly.avoidedFeedback.includes('Avoid coding benchmark only gains'));
});

test('scorePaper rejects abstract systems framing when it lacks actionable diagnostic or agent method evidence', () => {
  const profile = parseResearchBrief(SAMPLE_BRIEF);
  profile.seeds = [
    { title: 'Darwin Godel Machine: Open-Ended Evolution of Self-Improving Agents' },
    { title: 'ShinkaEvolve: Towards Open-Ended and Sample-Efficient Program Evolution' }
  ];
  profile.methodTaxonomy = [
    {
      id: 'static-agents-limit',
      title: '为什么静态 Agent 不够',
      keywords: ['self-evolving agents', 'self-improving agents', 'recursive self-improvement']
    },
    {
      id: 'open-endedness-diagnostics',
      title: '如何判断系统真的在持续进化',
      keywords: ['open-ended evolution', 'metric', 'diagnostic', 'undecidability', 'characterizing', 'systems thinking']
    }
  ];

  const abstractSystemsPaper = scorePaper({
    title: 'Evolutionary Systems Thinking -- From Equilibrium Models to Open-Ended Adaptive Dynamics',
    summary: 'Complex change is often described as evolutionary in economics, policy, and technology, yet most system dynamics models remain constrained to fixed state spaces and equilibrium-seeking behavior.',
    published: '2026-02-17T00:00:00Z',
    categories: ['q-bio.PE', 'cs.NE', 'econ.TH']
  }, profile, new Date('2026-03-14T00:00:00Z'));

  const diagnosticMetricPaper = scorePaper({
    title: 'Characterizing Open-Ended Evolution Through Undecidability Mechanisms in Random Boolean Networks',
    summary: 'We introduce a model-independent metric that quantifies open-ended evolution through attractor cycle statistics and evaluate it on random Boolean networks.',
    published: '2026-02-17T00:00:00Z',
    categories: ['q-bio.PE']
  }, profile, new Date('2026-03-14T00:00:00Z'));

  assert.equal(abstractSystemsPaper.selectionBand, 'reject');
  assert.ok(
    abstractSystemsPaper.reasons.includes('thin_method_evidence')
      || abstractSystemsPaper.reasons.includes('diagnostic_without_actionable_method')
  );
  assert.notEqual(diagnosticMetricPaper.selectionBand, 'reject');
  assert.ok(diagnosticMetricPaper.score > abstractSystemsPaper.score);
});

test('buildPaperhash follows first-author-surname and normalized-title format', () => {
  const paperhash = buildPaperhash(
    'ShinkaEvolve: Towards Open-Ended and Sample-Efficient Program Evolution',
    ['Robert Tjarko Lange', 'Yuki Imajuku']
  );
  assert.equal(
    paperhash,
    'lange|shinkaevolve_towards_openended_and_sampleefficient_program_evolution'
  );
});
