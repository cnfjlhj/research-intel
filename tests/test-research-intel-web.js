#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createResearchIntelWebApp, summarizeHeartbeatState } = require('../scripts/research-intel/lib/web');

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-web-'));
  const profileDir = path.join(rootDir, 'work', 'research-intel', 'profile');
  const runtimeDir = path.join(rootDir, 'work', 'research-intel', 'runtime');
  const recordsDir = path.join(rootDir, 'research-intel-records');
  const dailyDir = path.join(recordsDir, 'daily', '2026-03-14');
  const workDailyDir = path.join(rootDir, 'work', 'research-intel', 'daily', '2026-03-14', 'papers', '01-demo-paper');

  writeText(path.join(profileDir, 'research_brief.md'), [
    '---',
    'timezone: Asia/Shanghai',
    'send_time: "06:00"',
    'min_papers: 3',
    'target_papers: 5',
    'max_papers: 8',
    '---',
    '',
    '# Research Brief',
    '',
    '## Current Goal',
    '- 跟踪 self-evolving agents。',
    '',
    '## Focus Keywords',
    '- self-evolving agents',
    '',
    '## Positive Signals',
    '- experience sharing',
    '',
    '## Negative Signals',
    '- pure survey'
  ].join('\n'));
  writeText(
    path.join(profileDir, 'seed_papers.jsonl'),
    [
      JSON.stringify({
        title: 'Seed Demo',
        status: 'read',
        anchor: true,
        liked: true,
        notes: '核心锚点'
      })
    ].join('\n') + '\n'
  );
  writeText(
    path.join(profileDir, 'feedback.jsonl'),
    [
      JSON.stringify({
        title: 'Feedback Demo',
        status: 'skimmed',
        liked: false,
        notes: '需要再看一遍'
      })
    ].join('\n') + '\n'
  );
  writeJson(path.join(profileDir, 'method_taxonomy.json'), {
    root_title: 'Self-Evolving Agents',
    branches: [
      {
        id: 'open-ended-evolution',
        title: 'Open-Ended Evolution',
        keywords: ['open-ended evolution']
      }
    ]
  });
  writeText(path.join(profileDir, 'method_tree_notes.md'), '# Manual Notes\n\n- 注意方法谱系。\n');
  writeText(path.join(profileDir, 'runtime.env'), 'RESEARCH_INTEL_WEB_PASSWORD=super-secret\n');

  writeJson(path.join(runtimeDir, 'current-run.json'), {
    date: '2026-03-14',
    status: 'completed',
    sessionName: 'research-intel-codex-20260314'
  });
  writeJson(path.join(runtimeDir, 'heartbeat.json'), {
    alive: true,
    stale: false,
    lastNonEmptyLine: 'completed',
    run: {
      date: '2026-03-14',
      status: 'completed'
    }
  });
  writeText(path.join(runtimeDir, 'worker-progress.md'), '2026-03-14T06:10:00Z completed\n');

  writeText(path.join(dailyDir, 'brief.md'), '# 今日简报\n\n- Demo Paper\n');
  writeText(path.join(dailyDir, 'reading_order.md'), '# 阅读顺序\n\n1. Demo Paper\n');
  writeText(path.join(dailyDir, 'reading_route.md'), [
    '# 2026-03-14 Reading Route',
    '',
    '- Route logic: 先看 prerequisite，再看 core。',
    '',
    '## Ordered Papers',
    '',
    '### 1. Demo Paper',
    '- route_role: prerequisite',
    '- compare_axes: demo-method；feedback loop'
  ].join('\n'));
  writeJson(path.join(dailyDir, 'reading_route.json'), {
    date: '2026-03-14',
    routeLogic: '先看 prerequisite，再看 core。',
    orderedPapers: [
      {
        rank: 1,
        title: 'Demo Paper',
        routeRole: 'prerequisite',
        compareAxes: ['demo-method', 'feedback loop']
      }
    ]
  });
  writeJson(path.join(dailyDir, 'dependency_graph.json'), {
    maxInDegree: 3,
    edges: []
  });
  writeJson(path.join(dailyDir, 'daily_curation.json'), {
    overview: '先看主问题，再看具体实现。',
    route_logic: '第一篇先定主线。'
  });
  writeJson(path.join(dailyDir, 'selected_papers.json'), [
    {
      title: 'Demo Paper',
      reasonWhyToday: '因为它很新。',
      readingReason: '先看这篇。',
      readingStage: '先看',
      routeRole: 'prerequisite',
      routeRank: 1,
      dependencyPaperIds: ['paper:shared-framing'],
      motivationSummary: '它直接回答一个核心问题。',
      methodTakeaway: '先用这篇钉住方法切口。',
      htmlPath: 'work/research-intel/daily/2026-03-14/papers/01-demo-paper/index.html',
      dependencyCardPath: 'research-intel-records/daily/2026-03-14/dependency_cards/01-demo-paper.json',
      sessionContextPath: 'research-intel-records/daily/2026-03-14/session_contexts/01-demo-paper.json',
      paperCard: {
        core_problem: ['它直接回答一个核心问题。'],
        method_tags: ['demo-method'],
        source_links: {
          arxiv_pdf: 'https://arxiv.org/pdf/1234.5678v2'
        }
      }
    }
  ]);
  writeJson(path.join(dailyDir, 'watchlist_papers.json'), [
    {
      title: 'Older Neighbor Paper',
      watchlistReason: '方法线相关，但发布时间较早，先放入回补观察池。',
      motivationSummary: '它能补上更早一代的经验积累路线。',
      methodTakeaway: '补充 archive / memory 线。',
      pdfUrl: 'https://arxiv.org/pdf/9999.0001v1'
    }
  ]);
  writeJson(path.join(dailyDir, 'manifest.json'), {
    date: '2026-03-14',
    timezone: 'Asia/Shanghai',
    selectedCount: 1,
    selectedTitles: ['Demo Paper'],
    watchlistCount: 1,
    watchlistTitles: ['Older Neighbor Paper'],
    papers: [
      {
        title: 'Demo Paper',
        htmlPath: 'work/research-intel/daily/2026-03-14/papers/01-demo-paper/index.html',
        paperCardPath: 'work/research-intel/daily/2026-03-14/papers/01-demo-paper/paper_card.json'
      }
    ],
    methodTree: {
      markdownPath: 'research-intel-records/knowledge/method_tree.md'
    },
    readingRoute: {
      markdownPath: 'research-intel-records/daily/2026-03-14/reading_route.md',
      jsonPath: 'research-intel-records/daily/2026-03-14/reading_route.json'
    },
    dependencyGraph: {
      jsonPath: 'research-intel-records/daily/2026-03-14/dependency_graph.json'
    }
  });
  writeJson(path.join(dailyDir, 'delivery_status.json'), {
    expectedCount: 2,
    items: [
      { kind: 'paper_html', title: 'Demo Paper', status: 'sent', messageId: 101 },
      { kind: 'ledger', title: 'Research Ledger', status: 'pending' }
    ]
  });
  writeJson(path.join(recordsDir, 'knowledge', 'method_tree.json'), {
    rootTitle: 'Self-Evolving Agents',
    updatedAt: '2026-03-14',
    branches: [
      {
        id: 'open-ended-evolution',
        title: 'Open-Ended Evolution',
        question: '如何判断开放式演化真的发生了？',
        sharedConcepts: ['常见切口：demo-method'],
        papers: [
          {
            title: 'Demo Paper',
            anchor: false,
            status: 'selected',
            details: ['研究动机：它直接回答一个核心问题。'],
            htmlPath: 'work/research-intel/daily/2026-03-14/papers/01-demo-paper/index.html',
            paperCardPath: 'work/research-intel/daily/2026-03-14/papers/01-demo-paper/paper_card.json'
          }
        ]
      }
    ]
  });
  writeText(path.join(recordsDir, 'knowledge', 'method_tree.md'), '# Self-Evolving Agents\n\n## Open-Ended Evolution\n- Demo Paper\n');
  writeText(path.join(workDailyDir, 'index.html'), '<!DOCTYPE html><html><body><h1>Demo Paper HTML</h1></body></html>\n');
  writeJson(path.join(workDailyDir, 'paper_card.json'), {
    title: 'Demo Paper'
  });

  return {
    rootDir,
    profileDir,
    recordsDir
  };
}

