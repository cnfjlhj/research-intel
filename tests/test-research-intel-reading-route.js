#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ROUTE_ROLES,
  buildDependencyCardFilename,
  buildDependencyGraph,
  buildRouteArtifactPaths,
  buildSessionContextFilename,
  planReadingRoute
} = require('../scripts/research-intel/lib/reading-route');

test('planReadingRoute assigns route roles and stable order', () => {
  const route = planReadingRoute({
    dateString: '2026-03-17',
    selectedPapers: [
      {
        title: 'Paper B: Memory Retrieval for Evolving Agents',
        branchId: 'memory',
        score: 91,
        reasonWhyToday: 'memory branch'
      },
      {
        title: 'Paper A: Shared Framing for Memory Agents',
        branchId: 'memory',
        score: 95,
        reasonWhyToday: 'shared framing'
      },
      {
        title: 'Paper C: Verifier Contrast for Memory Agents',
        branchId: 'verifier',
        score: 88,
        reasonWhyToday: 'contrast branch'
      }
    ]
  });

  assert.deepEqual(ROUTE_ROLES, ['prerequisite', 'core', 'contrast', 'extension']);
  assert.equal(route.date, '2026-03-17');
  assert.equal(route.orderedPapers.length, 3);
  assert.deepEqual(
    route.orderedPapers.map(paper => paper.rank),
    [1, 2, 3]
  );
  assert.equal(route.orderedPapers[0].title, 'Paper A: Shared Framing for Memory Agents');
  assert.equal(route.orderedPapers[0].routeRole, 'prerequisite');
  assert.equal(route.orderedPapers[1].routeRole, 'core');
  assert.equal(route.orderedPapers[2].routeRole, 'contrast');
  assert.ok(route.orderedPapers[0].whyHere.length > 0);
  assert.ok(route.orderedPapers[1].compareAxes.length > 0);
  assert.match(route.routeLogic, /先用 prerequisite/);
});

test('buildDependencyGraph never points forward and respects maxInDegree', () => {
  const graph = buildDependencyGraph({
    orderedPapers: [
      { rank: 1, paperId: 'paper:a', branchId: 'memory', routeRole: 'prerequisite', compareAxes: ['problem framing'] },
      { rank: 2, paperId: 'paper:b', branchId: 'memory', routeRole: 'core', compareAxes: ['memory module'] },
      { rank: 3, paperId: 'paper:c', branchId: 'memory', routeRole: 'extension', compareAxes: ['evaluation setup'] },
      { rank: 4, paperId: 'paper:d', branchId: 'verifier', routeRole: 'contrast', compareAxes: ['verifier loop'] },
      { rank: 5, paperId: 'paper:e', branchId: 'memory', routeRole: 'extension', compareAxes: ['archive updates'] }
    ],
    maxInDegree: 3
  });

  assert.ok(graph.edges.every(edge => edge.fromRank < edge.toRank));
  assert.ok(graph.edges.filter(edge => edge.toPaperId === 'paper:e').length <= 3);
  assert.equal(graph.dependenciesByPaperId['paper:a'].length, 0);
  assert.deepEqual(
    graph.dependenciesByPaperId['paper:b'].map(edge => edge.fromPaperId),
    ['paper:a']
  );
});

test('buildDependencyGraph allows zero dependencies when no prior papers exist', () => {
  const graph = buildDependencyGraph({
    orderedPapers: [
      { rank: 1, paperId: 'paper:solo', branchId: 'solo', routeRole: 'prerequisite', compareAxes: [] }
    ]
  });

  assert.deepEqual(graph.edges, []);
  assert.deepEqual(graph.dependenciesByPaperId['paper:solo'], []);
});

test('route artifact helpers produce deterministic filenames and directories', () => {
  const paths = buildRouteArtifactPaths('/tmp/research-intel/daily/2026-03-17');

  assert.equal(paths.readingRouteJsonPath, '/tmp/research-intel/daily/2026-03-17/reading_route.json');
  assert.equal(paths.readingRouteMarkdownPath, '/tmp/research-intel/daily/2026-03-17/reading_route.md');
  assert.equal(paths.dependencyGraphPath, '/tmp/research-intel/daily/2026-03-17/dependency_graph.json');
  assert.equal(paths.dependencyCardsDir, '/tmp/research-intel/daily/2026-03-17/dependency_cards');
  assert.equal(paths.sessionContextsDir, '/tmp/research-intel/daily/2026-03-17/session_contexts');
  assert.equal(buildDependencyCardFilename(2, 'paper-a'), '02-paper-a.json');
  assert.equal(buildSessionContextFilename(2, 'paper-a'), '02-paper-a.json');
});
