# Layered Context and Local Dependency Graph Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add layered context plus a backward-only local dependency graph to the `research-intel` daily pipeline so each paper keeps an isolated tmux session while still receiving audited prior-paper context.

**Architecture:** Introduce a small deterministic planning layer before per-paper generation. The daily run will first produce a stable reading route, then generate each paper in route order, emitting a structured dependency card after each paper and using those cards to build the next paper's session context. All new semantic artifacts are written to both `work/` and `research-intel-records/`, while large binaries remain single-copy unless explicitly promoted later.

**Tech Stack:** Node.js, existing `scripts/research-intel` pipeline, tmux-backed Codex HTML generation, `node:test`, JSON/Markdown file artifacts.

---

## Preconditions

- Read [流程与主链约束.md](/home/cnfjlhj/projects/research-intel/docs/流程与主链约束.md) before touching code.
- Do not revert or overwrite unrelated local changes in:
  - [codex-supervisor.js](/home/cnfjlhj/projects/research-intel/scripts/research-intel/codex-supervisor.js)
  - [lib/codex-supervisor.js](/home/cnfjlhj/projects/research-intel/scripts/research-intel/lib/codex-supervisor.js)
  - [test-research-intel-codex-supervisor.js](/home/cnfjlhj/projects/research-intel/tests/test-research-intel-codex-supervisor.js)
- Keep YAGNI: implement deterministic route/dependency planning first. Do not add a second model-driven planning stage in the first pass.
- Keep `paper.pdf` as the top-priority source of truth in all prompts and generated artifacts.

## Target Outputs

After implementation, each daily run should additionally produce:

- `work/research-intel/daily/<date>/reading_route.json`
- `work/research-intel/daily/<date>/reading_route.md`
- `work/research-intel/daily/<date>/dependency_graph.json`
- `work/research-intel/daily/<date>/dependency_cards/*.json`
- `work/research-intel/daily/<date>/session_contexts/*.json`
- Matching copies under `research-intel-records/daily/<date>/`

And each selected paper should additionally carry:

- `routeRole`
- `dependencyPaperIds`
- `dependencyCardPaths`
- `sessionContextPath`

## Task 1: Introduce Route and Dependency Planning Primitives

**Files:**
- Create: `scripts/research-intel/lib/reading-route.js`
- Create: `tests/test-research-intel-reading-route.js`
- Modify: `scripts/research-intel/lib/daily.js`

**Step 1: Write the failing tests**

Add tests for:

- stable route ordering with explicit `routeRole`
- backward-only dependency edges
- max in-degree of 3
- allowing zero dependencies
- deterministic card/session filenames from ranked papers

Use a new test file:

```js
test('planReadingRoute assigns route roles and stable order', () => {
  const route = planReadingRoute({
    dateString: '2026-03-17',
    selectedPapers: [
      { title: 'Paper A', branchId: 'memory', score: 95, reasonWhyToday: '...' },
      { title: 'Paper B', branchId: 'memory', score: 91, reasonWhyToday: '...' },
      { title: 'Paper C', branchId: 'verifier', score: 88, reasonWhyToday: '...' }
    ]
  });
  assert.equal(route.orderedPapers.length, 3);
  assert.equal(route.orderedPapers[0].routeRole, 'prerequisite');
  assert.ok(['core', 'contrast', 'extension'].includes(route.orderedPapers[1].routeRole));
});

test('selectLocalDependencies never points forward and respects maxInDegree', () => {
  const graph = buildDependencyGraph({
    orderedPapers: [
      { rank: 1, paperId: 'paper:a', branchId: 'memory', routeRole: 'prerequisite' },
      { rank: 2, paperId: 'paper:b', branchId: 'memory', routeRole: 'core' },
      { rank: 3, paperId: 'paper:c', branchId: 'memory', routeRole: 'extension' },
      { rank: 4, paperId: 'paper:d', branchId: 'memory', routeRole: 'extension' }
    ],
    maxInDegree: 3
  });
  assert.ok(graph.edges.every(edge => edge.fromRank < edge.toRank));
  assert.ok(graph.edges.filter(edge => edge.toPaperId === 'paper:d').length <= 3);
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/test-research-intel-reading-route.js
```