async function startServer(options = {}) {
  const fixture = createFixture();
  const runInvocations = [];
  const app = createResearchIntelWebApp({
    rootDir: fixture.rootDir,
    sitePassword: 'secret-pass',
    runDaily: async () => {
      runInvocations.push(new Date().toISOString());
      return { ok: true };
    },
    ...options
  });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    ...fixture,
    runInvocations,
    baseUrl,
    close: () => new Promise((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    })
  };
}

function extractCookie(response) {
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie, 'expected set-cookie header');
  return cookie.split(';')[0];
}

test('research-intel web app protects dashboard behind login', async () => {
  const server = await startServer();
  try {
    const response = await fetch(`${server.baseUrl}/research-intel/`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/research-intel/login');
  } finally {
    await server.close();
  }
});

test('research-intel web app accepts password login and renders dashboard', async () => {
  const server = await startServer();
  try {
    const login = await fetch(`${server.baseUrl}/research-intel/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ password: 'secret-pass' }),
      redirect: 'manual'
    });
    assert.equal(login.status, 303);
    assert.equal(login.headers.get('location'), '/research-intel/');
    const cookie = extractCookie(login);

    const dashboard = await fetch(`${server.baseUrl}/research-intel/`, {
      headers: {
        cookie
      }
    });
    const html = await dashboard.text();
    assert.equal(dashboard.status, 200);
    assert.match(html, /Demo Paper/);
    assert.match(html, /2026-03-14/);
    assert.match(html, /运行状态/);
    assert.match(html, /投递状态/);
  } finally {
    await server.close();
  }
});

test('dashboard ignores partial daily directories when choosing the latest visible snapshot', async () => {
  const server = await startServer();
  try {
    const partialDir = path.join(server.rootDir, 'research-intel-records', 'daily', '2026-03-14.partial-002946');
    writeJson(path.join(partialDir, 'manifest.json'), {
      date: '2026-03-14.partial-002946',
      selectedCount: 0,
      selectedTitles: []
    });
    writeJson(path.join(partialDir, 'selected_papers.json'), []);

    const login = await fetch(`${server.baseUrl}/research-intel/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ password: 'secret-pass' }),
      redirect: 'manual'
    });
    const cookie = extractCookie(login);

    const dashboard = await fetch(`${server.baseUrl}/research-intel/`, {
      headers: { cookie }
    });
    const html = await dashboard.text();

    assert.equal(dashboard.status, 200);
    assert.match(html, /最近一次日报共收录 1 篇主推论文、1 篇观察池论文，最新日期 2026-03-14/);
    assert.doesNotMatch(html, /2026-03-14\.partial-002946/);
  } finally {
    await server.close();
  }
});

