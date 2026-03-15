#!/usr/bin/env node

const { normalizeTitle } = require('./core');

function slugifyId(text) {
  return normalizeTitle(text).replace(/\s+/g, '-');
}

function uniqueStrings(items) {
  return [...new Set(
    (items || [])
      .map(item => String(item || '').trim())
      .filter(Boolean)
  )];
}

function createEmptyMethodTree({ rootTitle = 'Self-Evolving Agents' } = {}) {
  return {
    version: 1,
    updatedAt: null,
    rootTitle,
    summary: [],
    branches: []
  };
}

function cloneTree(tree) {
  return JSON.parse(JSON.stringify(tree || createEmptyMethodTree()));
}

function normalizePhrase(text) {
  return normalizeTitle(text).replace(/\s+/g, ' ').trim();
}

function containsChinese(text) {
  return /[\u4e00-\u9fff]/.test(String(text || ''));
}

function cleanupDetailText(text) {
  return String(text || '')
    .replace(/\\textbf\{([^}]*)\}/g, '$1')
    .replace(/\\emph\{([^}]*)\}/g, '$1')
    .replace(/\\[a-zA-Z]+\{([^}]*)\}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNearDuplicateDetail(candidate, references = []) {
  const normalizedCandidate = normalizePhrase(candidate);
  if (!normalizedCandidate) {
    return true;
  }

  return references.some(reference => {
    const normalizedReference = normalizePhrase(reference);
    if (!normalizedReference) {
      return false;
    }
    return normalizedCandidate === normalizedReference
      || normalizedCandidate.includes(normalizedReference)
      || normalizedReference.includes(normalizedCandidate);
  });
}

function shouldKeepLedgerSummary(text, references = []) {
  const cleaned = cleanupDetailText(text);
  if (!cleaned || !containsChinese(cleaned)) {
    return false;
  }
  if (cleaned.length > 96) {
    return false;
  }
  return !isNearDuplicateDetail(cleaned, references);
}

function shouldKeepLedgerClaim(text, references = []) {
  const cleaned = cleanupDetailText(text);
  if (!cleaned) {
    return false;
  }

  const hasQuantSignal = /\d|%/.test(cleaned);
  if (!containsChinese(cleaned) && !hasQuantSignal) {
    return false;
  }
  if (!hasQuantSignal && cleaned.length > 120) {
    return false;
  }

  return !isNearDuplicateDetail(cleaned, references);
}

function buildDefaultMethodTaxonomy(profile = {}) {
  return [
    {
      id: 'static-agents-limit',
      title: '为什么静态 Agent 不够',
      question: '为什么现有 agent 还是静态脚本，缺少持续自我改进能力？',
      keywords: ['self-evolving agents', 'self-improving agents', 'recursive self-improvement', 'agent framework', 'godel']
    },
    {
      id: 'experience-accumulation',
      title: '如何让经验被持续积累',
      question: '如何让经验、记忆和群体协作真正形成长期积累，而不是一次性试错？',
      keywords: ['experience sharing', 'group evolution', 'memory', 'archive', 'teacher', 'curriculum']
    },
    {
      id: 'efficient-evolution',
      title: '如何让演化更高效',
      question: '如何提高搜索效率、样本效率和可迁移性，让自进化不只是昂贵试错？',
      keywords: ['sample efficiency', 'program evolution', 'evolutionary search', 'retrieval', 'ranking', 'optimization']
    },
    {
      id: 'open-endedness-diagnostics',
      title: '如何判断开放式演化真的发生了',
      question: '如何度量、诊断和解释 open-endedness，而不是只靠直觉说系统在进化？',
      keywords: ['open-ended evolution', 'metric', 'characterizing', 'undecidability', 'benchmark', 'diagnostic', 'systems thinking']
    },
    {
      id: 'automated-discovery',
      title: '如何把自进化用于自动发现',
      question: '如何把 evolutionary search / self-improvement 变成真实的自动发现系统？',
      keywords: ['automated discovery', 'meta-evolution', 'scientific discovery', 'retrieval algorithms', 'discovery']
    },
    {
      id: 'transfer-and-application',
      title: '这些方法如何迁移到具体任务',
      question: '这些自进化方法一旦离开主线 benchmark，迁到真实任务时会发生什么？',
      keywords: ['cad', 'core war', 'kernel', 'application', 'design exploration', 'financial']
    },
    {
      id: 'emerging-signals',
      title: '暂时还放不稳的位置',
      question: '这篇论文和主线有关，但还没有稳定归宿，先挂在这里观察。',
      keywords: []
    }
  ];
}

