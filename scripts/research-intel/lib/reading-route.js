#!/usr/bin/env node

const path = require('path');

const { buildPaperSlug } = require('./daily');

const ROUTE_ROLES = ['prerequisite', 'core', 'contrast', 'extension'];

function normalizeText(value) {
  return String(value || '').trim();
}

function uniqueStrings(items) {
  return [...new Set(
    (items || [])
      .map(item => normalizeText(item))
      .filter(Boolean)
  )];
}

function branchLabel(branchId) {
  return normalizeText(branchId).replace(/[-_]+/g, ' ') || 'general framing';
}

function buildPaperId(paper) {
  if (normalizeText(paper?.paperId)) {
    return normalizeText(paper.paperId);
  }
  if (normalizeText(paper?.arxivId)) {
    return `arxiv:${normalizeText(paper.arxivId)}`;
  }
  return `paper:${buildPaperSlug(paper?.title || 'paper')}`;
}

function buildCompareAxes(paper) {
  return uniqueStrings([
    ...(paper?.compareAxes || []),
    ...(paper?.matchedKeywords || []),
    ...(paper?.matchedSignals || []),
    branchLabel(paper?.branchId)
  ]).slice(0, 4);
}

function comparePapers(left, right) {
  const scoreDiff = Number(right?.score || 0) - Number(left?.score || 0);
  if (scoreDiff !== 0) {
    return scoreDiff;
  }
  return normalizeText(left?.title).localeCompare(normalizeText(right?.title), 'en', {
    sensitivity: 'base'
  });
}

function buildWhyHere(routeRole, paper) {
  const branch = branchLabel(paper?.branchId);
  if (routeRole === 'prerequisite') {
    return `先用这篇建立 ${branch} 的共享问题边界。`;
  }
  if (routeRole === 'core') {
    return `把这篇放在前段，承接今天的主方法主线。`;
  }
  if (routeRole === 'contrast') {
    return `用这篇补一条对照分支，帮助比较不同路线。`;
  }
  return `把这篇放在后段，补齐同一主线里的延伸细节。`;
}

function planReadingRoute({ dateString, selectedPapers }) {
  const ranked = [...(selectedPapers || [])]
    .map(paper => ({
      ...paper,
      slug: paper.slug || buildPaperSlug(paper.title),
      paperId: buildPaperId(paper)
    }))
    .sort(comparePapers);

  if (ranked.length === 0) {
    return {
      date: dateString,
      routeLogic: '今天没有进入 route planning 的论文。',
      orderedPapers: []
    };
  }

  const prerequisite = ranked[0];
  const mainBranchId = prerequisite.branchId;
  const remaining = ranked.slice(1);
  const sameBranch = remaining.filter(paper => paper.branchId === mainBranchId);
  const otherBranch = remaining.filter(paper => paper.branchId !== mainBranchId);
  const core = sameBranch[0] || otherBranch[0] || null;
  const corePaperId = core?.paperId || '';

  const orderedRaw = [
    prerequisite,
    ...(core ? [core] : []),
    ...remaining.filter(paper => paper.paperId !== corePaperId)
  ];

  const orderedPapers = orderedRaw.map((paper, index) => {
    let routeRole = 'extension';
    if (index === 0) {
      routeRole = 'prerequisite';
    } else if (core && paper.paperId === core.paperId) {
      routeRole = 'core';
    } else if (paper.branchId && paper.branchId !== mainBranchId) {
      routeRole = 'contrast';
    }

    return {
      ...paper,
      rank: index + 1,
      routeRole,
      compareAxes: buildCompareAxes(paper),
      whyHere: buildWhyHere(routeRole, paper)
    };
  });

  return {
    date: dateString,
    routeLogic: [
      '先用 prerequisite 论文建立共享边界，',
      '再用 core 论文承接主线，',
      '最后用 contrast / extension 论文补对照和延伸。'
    ].join(''),
    orderedPapers
  };
}

function rolePriority(routeRole) {
  if (routeRole === 'prerequisite') {
    return 0;
  }
  if (routeRole === 'core') {
    return 1;
  }
  if (routeRole === 'extension') {
    return 2;
  }
  return 3;
}

function selectDependencyCandidates(current, priorPapers) {
  return [...priorPapers].sort((left, right) => {
    const sameBranchDiff = Number(right.branchId === current.branchId) - Number(left.branchId === current.branchId);
    if (sameBranchDiff !== 0) {
      return sameBranchDiff;
    }
    const roleDiff = rolePriority(left.routeRole) - rolePriority(right.routeRole);
    if (roleDiff !== 0) {
      return roleDiff;
    }
    return Number(right.rank || 0) - Number(left.rank || 0);
  });
}

function buildDependencyGraph({ orderedPapers, maxInDegree = 3 }) {
  const safeMaxInDegree = Math.max(0, Number(maxInDegree || 0));
  const edges = [];
  const dependenciesByPaperId = {};

  for (let index = 0; index < (orderedPapers || []).length; index += 1) {
    const paper = orderedPapers[index];
    const priorPapers = orderedPapers.slice(0, index);
    const selectedDependencies = selectDependencyCandidates(paper, priorPapers)
      .slice(0, safeMaxInDegree);

    dependenciesByPaperId[paper.paperId] = selectedDependencies.map(dependency => {
      const sharedAxes = uniqueStrings(
        (paper.compareAxes || []).filter(axis => (dependency.compareAxes || []).includes(axis))
      );
      const edge = {
        fromRank: dependency.rank,
        fromPaperId: dependency.paperId,
        toRank: paper.rank,
        toPaperId: paper.paperId,
        compareAxes: sharedAxes.length > 0 ? sharedAxes : (paper.compareAxes || []).slice(0, 2)
      };
      edges.push(edge);
      return edge;
    });
  }

  return {
    maxInDegree: safeMaxInDegree,
    edges,
    dependenciesByPaperId
  };
}

function buildRouteArtifactPaths(runDir) {
  return {
    readingRouteJsonPath: path.join(runDir, 'reading_route.json'),
    readingRouteMarkdownPath: path.join(runDir, 'reading_route.md'),
    dependencyGraphPath: path.join(runDir, 'dependency_graph.json'),
    dependencyCardsDir: path.join(runDir, 'dependency_cards'),
    sessionContextsDir: path.join(runDir, 'session_contexts')
  };
}

function buildDependencyCardFilename(rank, slug) {
  return `${String(rank).padStart(2, '0')}-${normalizeText(slug) || 'paper'}.json`;
}

function buildSessionContextFilename(rank, slug) {
  return `${String(rank).padStart(2, '0')}-${normalizeText(slug) || 'paper'}.json`;
}

module.exports = {
  ROUTE_ROLES,
  buildDependencyCardFilename,
  buildDependencyGraph,
  buildRouteArtifactPaths,
  buildSessionContextFilename,
  planReadingRoute
};