test('daily detail renders markdown tables and keeps ordered reading items grouped', async () => {
  const server = await startServer();
  try {
    writeText(path.join(server.recordsDir, 'daily', '2026-03-14', 'brief.md'), [
      '# 今日简报',
      '',
      '| 论文 | 为什么今天看 |',
      '| --- | --- |',
      '| Demo Paper | 因为它很新。 |'
    ].join('\n'));
    writeText(path.join(server.recordsDir, 'daily', '2026-03-14', 'reading_order.md'), [
      '# 阅读顺序',
      '',
      '1. Demo Paper',
      '',
      '阶段：先看',
      '排序理由：先把主问题钉住。',
      '',
      '2. Demo Follow-up',
      '',
      '阶段：第二篇再看',
      '排序理由：继续补关键机制。'
    ].join('\n'));

    const login = await fetch(`${server.baseUrl}/research-intel/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ password: 'secret-pass' }),
      redirect: 'manual'
    });
    const cookie = extractCookie(login);

    const page = await fetch(`${server.baseUrl}/research-intel/daily/2026-03-14`, {
      headers: { cookie }
    });
    const html = await page.text();

    assert.equal(page.status, 200);
    assert.match(html, /<table class="table">/);
    assert.match(html, /<th>论文<\/th>/);
    assert.match(html, /<td>Demo Paper<\/td>/);
    assert.ok((html.match(/<ol>/g) || []).length >= 1);
    assert.match(html, /<li>Demo Paper<p>阶段：先看<\/p><p>排序理由：先把主问题钉住。<\/p><\/li>/);
    assert.match(html, /<li>Demo Follow-up<p>阶段：第二篇再看<\/p><p>排序理由：继续补关键机制。<\/p><\/li>/);
  } finally {
    await server.close();
  }
});

test('daily detail renders route artifacts and dependency metadata', async () => {
  const server = await startServer();
  try {
    const login = await fetch(`${server.baseUrl}/research-intel/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ password: 'secret-pass' }),
      redirect: 'manual'
    });
    const cookie = extractCookie(login);

    const response = await fetch(`${server.baseUrl}/research-intel/daily/2026-03-14`, {
      headers: { cookie }
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Raw Reading Route/);
    assert.match(html, /reading_route\.json/);
    assert.match(html, /dependency_graph\.json/);
    assert.match(html, /route role/i);
    assert.match(html, /prerequisite/);
    assert.match(html, /依赖 1/);
  } finally {
    await server.close();
  }
});