function resolveMethodTaxonomy(profile = {}) {
  const legacyIds = new Set([
    'group-evolution',
    'recursive-self-improvement',
    'open-ended-evolution',
    'meta-evolution-automated-discovery',
    'program-evolution'
  ]);
  const configured = (profile.methodTaxonomy || [])
    .filter(branch => branch && branch.id && branch.title)
    .map(branch => ({
      id: String(branch.id),
      title: String(branch.title),
      question: String(branch.question || ''),
      keywords: uniqueStrings(branch.keywords || [])
    }));

  if (
    configured.length >= 5
    && configured.every(branch => legacyIds.has(branch.id))
  ) {
    return buildDefaultMethodTaxonomy(profile).map((branch, index) => ({
      ...branch,
      order: index
    }));
  }

  if (configured.length === 0) {
    return buildDefaultMethodTaxonomy(profile).map((branch, index) => ({
      ...branch,
      order: index
    }));
  }

  if (!configured.some(branch => branch.id === 'emerging-signals')) {
    configured.push({
      id: 'emerging-signals',
      title: '暂时还放不稳的位置',
      question: '这篇论文和主线有关，但还没有稳定归宿，先挂在这里观察。',
      keywords: []
    });
  }

  return configured.map((branch, index) => ({
    ...branch,
    order: index
  }));
}

function buildPaperLeaf({ paper, anchor = false, dateString = '', rootDir = '' }) {
  const paperCard = paper.paperCard || {};
  const methodTags = uniqueStrings([
    ...(paperCard.method_tags || []),
    ...(paper.matchedKeywords || []),
    ...(paper.matchedSignals || [])
  ]);
  const detailReferences = [
    paper.title,
    paper.summary,
    paper.notes,
    paper.reasonWhyToday,
    paper.motivationSummary,
    paper.methodTakeaway
  ];
  const detailCandidates = [];

  if (anchor && paper.notes) {
    detailCandidates.push(`锚点说明：${cleanupDetailText(paper.notes)}`);
  }
  if (!anchor && paper.reasonWhyToday) {
    detailCandidates.push(`今日理由：${cleanupDetailText(paper.reasonWhyToday)}`);
  }
  if (paper.motivationSummary) {
    detailCandidates.push(`研究动机：${cleanupDetailText(paper.motivationSummary)}`);
  }
  if (paper.methodTakeaway) {
    detailCandidates.push(`方法切口：${cleanupDetailText(paper.methodTakeaway)}`);
  }
  if (shouldKeepLedgerSummary(paperCard.summary_anchor, detailReferences)) {
    detailCandidates.push(`概览：${cleanupDetailText(paperCard.summary_anchor)}`);
  }

  for (const claim of paperCard.main_claims || []) {
    if (!shouldKeepLedgerClaim(claim, [...detailReferences, paperCard.summary_anchor])) {
      continue;
    }
    detailCandidates.push(`结论：${cleanupDetailText(claim)}`);
  }

  detailCandidates.push(...(methodTags || []).slice(0, 2).map(item => `方法标签：${item}`));

  if ((paperCard.external_links?.code || []).length > 0) {
    detailCandidates.push('开源：有代码仓库');
  }
  if ((paperCard.external_links?.blogs || []).length > 0) {
    detailCandidates.push(`中文材料：${paperCard.external_links.blogs.length} 条`);
  }
  if ((paperCard.external_links?.coverage || []).length > 0) {
    detailCandidates.push(`外部报道：${paperCard.external_links.coverage.length} 条`);
  }

  detailCandidates.push(...(paperCard.open_questions || []).slice(0, 1).map(item => `开放问题：${cleanupDetailText(item)}`));

  const details = uniqueStrings(detailCandidates).slice(0, 6);

  const htmlPath = paper.htmlPath || '';
  const paperCardPath = paper.paperCardPath || '';

  return {
    id: paperCard.paper_id || `paper:${slugifyId(paper.title)}`,
    title: paper.title,
    anchor,
    status: paper.status || (anchor ? 'read' : 'selected'),
    liked: Boolean(paper.liked),
    firstSeen: paper.firstSeen || dateString || '',
    lastSeen: dateString || paper.lastSeen || '',
    branchId: paper.branchId || '',
    summary: paperCard.summary_anchor || paper.reasonWhyToday || paper.notes || '',
    details,
    methodTags,
    relatedSeeds: uniqueStrings((paper.relatedSeeds || []).map(seed => seed.title)),
    htmlPath,
    paperCardPath,
    notes: paper.notes || '',
    rootDir
  };
}

