#!/usr/bin/env node

const { normalizeTitle } = require('./core');
const { generateTextWithFallbacks } = require('./chat-html');

const DEFAULT_ROUTE_OVERVIEW = '今天的阅读路线先钉住主问题，再看关键机制，最后补评测、迁移或外延场景。';
const BRANCH_PRIORITY = new Map([
  ['static-agents-limit', 0],
  ['minimal-necessary-structure', 1],
  ['what-evolves', 2],
  ['experience-accumulation', 3],
  ['feedback-and-search', 4],
  ['open-endedness-diagnostics', 5],
  ['automated-discovery-hard-science', 6]
]);

function uniqueStrings(items) {
  return [...new Set(
    (items || [])
      .map(item => String(item || '').trim())
      .filter(Boolean)
  )];
}

function clipText(text, maxLength = 120) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) {
    return '';
  }
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1).trim()}…`;
}

function sentenceSplit(text, limit = 3) {
  return String(text || '')
    .split(/(?<=[。！？.!?])\s+|\n+/)
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function firstUsefulText(candidates, maxLength = 120) {
  for (const candidate of candidates || []) {
    const clipped = clipText(candidate, maxLength);
    if (clipped) {
      return clipped;
    }
  }
  return '';
}

function classifyRole(paper) {
  const blob = normalizeTitle([
    paper.title,
    paper.summary,
    paper.reasonWhyToday,
    paper.motivationSummary,
    paper.methodTakeaway,
    ...(paper.matchedKeywords || []),
    ...(paper.matchedSignals || []),
    ...(paper.paperCard?.method_tags || []),
    ...(paper.paperCard?.core_problem || [])
  ].filter(Boolean).join(' '));

  if (/(self evolving|self improving|recursive self improvement|agent framework|godel|teacher llm|hierarchical)/.test(blob)) {
    return 'foundation';
  }
  if (/(experience sharing|group evolution|memory|curriculum|reward based|genetic algorithm|program evolution)/.test(blob)) {
    return 'mechanism';
  }
  if (/(characterizing|metric|benchmark|diagnostic|undecidability|systems thinking|analysis|measure)/.test(blob)) {
    return 'diagnostic';
  }
  if (/(retrieval|cad|core war|kernel|finance|ranking|application|design exploration)/.test(blob)) {
    return 'application';
  }
  return 'adjacent';
}

function rolePriority(role) {
  if (role === 'foundation') {
    return 0;
  }
  if (role === 'mechanism') {
    return 1;
  }
  if (role === 'diagnostic') {
    return 2;
  }
  if (role === 'application') {
    return 3;
  }
  return 4;
}

function branchPriority(branchId) {
  return BRANCH_PRIORITY.has(String(branchId || ''))
    ? BRANCH_PRIORITY.get(String(branchId || ''))
    : 20;
}

function branchLookup(taxonomy = []) {
  return new Map((taxonomy || []).map(branch => [String(branch.id), branch]));
}

function scoreBranchFromText(paper, branch) {
  const titleAndNotes = normalizeTitle([
    paper.title,
    paper.summary,
    paper.motivationSummary,
    paper.methodTakeaway,
    ...(paper.paperCard?.core_problem || []),
    ...(paper.paperCard?.method_tags || []),
    ...(paper.matchedKeywords || []),
    ...(paper.matchedSignals || [])
  ].filter(Boolean).join(' '));

  let score = 0;
  for (const keyword of branch.keywords || []) {
    const needle = normalizeTitle(keyword);
    if (!needle) {
      continue;
    }
    if (titleAndNotes.includes(needle)) {
      score += Math.max(1, needle.split(' ').length);
    }
  }

  if (branch.question && titleAndNotes.includes(normalizeTitle(branch.question))) {
    score += 3;
  }

  return score;
}

function pickBranchId(paper, taxonomy = []) {
  const allowedIds = new Set((taxonomy || []).map(branch => String(branch.id)));
  if (paper.branchId && allowedIds.has(String(paper.branchId))) {
    return String(paper.branchId);
  }

  const scored = (taxonomy || [])
    .map(branch => ({ branch, score: scoreBranchFromText(paper, branch) }))
    .sort((left, right) => right.score - left.score);

  if (scored[0]?.score > 0) {
    return scored[0].branch.id;
  }

  return String(taxonomy[0]?.id || 'core-line');
}

function summarizeProblem(paper, branch) {
  return firstUsefulText([
    paper.motivationSummary,
    ...(paper.paperCard?.core_problem || []).filter(item => item && !/命中关键词/.test(item)),
    paper.paperCard?.summary_anchor,
    paper.summary,
    branch?.question
  ], 110);
}

function summarizeMethod(paper) {
  const methodTags = uniqueStrings([
    ...(paper.paperCard?.method_tags || []),
    ...(paper.matchedKeywords || []),
    ...(paper.matchedSignals || [])
  ]).slice(0, 3);

  if (paper.methodTakeaway) {
    return clipText(paper.methodTakeaway, 90);
  }
  if (methodTags.length > 0) {
    return `主要切口是 ${methodTags.join('、')}`;
  }
  const claim = firstUsefulText(paper.paperCard?.main_claims || [], 90);
  if (claim) {
    return `关键收获是 ${claim}`;
  }
  return '';
}

function summarizeEvidence(paper) {
  const parts = [];
  const anchorTitles = (paper.relatedSeeds || []).map(seed => seed.title).slice(0, 2);
  if (anchorTitles.length > 0) {
    parts.push(`和 ${anchorTitles.join('、')} 这条已读主线能直接串起来`);
  }

  const codeCount = (paper.webCoverage?.codeRepos || []).length;
  const blogCount = (paper.webCoverage?.chineseBlogs || []).length;
  const coverageCount = (paper.webCoverage?.coverage || []).length;
  if (codeCount > 0) {
    parts.push(`已有 ${codeCount} 个代码线索`);
  }
  if (blogCount > 0) {
    parts.push(`抓到了 ${blogCount} 篇中文长文`);
  }
  if (coverageCount > 0) {
    parts.push(`外部讨论入口有 ${coverageCount} 条`);
  }

  if (paper.paperCard?.availability?.has_openreview) {
    parts.push('还能顺手看 OpenReview 讨论');
  }

  return parts.slice(0, 3);
}

function buildWhyToday(paper, branch) {
  const problem = summarizeProblem(paper, branch);
  const method = summarizeMethod(paper);
  const evidence = summarizeEvidence(paper);
  const parts = [];

  if (branch?.question) {
    parts.push(`它对应你当前主线里“${branch.question}”这条问题。`);
  }
  if (problem) {
    parts.push(`具体看，这篇在追问“${problem}”。`);
  }
  if (method) {
    parts.push(`${method}。`);
  }
  if (evidence.length > 0) {
    parts.push(`而且 ${evidence.join('，')}。`);
  }

  return parts.join(' ');
}

function stageLabel(index, role) {
  if (index === 0) {
    return '先看';
  }
  if (index === 1) {
    return role === 'mechanism' ? '第二篇接着看' : '第二篇再看';
  }
  if (index === 2) {
    return role === 'diagnostic' ? '第三篇再补' : '第三篇继续看';
  }
  return '后面再看';
}

function isApplicationLikePaper(paper, branch) {
  const blob = normalizeTitle([
    branch?.title,
    branch?.question,
    paper.title,
    paper.summary,
    paper.motivationSummary,
    paper.methodTakeaway,
    ...(paper.paperCard?.core_problem || []),
    ...(paper.paperCard?.method_tags || [])
  ].filter(Boolean).join(' '));

  return /(application|workflow|task|scenario|scene|retrieval|biology|scientific|discovery|ranking|finance|cad|kernel)/.test(blob);
}

function buildReadingReason(paper, orderedPapers, index, branch) {
  const role = paper.readingRole || classifyRole(paper);
  const lead = stageLabel(index, role);
  const previous = orderedPapers[index - 1];
  const problem = summarizeProblem(paper, branch);
  const method = summarizeMethod(paper);
  const applicationLike = isApplicationLikePaper(paper, branch);

  if (index === 0) {
    return `${lead}，用它先把今天最核心的问题钉住；后面的论文都围绕这条主线展开。`;
  }

  if (role === 'application' || applicationLike) {
    return `${lead}，因为前面主线已经立住了，这篇更像外延验证，适合最后看它如何把方法迁到具体任务或场景。`;
  }

  if (role === 'mechanism') {
    return `${lead}，因为前一篇把问题抛出来了，这篇更适合把实现机制拆开看${method ? `，重点抓 ${method}` : ''}。`;
  }

  if (role === 'diagnostic') {
    return `${lead}，因为前面已经看了框架或机制，这篇补的是“怎么判断它是否真的成立/持续演化”这一层${problem ? `，也就是 ${problem}` : ''}。`;
  }

  return `${lead}，它和${previous ? `《${previous.title}》` : '前面的主线'}保持邻接，但提供了另一种补充视角${problem ? `，重点是 ${problem}` : ''}。`;
}

function buildFallbackOverview(orderedPapers, lookup) {
  const branches = orderedPapers.map(paper => lookup.get(paper.branchId)).filter(Boolean);
  const primaryBranch = branches[0] || null;
  const secondaryBranches = uniqueStrings(branches.slice(1).map(branch => branch.title)).filter(title => title !== primaryBranch?.title);
  if (!primaryBranch) {
    return '今天这组论文先围绕用户当前最接近的主线问题排顺序，再补必要的旁支。';
  }
  if (secondaryBranches.length === 0) {
    return `今天这组论文主要围绕“${primaryBranch.title}”这一支展开，先把主问题钉住，再逐步补机制、诊断或外延验证。`;
  }
  return `今天先围绕“${primaryBranch.title}”做主线推进，再补 ${secondaryBranches.slice(0, 2).join('、')} 这两条侧翼材料；不强行把它们写成一条假的单线故事。`;
}

function buildFallbackRouteLogic(orderedPapers, lookup) {
  if (orderedPapers.length === 0) {
    return DEFAULT_ROUTE_OVERVIEW;
  }

  const steps = orderedPapers.map((paper, index) => {
    const branch = lookup.get(paper.branchId);
    const role = paper.readingRole || classifyRole(paper);
    const branchLabel = branch?.title || paper.branchId || '当前分支';
    if (index === 0) {
      return `先用《${paper.title}》把“${branchLabel}”这条主问题钉住`;
    }
    if (role === 'mechanism') {
      return `再用《${paper.title}》拆开关键机制`;
    }
    if (role === 'diagnostic') {
      return `随后用《${paper.title}》补诊断与判据`;
    }
    if (role === 'application') {
      return `最后用《${paper.title}》看方法如何落到具体任务`;
    }
    return `再用《${paper.title}》补一块邻接视角`;
  });

  return `${steps.join('；')}。`;
}

function fallbackCurateSelection({ papers, taxonomy = [], dateString }) {
  const lookup = branchLookup(taxonomy);
  const enriched = (papers || []).map(paper => {
    const branchId = pickBranchId(paper, taxonomy);
    const branch = lookup.get(branchId);
    return {
      ...paper,
      branchId,
      readingRole: classifyRole(paper),
      motivationSummary: paper.motivationSummary || summarizeProblem(paper, branch),
      methodTakeaway: paper.methodTakeaway || summarizeMethod(paper)
    };
  });

  const ordered = [...enriched].sort((left, right) => {
    const branchDiff = branchPriority(left.branchId) - branchPriority(right.branchId);
    if (branchDiff !== 0) {
      return branchDiff;
    }
    const roleDiff = rolePriority(left.readingRole) - rolePriority(right.readingRole);
    if (roleDiff !== 0) {
      return roleDiff;
    }
    const leftSeedCount = (left.relatedSeeds || []).length;
    const rightSeedCount = (right.relatedSeeds || []).length;
    if (leftSeedCount !== rightSeedCount) {
      return rightSeedCount - leftSeedCount;
    }
    return normalizeTitle(left.title).localeCompare(normalizeTitle(right.title));
  });

  const curatedPapers = ordered.map((paper, index) => {
    const branch = lookup.get(paper.branchId);
    return {
      title: paper.title,
      branch_id: paper.branchId,
      motivation_summary: paper.motivationSummary || summarizeProblem(paper, branch),
      method_takeaway: paper.methodTakeaway || summarizeMethod(paper),
      why_today: buildWhyToday(paper, branch),
      reading_stage: stageLabel(index, paper.readingRole),
      reading_reason: buildReadingReason(paper, ordered, index, branch)
    };
  });

  return {
    source: 'fallback',
    overview: buildFallbackOverview(ordered, lookup),
    route_logic: buildFallbackRouteLogic(ordered, lookup),
    papers: curatedPapers,
    date: dateString
  };
}

function sanitizeModelPayload(payload, papers, taxonomy = [], dateString) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.papers)) {
    return null;
  }

  const paperIndex = new Map((papers || []).map(paper => [normalizeTitle(paper.title), paper]));
  const allowedBranchIds = new Set((taxonomy || []).map(branch => String(branch.id)));
  const cleaned = [];

  for (const item of payload.papers) {
    const title = String(item?.title || '').trim();
    const key = normalizeTitle(title);
    if (!title || !paperIndex.has(key)) {
      continue;
    }

    const branchId = String(item.branch_id || '').trim();
    cleaned.push({
      title,
      branch_id: allowedBranchIds.has(branchId) ? branchId : pickBranchId(paperIndex.get(key), taxonomy),
      motivation_summary: clipText(item.motivation_summary || item.motivationSummary || '', 160),
      method_takeaway: clipText(item.method_takeaway || item.methodTakeaway || '', 160),
      why_today: clipText(item.why_today || item.whyToday || '', 280),
      reading_stage: clipText(item.reading_stage || item.readingStage || '', 40),
      reading_reason: clipText(item.reading_reason || item.readingReason || '', 280)
    });
  }

  if (cleaned.length !== (papers || []).length) {
    return null;
  }

  return {
    source: 'model',
    overview: clipText(payload.overview || '', 220),
    route_logic: clipText(payload.route_logic || payload.routeLogic || '', 220),
    papers: cleaned,
    date: dateString
  };
}

function shouldRejectModelCuration({ papers, taxonomy = [], curation }) {
  if (!curation || !Array.isArray(curation.papers) || curation.papers.length !== (papers || []).length) {
    return true;
  }

  const paperIndex = new Map((papers || []).map(paper => [normalizeTitle(paper.title), paper]));
  const lookup = branchLookup(taxonomy);
  const ordered = (curation.papers || []).map(item => {
    const paper = paperIndex.get(normalizeTitle(item.title));
    if (!paper) {
      return null;
    }
    const branchId = item.branch_id || paper.branchId || pickBranchId(paper, taxonomy);
    return {
      ...paper,
      branchId,
      branch: lookup.get(branchId),
      readingRole: classifyRole({
        ...paper,
        branchId
      })
    };
  }).filter(Boolean);

  if (ordered.length !== (papers || []).length) {
    return true;
  }

  const laterMethodPaperExists = ordered.slice(1).some(paper => {
    const role = paper.readingRole;
    return role === 'foundation' || role === 'mechanism';
  });

  if (!laterMethodPaperExists) {
    return false;
  }

  const firstRole = ordered[0].readingRole;
  return firstRole === 'diagnostic' || firstRole === 'application';
}

function cleanJsonResponse(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    return '';
  }
  return raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function extractJsonObject(text) {
  const cleaned = cleanJsonResponse(text);
  if (!cleaned) {
    return null;
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return null;
    }
    try {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }
}

function buildDailyCurationPrompt({ dateString, profile, taxonomy = [], papers = [] }) {
  const plannedCuration = fallbackCurateSelection({
    papers,
    taxonomy,
    dateString
  });
  const likedFeedback = (profile.feedback || [])
    .filter(item => item?.liked)
    .slice(0, 6)
    .map(item => ({
      title: item.title,
      notes: clipText(item.notes, 100)
    }));
  const avoidedFeedback = (profile.feedback || [])
    .filter(item => !item?.liked && item?.status === 'archived')
    .slice(0, 4)
    .map(item => ({
      title: item.title,
      notes: clipText(item.notes, 100)
    }));
  const branchMap = branchLookup(taxonomy);
  const serializedPapers = plannedCuration.papers.map((plannedPaper, index) => {
    const paper = (papers || []).find(item => normalizeTitle(item.title) === normalizeTitle(plannedPaper.title)) || {};
    const branch = branchMap.get(plannedPaper.branch_id);
    return {
      route_slot: index + 1,
      title: paper.title,
      published: paper.published,
      planned_stage: plannedPaper.reading_stage,
      planned_branch_id: plannedPaper.branch_id,
      planned_branch_title: branch?.title || plannedPaper.branch_id,
      planned_branch_question: branch?.question || '',
      planned_why_today: plannedPaper.why_today,
      planned_reading_reason: plannedPaper.reading_reason,
      score: paper.score || 0,
      branch_fit_score: paper.branchFitScore || 0,
      matched_keywords: paper.matchedKeywords || [],
      matched_signals: paper.matchedSignals || [],
      matched_feedback: paper.matchedFeedback || [],
      avoided_feedback: paper.avoidedFeedback || [],
      related_seeds: (paper.relatedSeeds || []).map(seed => seed.title),
      selection_reasons: paper.reasons || [],
      summary_anchor: paper.paperCard?.summary_anchor || '',
      core_problem: paper.paperCard?.core_problem || [],
      method_tags: paper.paperCard?.method_tags || [],
      main_claims: paper.paperCard?.main_claims || [],
      has_code: Boolean((paper.webCoverage?.codeRepos || []).length),
      chinese_blog_count: (paper.webCoverage?.chineseBlogs || []).length,
      coverage_count: (paper.webCoverage?.coverage || []).length,
      openreview_summary: clipText(paper.openreviewSummary || paper.paperCard?.openreview_summary || '', 160)
    };
  });

  return [
    `你是 Research Intelligence 的论文情报总编，正在给 ${dateString} 这一天的论文推送做最后一轮策展。`,
    '本地规划器已经根据用户的长期研究账本，固定了今天每篇论文的顺序、分支和角色。',
    '你不要重新排序，也不要改写每篇论文的职责；你只需要补出更好的 overview 和 route_logic。',
    '请只返回一个 JSON 对象，不要输出 Markdown，不要解释。',
    '',
    '约束：',
    '- 用中文。',
    '- 只输出 {"overview":"...","route_logic":"..."} 这两个字段。',
    '- 不要虚构“完美闭环”，如果今天其实是 1 条主线 + 若干侧翼材料，就明确写出来。',
    '- route_logic 必须忠实解释为什么固定顺序是合理的，不能把不自然的论文硬串成哲学故事。',
    '- 不要写“命中关键词/与锚点相关/作为基石”这种偷懒话。',
    '- overview 要总结今天补的是哪几块方法拼图，而不是空泛说“完整闭环”。',
    '',
    '输出 JSON schema：',
    '{"overview":"...","route_logic":"..."}',
    '',
    `用户当前主线：${(profile.currentGoal || []).join('；') || '持续跟踪 self-evolving agents 的最新方法论文'}`,
    `阅读偏好：${(profile.readingPreference || []).join('；') || '优先最新方法论文，并明确说明为什么今天该看。'}`,
    `锚点论文：${(profile.seeds || []).map(seed => seed.title).join('；') || '暂无'}`,
    `用户显式偏好：${JSON.stringify(likedFeedback, null, 2)}`,
    `用户显式降权：${JSON.stringify(avoidedFeedback, null, 2)}`,
    `长期账本维护备注：${clipText(profile.methodTreeNotes || '', 320) || '暂无'}`,
    `taxonomy：${JSON.stringify((taxonomy || []).map(branch => ({ id: branch.id, title: branch.title, question: branch.question || '', keywords: branch.keywords || [] })), null, 2)}`,
    `本地固定路线：${JSON.stringify(plannedCuration.papers.map(item => ({ title: item.title, branch_id: item.branch_id, reading_stage: item.reading_stage })), null, 2)}`,
    `papers：${JSON.stringify(serializedPapers, null, 2)}`
  ].join('\n');
}

async function curateDailySelection({
  papers,
  profile,
  taxonomy,
  dateString,
  apiBaseUrl = '',
  apiKey = '',
  models = [],
  rateLimiter = null,
  timeoutMs = 60000
}) {
  const fallback = fallbackCurateSelection({
    papers,
    taxonomy,
    dateString
  });

  if (!apiBaseUrl || !apiKey || !(models || []).length || !rateLimiter) {
    return fallback;
  }

  const promptText = buildDailyCurationPrompt({
    dateString,
    profile,
    taxonomy,
    papers
  });

  try {
    const run = await generateTextWithFallbacks({
      apiBaseUrl,
      apiKey,
      models,
      promptText,
      rateLimiter,
      maxAttemptsPerModel: 1,
      timeoutMs
    });
    const parsed = extractJsonObject(run.content);
    if (!parsed) {
      return {
        ...fallback,
        source: 'fallback_after_parse_failure',
        model: run.model,
        raw: run.content
      };
    }
    return {
      ...fallback,
      overview: clipText(parsed.overview || '', 220) || fallback.overview,
      route_logic: clipText(parsed.route_logic || parsed.routeLogic || '', 220) || fallback.route_logic,
      source: 'planner_plus_model',
      model: run.model,
      raw: run.content
    };
  } catch (error) {
    return {
      ...fallback,
      source: 'fallback_after_model_failure',
      error: error.message
    };
  }
}

function applyDailyCuration(papers, curation, taxonomy = []) {
  const paperIndex = new Map((papers || []).map(paper => [normalizeTitle(paper.title), paper]));
  const ordered = [];

  for (const item of curation?.papers || []) {
    const paper = paperIndex.get(normalizeTitle(item.title));
    if (!paper) {
      continue;
    }
    ordered.push({
      ...paper,
      branchId: item.branch_id || paper.branchId || pickBranchId(paper, taxonomy),
      motivationSummary: item.motivation_summary || paper.motivationSummary || '',
      methodTakeaway: item.method_takeaway || paper.methodTakeaway || '',
      reasonWhyToday: item.why_today || paper.reasonWhyToday || '',
      readingStage: item.reading_stage || paper.readingStage || '',
      readingReason: item.reading_reason || paper.readingReason || ''
    });
  }

  return ordered.length === (papers || []).length ? ordered : papers;
}

module.exports = {
  applyDailyCuration,
  buildDailyCurationPrompt,
  curateDailySelection,
  fallbackCurateSelection,
  shouldRejectModelCuration
};