test('knowledge raw markdown rewrites internal filesystem links through the guarded file route', async () => {
  const server = await startServer();
  try {
    writeText(path.join(server.recordsDir, 'knowledge', 'method_tree.md'), [
      '# Self-Evolving Agents',
      '',
      `- [HTML](${path.join(server.rootDir, 'work', 'research-intel', 'daily', '2026-03-14', 'papers', '01-demo-paper', 'index.html')})`
    ].join('\n'));

    const login = await fetch(`${server.baseUrl}/research-intel/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ password: 'secret-pass' }),
      redirect: 'manual'
    });
    const cookie = extractCookie(login);

    const page = await fetch(`${server.baseUrl}/research-intel/knowledge`, {
      headers: { cookie }
    });
    const html = await page.text();

    assert.equal(page.status, 200);
    assert.match(html, /href="\/research-intel\/files\/work\/research-intel\/daily\/2026-03-14\/papers\/01-demo-paper\/index\.html"/);
    assert.doesNotMatch(html, new RegExp(server.rootDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    await server.close();
  }
});

test('research-intel web app ignores partial daily directories when computing latest snapshot', async () => {
  const server = await startServer();
  try {
    const partialDir = path.join(server.rootDir, 'research-intel-records', 'daily', '2026-03-14.partial-002946');
    writeJson(path.join(partialDir, 'manifest.json'), {
      date: '2026-03-14.partial-002946',
      selectedCount: 0,
      selectedTitles: []
    });
    writeJson(path.join(partialDir, 'selected_papers.json'), []);

    const login = await fetch(`${server.baseUrl}/research-intel/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ password: 'secret-pass' }),
      redirect: 'manual'
    });
    const cookie = extractCookie(login);

    const dashboard = await fetch(`${server.baseUrl}/research-intel/`, {
      headers: {
        cookie
      }
    });
    const html = await dashboard.text();
    assert.equal(dashboard.status, 200);
    assert.match(html, /最近一次日报共收录 1 篇主推论文、1 篇观察池论文，最新日期 2026-03-14/);
    assert.doesNotMatch(html, /2026-03-14\.partial-002946/);
  } finally {
    await server.close();
  }
});