function buildTextBlob(paper) {
  const paperCard = paper.paperCard || {};
  return normalizePhrase([
    paper.branchId,
    paper.motivationSummary,
    paper.methodTakeaway,
    paper.title,
    paper.summary,
    paper.notes,
    paper.reasonWhyToday,
    ...(paper.matchedKeywords || []),
    ...(paper.matchedSignals || []),
    ...(paperCard.method_tags || []),
    ...(paperCard.main_claims || []),
    paperCard.summary_anchor
  ].filter(Boolean).join(' '));
}

function scoreBranch(paper, branch) {
  if (paper.branchId && String(paper.branchId) === String(branch.id)) {
    return 10_000;
  }

  const blob = buildTextBlob(paper);
  if (!blob) {
    return branch.id === 'emerging-signals' ? 1 : 0;
  }

  let score = 0;
  for (const keyword of branch.keywords || []) {
    const needle = normalizePhrase(keyword);
    if (needle && blob.includes(needle)) {
      score += Math.max(1, needle.split(' ').length);
    }
  }

  if (score === 0 && branch.id === 'emerging-signals') {
    return 1;
  }
  return score;
}

function pickBranchIdForPaper(paper, taxonomy) {
  const scored = taxonomy
    .map(branch => ({ branch, score: scoreBranch(paper, branch) }))
    .sort((left, right) => right.score - left.score || left.branch.title.localeCompare(right.branch.title));

  const winner = scored[0];
  return winner ? winner.branch.id : 'emerging-signals';
}

function ensureBranch(tree, template, dateString) {
  let branch = tree.branches.find(item => item.id === template.id);
  if (!branch) {
    branch = {
      id: template.id,
      title: template.title,
      question: template.question || '',
      order: template.order ?? 0,
      keywords: uniqueStrings(template.keywords || []),
      firstSeen: dateString,
      lastSeen: dateString,
      sharedConcepts: [],
      papers: []
    };
    tree.branches.push(branch);
    return branch;
  }

  branch.title = template.title;
  branch.question = template.question || branch.question || '';
  branch.order = template.order ?? branch.order ?? 0;
  branch.keywords = uniqueStrings([...(branch.keywords || []), ...(template.keywords || [])]);
  branch.lastSeen = dateString;
  return branch;
}

function upsertPaperLeaf(branch, paperLeaf, dateString) {
  const key = normalizeTitle(paperLeaf.title);
  const existing = branch.papers.find(item => normalizeTitle(item.title) === key);

  if (existing) {
    existing.anchor = existing.anchor || paperLeaf.anchor;
    existing.status = paperLeaf.status || existing.status;
    existing.liked = existing.liked || paperLeaf.liked;
    existing.lastSeen = dateString;
    existing.summary = paperLeaf.summary || existing.summary;
    existing.details = uniqueStrings([...(existing.details || []), ...(paperLeaf.details || [])]).slice(0, 6);
    existing.methodTags = uniqueStrings([...(existing.methodTags || []), ...(paperLeaf.methodTags || [])]);
    existing.relatedSeeds = uniqueStrings([...(existing.relatedSeeds || []), ...(paperLeaf.relatedSeeds || [])]);
    existing.htmlPath = paperLeaf.htmlPath || existing.htmlPath;
    existing.paperCardPath = paperLeaf.paperCardPath || existing.paperCardPath;
    existing.notes = paperLeaf.notes || existing.notes;
    return existing;
  }

  branch.papers.push({
    ...paperLeaf,
    firstSeen: paperLeaf.firstSeen || dateString,
    lastSeen: dateString
  });
  return paperLeaf;
}