Expected:

- FAIL with missing module or missing exported functions from `reading-route.js`

**Step 3: Write minimal implementation**

Create `scripts/research-intel/lib/reading-route.js` with deterministic helpers:

- `ROUTE_ROLES = ['prerequisite', 'core', 'contrast', 'extension']`
- `planReadingRoute({ dateString, selectedPapers })`
- `buildDependencyGraph({ orderedPapers, maxInDegree = 3 })`
- `buildRouteArtifactPaths(runDir)`
- `buildDependencyCardFilename(rank, slug)`
- `buildSessionContextFilename(rank, slug)`

Implementation constraints:

- Prefer one `prerequisite` at the front when a paper best establishes shared framing.
- Prefer one `core` near the front for the strongest mainline paper.
- Allow `contrast` when branch differs but compare axes overlap.
- Use `extension` for same-branch follow-ups after prerequisite/core.
- Use only prior papers when building edges.

**Step 4: Run tests to verify they pass**

Run:

```bash
node --test tests/test-research-intel-reading-route.js
node --test tests/test-research-intel-daily.js
```

Expected:

- PASS for the new route/dependency unit tests
- existing daily path tests still PASS

**Step 5: Commit**

```bash
git add scripts/research-intel/lib/reading-route.js tests/test-research-intel-reading-route.js scripts/research-intel/lib/daily.js
git commit -m "feat: add deterministic reading route planner"
```

## Task 2: Extend Daily Path Builders and Manifest Schema

**Files:**
- Modify: `scripts/research-intel/lib/daily.js`
- Modify: `scripts/research-intel/daily-run.js`
- Modify: `tests/test-research-intel-daily.js`

**Step 1: Write the failing tests**

Extend path tests so run/record layouts expose route/dependency artifacts.

Example:

```js
test('buildRunPaths exposes route and dependency artifact paths', () => {
  const paths = buildRunPaths('/tmp/research-intel', '2026-03-17');
  assert.equal(paths.readingRouteJsonPath, '/tmp/research-intel/daily/2026-03-17/reading_route.json');
  assert.equal(paths.dependencyGraphPath, '/tmp/research-intel/daily/2026-03-17/dependency_graph.json');
  assert.equal(paths.dependencyCardsDir, '/tmp/research-intel/daily/2026-03-17/dependency_cards');
  assert.equal(paths.sessionContextsDir, '/tmp/research-intel/daily/2026-03-17/session_contexts');
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/test-research-intel-daily.js
```

Expected:

- FAIL because the new path properties do not exist

**Step 3: Write minimal implementation**

Add path fields to:

- `buildRunPaths()` in [daily.js](/home/cnfjlhj/projects/research-intel/scripts/research-intel/lib/daily.js)
- `buildRecordPaths()` in [daily.js](/home/cnfjlhj/projects/research-intel/scripts/research-intel/lib/daily.js)

Add daily manifest fields in [daily-run.js](/home/cnfjlhj/projects/research-intel/scripts/research-intel/daily-run.js):

- `readingRoute`
  - `jsonPath`
  - `markdownPath`
- `dependencyGraph`
  - `jsonPath`
- per-paper fields:
  - `routeRole`
  - `dependencyPaperIds`
  - `dependencyCardPath`
  - `sessionContextPath`

**Step 4: Run tests to verify they pass**

Run:

```bash
node --test tests/test-research-intel-daily.js
```

Expected:

- PASS for new path expectations

**Step 5: Commit**

```bash
git add scripts/research-intel/lib/daily.js scripts/research-intel/daily-run.js tests/test-research-intel-daily.js
git commit -m "feat: add route and dependency artifact paths"
```

## Task 3: Plan the Reading Route Before Per-Paper Generation

**Files:**
- Modify: `scripts/research-intel/daily-run.js`
- Modify: `scripts/research-intel/lib/render.js`
- Modify: `tests/test-research-intel-render.js`
- Modify: `tests/test-research-intel-daily.js`

**Step 1: Write the failing tests**

Add tests for:

- `reading_route.md` being a first-class render output, not just a derived summary
- route roles and compare axes appearing in route markdown
- daily run helper logic consuming route order before paper generation

Example render test:

```js
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
  assert.match(markdown, /prerequisite/);
  assert.match(markdown, /problem framing/);
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/test-research-intel-render.js
```

Expected:

- FAIL because `buildReadingRouteMarkdown` does not exist or lacks the new fields

**Step 3: Write minimal implementation**

In [daily-run.js](/home/cnfjlhj/projects/research-intel/scripts/research-intel/daily-run.js):

- call `planReadingRoute()` immediately after initial paper selection/decorating
- write `reading_route.json` and `reading_route.md` to both `work/` and `records/`
- use route order as the generation order for per-paper artifact generation
- keep existing post-generation curation, but do not let it erase the planned route metadata

In [render.js](/home/cnfjlhj/projects/research-intel/scripts/research-intel/lib/render.js):

- add `buildReadingRouteMarkdown(route)`
- keep `buildReadingOrderMarkdown()` for human-readable daily summary
- ensure `reading_order.md` can reference the planned route roles without becoming the sole machine source

**Step 4: Run tests to verify they pass**

Run:

```bash
node --test tests/test-research-intel-render.js
node --test tests/test-research-intel-daily.js
```

Expected:

- PASS for route markdown output
- PASS for daily helpers still using stable order semantics

**Step 5: Commit**

```bash
git add scripts/research-intel/daily-run.js scripts/research-intel/lib/render.js tests/test-research-intel-render.js tests/test-research-intel-daily.js
git commit -m "feat: plan reading route before paper generation"
```

## Task 4: Inject Layered Context Into Per-Paper Prompt and Emit Session Context Files

**Files:**
- Modify: `scripts/research-intel/daily-run.js`
- Modify: `scripts/research-intel/lib/codex-html.js`
- Modify: `tests/test-research-intel-codex-html.js`
- Modify: `tests/test-research-intel-daily.js`

**Step 1: Write the failing tests**

Add prompt tests asserting the HTML prompt includes:

- global route context
- dependency card summaries
- explicit instruction that current `paper.pdf` outranks prior-paper context

Example:

```js
test('buildCodexInlineHtmlPrompt includes layered context and keeps paper pdf highest priority', () => {
  const prompt = buildCodexInlineHtmlPrompt({
    templateHtml: '<html></html>',
    paperPdfPath: '/paper/paper.pdf',
    paperMetaPath: '/paper/paper_meta.json',
    paperMetaJson: '{}',
    paperTextPath: '/paper/paper_text.txt',
    paperTextPreviewPath: '/paper/paper_text_preview.txt',
    paperTextPreview: 'preview',
    openreviewSummaryPath: '/paper/openreview_summary.md',
    openreviewSummary: 'none',
    pageImagesDir: '/paper/pages',
    pageTextsDir: '/paper/page_texts',
    pageImageCount: 8,
    routeContextJson: JSON.stringify({ route_logic: '先基础，再主方法。' }),
    dependencyCardsJson: JSON.stringify([{ title: 'Paper A', compare_axes: ['feedback loop'] }])
  });
  assert.match(prompt, /route logic/i);
  assert.match(prompt, /dependency/i);
  assert.match(prompt, /paper\.pdf 为唯一真相来源/);
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/test-research-intel-codex-html.js
```

Expected:

- FAIL because the new prompt parameters and assertions are not implemented

**Step 3: Write minimal implementation**

In [daily-run.js](/home/cnfjlhj/projects/research-intel/scripts/research-intel/daily-run.js):

- before each paper run, build a `session_contexts/<rank>-<slug>.json`
- include:
  - global context paths
  - dependency card paths
  - current source paths
- write that JSON to both `work/` and `records/`
- pass serialized route/dependency data into `buildCodexInlineHtmlPrompt()`

In [codex-html.js](/home/cnfjlhj/projects/research-intel/scripts/research-intel/lib/codex-html.js):

- extend `buildCodexInlineHtmlPrompt()` to accept:
  - `routeContextJson`
  - `dependencyCardsJson`