test('research-intel web app renders daily page and serves paper html', async () => {
  const server = await startServer();
  try {
    const login = await fetch(`${server.baseUrl}/research-intel/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ password: 'secret-pass' }),
      redirect: 'manual'
    });
    const cookie = extractCookie(login);

    const daily = await fetch(`${server.baseUrl}/research-intel/daily/2026-03-14`, {
      headers: {
        cookie
      }
    });
    const dailyHtml = await daily.text();
    assert.equal(daily.status, 200);
    assert.match(dailyHtml, /总编路线/);
    assert.match(dailyHtml, /先看主问题，再看具体实现/);
    assert.match(dailyHtml, /Demo Paper/);
    assert.match(dailyHtml, /观察池/);
    assert.match(dailyHtml, /Older Neighbor Paper/);
    assert.match(dailyHtml, /投递状态/);
    assert.match(dailyHtml, /1 \/ 2/);
    assert.match(dailyHtml, /\/research-intel\/files\/work\/research-intel\/daily\/2026-03-14\/papers\/01-demo-paper\/index.html/);
    assert.match(dailyHtml, /https:\/\/hjfy\.top\/arxiv\/1234\.5678v2/);
    assert.match(dailyHtml, /https:\/\/arxiv\.org\/pdf\/9999\.0001v1/);

    const paper = await fetch(`${server.baseUrl}/research-intel/files/work/research-intel/daily/2026-03-14/papers/01-demo-paper/index.html`, {
      headers: {
        cookie
      }
    });
    const paperHtml = await paper.text();
    assert.equal(paper.status, 200);
    assert.match(paperHtml, /Demo Paper HTML/);
  } finally {
    await server.close();
  }
});

test('research-intel web app strips frontmatter and renders markdown tables on daily detail pages', async () => {
  const server = await startServer();
  try {
    writeText(path.join(server.rootDir, 'research-intel-records', 'daily', '2026-03-14', 'brief.md'), [
      '---',
      'date: 2026-03-14',
      'model: gpt-5.4',
      '---',
      '',
      '# 今日简报',
      '',
      '| 论文 | 为什么今天看 |',
      '| --- | --- |',
      '| Demo Paper | 因为它很新。 |'
    ].join('\n'));

    const login = await fetch(`${server.baseUrl}/research-intel/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ password: 'secret-pass' }),
      redirect: 'manual'
    });
    const cookie = extractCookie(login);

    const daily = await fetch(`${server.baseUrl}/research-intel/daily/2026-03-14`, {
      headers: {
        cookie
      }
    });
    const html = await daily.text();
    assert.equal(daily.status, 200);
    assert.doesNotMatch(html, /timezone: Asia\/Shanghai/);
    assert.match(html, /<table class="table">/);
    assert.match(html, /<th>论文<\/th>/);
    assert.match(html, /<td>Demo Paper<\/td>/);
  } finally {
    await server.close();
  }
});

test('research-intel web app allows manual rerun when runtime is stale instead of blocking forever', async () => {
  const server = await startServer({
    rootDir: (() => {
      const fixture = createFixture();
      writeJson(path.join(fixture.rootDir, 'work', 'research-intel', 'runtime', 'current-run.json'), {
        date: '2026-03-15',
        status: 'stale',
        sessionName: 'research-intel-codex-20260315'
      });
      writeJson(path.join(fixture.rootDir, 'work', 'research-intel', 'runtime', 'heartbeat.json'), {
        alive: true,
        stale: true,
        lastNonEmptyLine: 'still stale'
      });
      return fixture.rootDir;
    })()
  });
  try {
    const login = await fetch(`${server.baseUrl}/research-intel/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ password: 'secret-pass' }),
      redirect: 'manual'
    });
    const cookie = extractCookie(login);

    const run = await fetch(`${server.baseUrl}/research-intel/actions/run`, {
      method: 'POST',
      headers: {
        cookie
      },
      redirect: 'manual'
    });
    assert.equal(run.status, 303);
    assert.equal(run.headers.get('location'), '/research-intel/?triggered=1');
  } finally {
    await server.close();
  }
});

test('summarizeHeartbeatState ignores stale current-run monitorPid when the pid file is absent', () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-web-runtime-'));
  const runtimePaths = {
    monitorPidPath: path.join(runtimeDir, 'heartbeat-monitor.pid')
  };
  const originalKill = process.kill;
  process.kill = pid => {
    if (pid === 321) {
      return true;
    }
    const error = new Error('no such process');
    error.code = 'ESRCH';
    throw error;
  };

  try {
    const heartbeat = summarizeHeartbeatState(
      runtimePaths,
      {
        status: 'completed',
        monitorPid: 321
      },
      {
        checkedAt: new Date().toISOString()
      }
    );
    assert.equal(heartbeat.monitorAlive, false);
    assert.equal(heartbeat.historical, true);
  } finally {
    process.kill = originalKill;
  }
});

test('research-intel web app renders knowledge page from structured method tree json', async () => {
  const server = await startServer();
  try {
    const login = await fetch(`${server.baseUrl}/research-intel/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ password: 'secret-pass' }),
      redirect: 'manual'
    });
    const cookie = extractCookie(login);

    const knowledge = await fetch(`${server.baseUrl}/research-intel/knowledge`, {
      headers: {
        cookie
      }
    });
    const html = await knowledge.text();
    assert.equal(knowledge.status, 200);
    assert.match(html, /长期研究主线/);
    assert.match(html, /Open-Ended Evolution/);
    assert.match(html, /Demo Paper/);
  } finally {
    await server.close();
  }
});