function refreshSharedConcepts(branch) {
  const counts = new Map();
  for (const paper of branch.papers || []) {
    for (const phrase of uniqueStrings([
      ...(paper.methodTags || [])
    ])) {
      const normalized = normalizePhrase(phrase);
      if (!normalized) {
        continue;
      }
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }
  }

  const concepts = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 4)
    .map(([phrase]) => `常见切口：${phrase}`);

  if (concepts.length === 0) {
    branch.sharedConcepts = uniqueStrings((branch.keywords || []).slice(0, 2).map(item => `常见切口：${item}`));
    return;
  }

  branch.sharedConcepts = concepts;
}

function sortBranches(branches) {
  return [...branches].sort((left, right) => {
    const orderDiff = Number(left.order ?? 0) - Number(right.order ?? 0);
    if (orderDiff !== 0) {
      return orderDiff;
    }
    const leftPaperCount = (left.papers || []).length;
    const rightPaperCount = (right.papers || []).length;
    return rightPaperCount - leftPaperCount || left.title.localeCompare(right.title);
  });
}

function sortPapers(papers) {
  return [...papers].sort((left, right) => {
    if (left.anchor !== right.anchor) {
      return left.anchor ? -1 : 1;
    }
    return left.title.localeCompare(right.title);
  });
}

function updateMethodTree({ tree, profile, selectedPapers, dateString }) {
  const next = cloneTree(tree || createEmptyMethodTree({ rootTitle: profile.rootTitle || 'Self-Evolving Agents' }));
  const taxonomy = resolveMethodTaxonomy(profile);
  next.version = Math.max(1, Number(next.version || 1));
  next.rootTitle = profile.rootTitle || next.rootTitle || 'Self-Evolving Agents';
  next.updatedAt = dateString;
  next.summary = uniqueStrings([
    ...(profile.currentGoal || []).slice(0, 2),
    '按研究动机组织；每条分支先回答“为什么要做”，再挂具体论文与方法切口。'
  ]);

  for (const branch of taxonomy) {
    ensureBranch(next, branch, dateString);
  }

  for (const seed of profile.seeds || []) {
    const branchId = pickBranchIdForPaper(seed, taxonomy);
    const branchTemplate = taxonomy.find(item => item.id === branchId) || taxonomy[taxonomy.length - 1];
    const branch = ensureBranch(next, branchTemplate, dateString);
    const leaf = buildPaperLeaf({
      paper: seed,
      anchor: true,
      dateString
    });
    upsertPaperLeaf(branch, leaf, dateString);
  }

  for (const paper of selectedPapers || []) {
    const branchId = pickBranchIdForPaper(paper, taxonomy);
    const branchTemplate = taxonomy.find(item => item.id === branchId) || taxonomy[taxonomy.length - 1];
    const branch = ensureBranch(next, branchTemplate, dateString);
    const leaf = buildPaperLeaf({
      paper,
      anchor: false,
      dateString
    });
    upsertPaperLeaf(branch, leaf, dateString);
  }

  next.branches = sortBranches(
    next.branches.filter(branch => (branch.papers || []).length > 0)
  ).map(branch => {
    const normalizedBranch = {
      ...branch,
      papers: sortPapers(branch.papers || [])
    };
    refreshSharedConcepts(normalizedBranch);
    return normalizedBranch;
  });

  return next;
}