- add a short prompt section explaining:
  - current paper is the ground truth
  - prior cards only provide comparison context
  - conflicting prior claims must yield to current PDF evidence

**Step 4: Run tests to verify they pass**

Run:

```bash
node --test tests/test-research-intel-codex-html.js
node --test tests/test-research-intel-daily.js
```

Expected:

- PASS for prompt content
- PASS for session context file path expectations

**Step 5: Commit**

```bash
git add scripts/research-intel/daily-run.js scripts/research-intel/lib/codex-html.js tests/test-research-intel-codex-html.js tests/test-research-intel-daily.js
git commit -m "feat: inject layered route context into paper prompts"
```

## Task 5: Emit Dependency Cards and Enrich Paper Metadata

**Files:**
- Modify: `scripts/research-intel/lib/network.js`
- Modify: `scripts/research-intel/daily-run.js`
- Modify: `tests/test-research-intel-network.js`
- Modify: `tests/test-research-intel-daily.js`

**Step 1: Write the failing tests**

Extend `buildPaperCard()` tests to cover:

- `route_role`
- `compare_axes`
- `dependency_paper_ids`
- `why_relevant_to_current` or equivalent current-facing comparison fields

Add a dependency-card test shape:

```js
test('buildPaperCard carries route role and dependency metadata', () => {
  const card = buildPaperCard({
    paper: {
      title: 'Paper B',
      arxivId: '2603.20000',
      routeRole: 'core',
      dependencyPaperIds: ['arxiv:2603.10000'],
      compareAxes: ['core mechanism', 'evaluation setup']
    },
    meta: { title: 'Paper B', abstract: '...' },
    openreviewSummary: '暂无公开 OpenReview 信息。',
    dateString: '2026-03-17'
  });
  assert.equal(card.route_role, 'core');
  assert.deepEqual(card.dependency_paper_ids, ['arxiv:2603.10000']);
  assert.ok(card.compare_axes.includes('core mechanism'));
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/test-research-intel-network.js
```

Expected:

- FAIL because the new metadata fields are missing

**Step 3: Write minimal implementation**

In [network.js](/home/cnfjlhj/projects/research-intel/scripts/research-intel/lib/network.js):

- extend `buildPaperCard()` to preserve:
  - `route_role`
  - `dependency_paper_ids`
  - `compare_axes`
  - `route_rank`
- add a helper in `reading-route.js` or `daily-run.js` that emits the public `dependency_card` JSON from:
  - current paper card
  - selected dependency edges
  - route role

In [daily-run.js](/home/cnfjlhj/projects/research-intel/scripts/research-intel/daily-run.js):

- after each successful paper generation:
  - write `dependency_cards/<rank>-<slug>.json` to both `work/` and `records/`
  - attach `dependencyCardPath` and `dependencyPaperIds` to the paper object before manifest writeout

**Step 4: Run tests to verify they pass**

Run:

```bash
node --test tests/test-research-intel-network.js
node --test tests/test-research-intel-daily.js
```

Expected:

- PASS for enriched paper card fields
- PASS for dependency card emission expectations

**Step 5: Commit**

```bash
git add scripts/research-intel/lib/network.js scripts/research-intel/daily-run.js tests/test-research-intel-network.js tests/test-research-intel-daily.js
git commit -m "feat: emit dependency cards for route-aware reading"
```

## Task 6: Surface Route and Dependency Artifacts in Records, Web, and Bundles

**Files:**
- Modify: `scripts/research-intel/lib/render.js`
- Modify: `scripts/research-intel/lib/web.js`
- Modify: `scripts/research-intel/lib/package.js`
- Modify: `tests/test-research-intel-render.js`
- Modify: `tests/test-research-intel-web.js`
- Modify: `tests/test-research-intel-package.js`

**Step 1: Write the failing tests**

Add tests for:

- ledger bundle including `reading_route.md`, `reading_route.json`, `dependency_graph.json`
- daily snapshot discovery exposing route/dependency paths
- daily page rendering route info and linking raw route/dependency files

Example:

```js
test('buildTelegramLedgerBundleEntries includes route and dependency artifacts', () => {
  const entries = buildTelegramLedgerBundleEntries();
  assert.ok(entries.includes('reading_route.md'));
  assert.ok(entries.includes('reading_route.json'));
  assert.ok(entries.includes('dependency_graph.json'));
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/test-research-intel-package.js
node --test tests/test-research-intel-web.js
```

Expected:

- FAIL because the new route/dependency artifacts are not exposed

**Step 3: Write minimal implementation**

In [package.js](/home/cnfjlhj/projects/research-intel/scripts/research-intel/lib/package.js):

- extend ledger bundle entries with:
  - `reading_route.md`
  - `reading_route.json`
  - `dependency_graph.json`
- keep `session_contexts/` out of Telegram bundles in the first pass to avoid noisy archives

In [web.js](/home/cnfjlhj/projects/research-intel/scripts/research-intel/lib/web.js):

- include:
  - `readingRoutePath`
  - `readingRouteJsonPath`
  - `dependencyGraphPath`
- daily detail page should render:
  - route markdown block
  - raw links for route json and dependency graph
- selected paper cards may optionally show:
  - route role
  - dependency count

In [render.js](/home/cnfjlhj/projects/research-intel/scripts/research-intel/lib/render.js):

- ensure route role and compare axes can render in the human-readable route markdown

**Step 4: Run tests to verify they pass**

Run:

```bash
node --test tests/test-research-intel-package.js
node --test tests/test-research-intel-web.js
node --test tests/test-research-intel-render.js
```

Expected:

- PASS for package entries
- PASS for daily snapshot rendering
- PASS for route markdown presentation

**Step 5: Commit**

```bash
git add scripts/research-intel/lib/package.js scripts/research-intel/lib/web.js scripts/research-intel/lib/render.js tests/test-research-intel-package.js tests/test-research-intel-web.js tests/test-research-intel-render.js
git commit -m "feat: surface route and dependency artifacts in records and web"
```

## Task 7: End-to-End Verification and Doc Sync

**Files:**
- Modify: `docs/数据目录说明.md`
- Modify: `docs/架构说明.md`
- Modify: `docs/部署说明.md`
- Modify: `docs/流程与主链约束.md`

**Step 1: Add/update the minimal doc assertions**

Document:

- new route/dependency/session-context artifact directories
- dual-write policy for semantic artifacts
- route planning now happens before per-paper generation
- `reading_order.md` is not the machine source of truth anymore

**Step 2: Run focused tests**

Run:

```bash
node --test tests/test-research-intel-reading-route.js
node --test tests/test-research-intel-daily.js
node --test tests/test-research-intel-network.js
node --test tests/test-research-intel-render.js
node --test tests/test-research-intel-package.js
node --test tests/test-research-intel-web.js
node --test tests/test-research-intel-codex-html.js
```

Expected:

- PASS on all targeted suites

**Step 3: Run full local test suite**

Run:

```bash
npm test
```

Expected:

- PASS with no regressions

**Step 4: Run isolated baohe smoke verification**

Run on `baohe` with temporary roots only:

```bash
node scripts/research-intel/daily-run.js \
  --profile-dir /tmp/research-intel-profile-<id> \
  --base-dir /tmp/research-intel-base-<id> \
  --records-dir /tmp/research-intel-records-<id> \
  --no-telegram
```

Verify presence of:

- `reading_route.json`
- `dependency_graph.json`
- `dependency_cards/`
- `session_contexts/`
- `index.html`
- `paper_card.json`
- `html_validation.json`
- `standalone_validation.json`

**Step 5: Commit**

```bash
git add docs/数据目录说明.md docs/架构说明.md docs/部署说明.md docs/流程与主链约束.md
git commit -m "docs: document layered context route artifacts"
```

## Notes for the Implementer

- Do not add another model-based planner in the first pass.
- Do not turn dependency cards into raw transcripts.
- Do not let prior-paper context outrank current `paper.pdf`.
- Do not add a second run mode or fallback branch to support this feature.
- Keep the first implementation deterministic and auditable.

## Recommended Execution Order

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 5
6. Task 6
7. Task 7