test('research-intel web app does not expose runtime env or profile secrets through file viewer', async () => {
  const server = await startServer();
  try {
    const login = await fetch(`${server.baseUrl}/research-intel/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ password: 'secret-pass' }),
      redirect: 'manual'
    });
    const cookie = extractCookie(login);

    const secretFile = await fetch(`${server.baseUrl}/research-intel/files/work/research-intel/profile/runtime.env`, {
      headers: {
        cookie
      }
    });
    assert.equal(secretFile.status, 404);
  } finally {
    await server.close();
  }
});

test('research-intel web app saves research brief content', async () => {
  const server = await startServer();
  try {
    const login = await fetch(`${server.baseUrl}/research-intel/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ password: 'secret-pass' }),
      redirect: 'manual'
    });
    const cookie = extractCookie(login);

    const save = await fetch(`${server.baseUrl}/research-intel/settings/brief`, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ content: '# Updated Brief\n\n## Current Goal\n- 新目标\n' }),
      redirect: 'manual'
    });
    assert.equal(save.status, 303);
    assert.equal(save.headers.get('location'), '/research-intel/settings?saved=brief');
    assert.match(fs.readFileSync(path.join(server.profileDir, 'research_brief.md'), 'utf8'), /Updated Brief/);
  } finally {
    await server.close();
  }
});

test('research-intel web app upserts seed papers and triggers manual run', async () => {
  const server = await startServer();
  try {
    const login = await fetch(`${server.baseUrl}/research-intel/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ password: 'secret-pass' }),
      redirect: 'manual'
    });
    const cookie = extractCookie(login);

    const saveSeed = await fetch(`${server.baseUrl}/research-intel/settings/seeds/save`, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        originalTitle: '',
        title: 'New Seed',
        status: 'read',
        anchor: 'on',
        liked: 'on',
        notes: '新锚点'
      }),
      redirect: 'manual'
    });
    assert.equal(saveSeed.status, 303);
    const seedsText = fs.readFileSync(path.join(server.profileDir, 'seed_papers.jsonl'), 'utf8');
    assert.match(seedsText, /New Seed/);

    const run = await fetch(`${server.baseUrl}/research-intel/actions/run`, {
      method: 'POST',
      headers: {
        cookie
      },
      redirect: 'manual'
    });
    assert.equal(run.status, 303);
    assert.equal(run.headers.get('location'), '/research-intel/?triggered=1');
    assert.equal(server.runInvocations.length, 1);
  } finally {
    await server.close();
  }
});

test('research-intel web app renders onboarding and import controls on settings page', async () => {
  const server = await startServer();
  try {
    const login = await fetch(`${server.baseUrl}/research-intel/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ password: 'secret-pass' }),
      redirect: 'manual'
    });
    const cookie = extractCookie(login);

    const settings = await fetch(`${server.baseUrl}/research-intel/settings`, {
      headers: {
        cookie
      }
    });
    const html = await settings.text();
    assert.equal(settings.status, 200);
    assert.match(html, /首次使用 \/ 研究画像向导/);
    assert.match(html, /论文导入 \/ 批量种子录入/);
    assert.match(html, /保存后立即触发一次今日运行/);
  } finally {
    await server.close();
  }
});