function rebuildMethodTree({ profile, runs = [], defaultDateString = '' }) {
  const sortedRuns = [...runs].sort((left, right) => String(left.dateString || '').localeCompare(String(right.dateString || '')));
  let tree = createEmptyMethodTree({ rootTitle: profile.rootTitle || 'Self-Evolving Agents' });

  if (sortedRuns.length === 0) {
    return updateMethodTree({
      tree,
      profile,
      selectedPapers: [],
      dateString: defaultDateString
    });
  }

  for (const run of sortedRuns) {
    tree = updateMethodTree({
      tree,
      profile,
      selectedPapers: run.selectedPapers || [],
      dateString: run.dateString || defaultDateString
    });
  }

  return tree;
}

function renderMethodTreeMarkdown(tree) {
  const lines = [
    `# ${tree.rootTitle || 'Self-Evolving Agents'}`,
    '',
    `- 更新时间：${tree.updatedAt || 'unknown'}`,
    '- 组织原则：按研究动机组织，先回答问题缺口，再挂具体论文与方法切口。',
    ''
  ];

  for (const summary of tree.summary || []) {
    lines.push(`- ${summary}`);
  }

  lines.push('');

  for (const branch of tree.branches || []) {
    lines.push(`## ${branch.title}`);
    if (branch.question) {
      lines.push(`- 这个分支在回答：${branch.question}`);
    }

    for (const concept of branch.sharedConcepts || []) {
      lines.push(`- ${concept}`);
    }

    for (const paper of branch.papers || []) {
      lines.push(`- 论文：${paper.title}`);
      if (paper.anchor) {
        lines.push('  - 角色：锚点 / 已读');
      } else {
        lines.push(`  - 角色：${paper.status || 'selected'}`);
      }
      for (const detail of paper.details || []) {
        lines.push(`  - ${detail}`);
      }
      if (paper.htmlPath || paper.paperCardPath) {
        const links = [];
        if (paper.htmlPath) {
          links.push(`[HTML](${paper.htmlPath})`);
        }
        if (paper.paperCardPath) {
          links.push(`[Paper Card](${paper.paperCardPath})`);
        }
        lines.push(`  - 详情入口：${links.join('；')}`);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

function buildMethodTreeDelta(previousTree, nextTree) {
  const previousBranches = new Map((previousTree?.branches || []).map(branch => [branch.id, branch]));
  const nextBranches = new Map((nextTree?.branches || []).map(branch => [branch.id, branch]));

  const addedBranches = [...nextBranches.values()]
    .filter(branch => !previousBranches.has(branch.id))
    .map(branch => ({ id: branch.id, title: branch.title }));

  const addedPapers = [];
  const addedSharedConcepts = [];

  for (const [branchId, nextBranch] of nextBranches.entries()) {
    const previousBranch = previousBranches.get(branchId);
    const previousPaperTitles = new Set((previousBranch?.papers || []).map(paper => normalizeTitle(paper.title)));
    for (const paper of nextBranch.papers || []) {
      if (!previousPaperTitles.has(normalizeTitle(paper.title))) {
        addedPapers.push({
          branchId,
          branchTitle: nextBranch.title,
          title: paper.title
        });
      }
    }

    const previousConcepts = new Set(uniqueStrings(previousBranch?.sharedConcepts || []).map(normalizePhrase));
    for (const concept of nextBranch.sharedConcepts || []) {
      const normalized = normalizePhrase(concept);
      if (!previousConcepts.has(normalized)) {
        addedSharedConcepts.push({
          branchId,
          branchTitle: nextBranch.title,
          concept
        });
      }
    }
  }

  return {
    addedBranches,
    addedPapers,
    addedSharedConcepts,
    summary: `新增方法分支 ${addedBranches.length}，新增论文 ${addedPapers.length}，新增共享线索 ${addedSharedConcepts.length}`
  };
}

module.exports = {
  buildPaperLeaf,
  buildMethodTreeDelta,
  createEmptyMethodTree,
  renderMethodTreeMarkdown,
  rebuildMethodTree,
  resolveMethodTaxonomy,
  updateMethodTree
};