test('research-intel web app bootstraps profile from onboarding form and can trigger a run', async () => {
  const server = await startServer();
  try {
    const login = await fetch(`${server.baseUrl}/research-intel/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ password: 'secret-pass' }),
      redirect: 'manual'
    });
    const cookie = extractCookie(login);

    const response = await fetch(`${server.baseUrl}/research-intel/settings/bootstrap`, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        timezone: 'Asia/Shanghai',
        sendTime: '08:30',
        minPapers: '2',
        targetPapers: '4',
        maxPapers: '6',
        direction: 'ai scientist systems',
        currentGoal: '先搭好研究画像',
        focusKeywords: 'ai scientist, verifier loop',
        positiveSignals: 'verifier loop, memory archive',
        negativeSignals: 'pure survey, product workflow',
        readingPreference: '先解释为什么今天看',
        branchSpecs: '为什么 baseline 不够::需要什么额外机制；什么反馈最有效::哪类 verifier 更有用',
        seedSpecs: 'Seed Alpha|系统初始化锚点',
        replaceFeedback: 'on',
        runAfterSave: 'on'
      }),
      redirect: 'manual'
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/research-intel/settings?saved=bootstrap&triggered=1');
    assert.equal(server.runInvocations.length, 1);

    const brief = fs.readFileSync(path.join(server.profileDir, 'research_brief.md'), 'utf8');
    const taxonomy = JSON.parse(fs.readFileSync(path.join(server.profileDir, 'method_taxonomy.json'), 'utf8'));
    const notes = fs.readFileSync(path.join(server.profileDir, 'method_tree_notes.md'), 'utf8');
    const seeds = fs.readFileSync(path.join(server.profileDir, 'seed_papers.jsonl'), 'utf8');
    const feedback = fs.readFileSync(path.join(server.profileDir, 'feedback.jsonl'), 'utf8');

    assert.match(brief, /ai scientist systems/);
    assert.match(brief, /## Focus Keywords/);
    assert.equal(taxonomy.root_title, 'ai scientist systems');
    assert.equal(taxonomy.branches.length, 2);
    assert.match(notes, /当前长期账本围绕 “ai scientist systems” 展开/);
    assert.match(seeds, /Seed Alpha/);
    assert.match(feedback, /Prefer verifier loop/);
    assert.match(feedback, /Avoid pure survey/);
  } finally {
    await server.close();
  }
});

test('research-intel web app imports papers into seeds and preserves import metadata across manual edits', async () => {
  const server = await startServer({
    resolveImportEntries: async ({ entries, defaults }) => {
      assert.equal(entries.length, 2);
      return [
        {
          title: 'Imported Paper',
          status: defaults.status,
          anchor: defaults.anchor,
          liked: defaults.liked,
          branchId: 'open-ended-evolution',
          notes: 'imported note',
          arxivId: '2603.12345',
          absUrl: 'https://arxiv.org/abs/2603.12345',
          pdfUrl: 'https://arxiv.org/pdf/2603.12345',
          source: 'arxiv',
          directImport: true
        },
        {
          title: 'Manual Title Only',
          status: defaults.status,
          anchor: false,
          liked: false,
          branchId: '',
          notes: 'title only',
          source: 'manual',
          directImport: false
        }
      ];
    }
  });

  try {
    const login = await fetch(`${server.baseUrl}/research-intel/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ password: 'secret-pass' }),
      redirect: 'manual'
    });
    const cookie = extractCookie(login);

    const importResponse = await fetch(`${server.baseUrl}/research-intel/settings/imports/save`, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        entries: '2603.12345 | imported note\nManual Title Only | title only',
        status: 'queued',
        anchor: 'on',
        liked: 'on',
        runAfterSave: 'on'
      }),
      redirect: 'manual'
    });

    assert.equal(importResponse.status, 303);
    assert.equal(importResponse.headers.get('location'), '/research-intel/settings?saved=imports&triggered=1');
    assert.equal(server.runInvocations.length, 1);

    let seeds = fs.readFileSync(path.join(server.profileDir, 'seed_papers.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
    const imported = seeds.find(item => item.title === 'Imported Paper');
    assert.ok(imported);
    assert.equal(imported.arxivId, '2603.12345');
    assert.equal(imported.branchId, 'open-ended-evolution');
    assert.equal(imported.directImport, true);

    const saveSeed = await fetch(`${server.baseUrl}/research-intel/settings/seeds/save`, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        originalTitle: 'Imported Paper',
        title: 'Imported Paper',
        status: 'read',
        notes: 'updated note'
      }),
      redirect: 'manual'
    });

    assert.equal(saveSeed.status, 303);

    seeds = fs.readFileSync(path.join(server.profileDir, 'seed_papers.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
    const updated = seeds.find(item => item.title === 'Imported Paper');
    assert.ok(updated);
    assert.equal(updated.status, 'read');
    assert.equal(updated.notes, 'updated note');
    assert.equal(updated.arxivId, '2603.12345');
    assert.equal(updated.absUrl, 'https://arxiv.org/abs/2603.12345');
    assert.equal(updated.pdfUrl, 'https://arxiv.org/pdf/2603.12345');
    assert.equal(updated.branchId, 'open-ended-evolution');
    assert.equal(updated.directImport, true);
  } finally {
    await server.close();
  }
});
