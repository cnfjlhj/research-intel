#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildEnrichmentQueries,
  parseBingRss,
  parseDuckDuckGoHtml,
  selectChineseBlogResults,
  dedupeSearchResults,
  selectCoverageResults,
  selectRelevantGitHubRepos
} = require('../scripts/research-intel/lib/discovery');

test('parseDuckDuckGoHtml extracts title, url, snippet, and domain from ddg html', () => {
  const html = `
    <div class="result results_links results_links_deep web-result ">
      <div class="links_main links_deep result__body">
        <h2 class="result__title">
          <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fzhuanlan.zhihu.com%2Fp%2F123456&amp;rut=abc">SAHOO 论文解读</a>
        </h2>
        <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fzhuanlan.zhihu.com%2Fp%2F123456&amp;rut=abc">这是一篇中文长文解读。</a>
      </div>
    </div>`;

  const results = parseDuckDuckGoHtml(html);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'SAHOO 论文解读');
  assert.equal(results[0].url, 'https://zhuanlan.zhihu.com/p/123456');
  assert.equal(results[0].domain, 'zhuanlan.zhihu.com');
  assert.match(results[0].snippet, /中文长文解读/);
});

test('parseBingRss extracts title, url, snippet, and domain from rss items', () => {
  const xml = `<?xml version="1.0" encoding="utf-8" ?>
    <rss version="2.0"><channel>
      <item>
        <title>SAHOO 论文解读</title>
        <link>https://zhuanlan.zhihu.com/p/123456</link>
        <description>中文详细解读</description>
        <pubDate>Fri, 13 Mar 2026 00:00:00 GMT</pubDate>
      </item>
    </channel></rss>`;

  const results = parseBingRss(xml);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'SAHOO 论文解读');
  assert.equal(results[0].url, 'https://zhuanlan.zhihu.com/p/123456');
  assert.equal(results[0].domain, 'zhuanlan.zhihu.com');
  assert.match(results[0].snippet, /中文详细解读/);
});

test('selectChineseBlogResults prefers Chinese longform domains and filters paper/source links', () => {
  const results = [
    {
      title: 'SAHOO: arXiv',
      url: 'https://arxiv.org/abs/2603.06333',
      domain: 'arxiv.org',
      snippet: 'paper abstract'
    },
    {
      title: 'SAHOO 论文精读',
      url: 'https://zhuanlan.zhihu.com/p/123456',
      domain: 'zhuanlan.zhihu.com',
      snippet: '中文详细解读'
    },
    {
      title: 'SAHOO 代码',
      url: 'https://github.com/foo/sahoo',
      domain: 'github.com',
      snippet: 'repo'
    },
    {
      title: '机器之心 | SAHOO 解读',
      url: 'https://www.jiqizhixin.com/articles/sahoo',
      domain: 'www.jiqizhixin.com',
      snippet: '中文报道'
    }
  ];

  const selected = selectChineseBlogResults(results, 3);
  assert.deepEqual(
    selected.map(item => item.domain),
    ['zhuanlan.zhihu.com', 'www.jiqizhixin.com']
  );
});

test('selectChineseBlogResults drops noisy qa domains even when the query token overlaps', () => {
  const selected = selectChineseBlogResults([
    {
      title: 'multi是什么意思_百度知道',
      url: 'https://zhidao.baidu.com/question/230130235.html',
      domain: 'zhidao.baidu.com',
      snippet: 'multi 的意思是多'
    },
    {
      title: 'MADA 论文解读',
      url: 'https://zhuanlan.zhihu.com/p/7654321',
      domain: 'zhuanlan.zhihu.com',
      snippet: '一篇较长的中文解读'
    }
  ], 3);

  assert.deepEqual(
    selected.map(item => item.domain),
    ['zhuanlan.zhihu.com']
  );
});

test('selectCoverageResults drops noisy qa links from general coverage', () => {
  const selected = selectCoverageResults([
    {
      title: 'multi是什么意思_百度知道',
      url: 'https://zhidao.baidu.com/question/230130235.html',
      domain: 'zhidao.baidu.com',
      snippet: 'multi 的意思是多'
    },
    {
      title: '机器之心 | MADA 论文速读',
      url: 'https://www.jiqizhixin.com/articles/mada',
      domain: 'www.jiqizhixin.com',
      snippet: 'MADA 相关报道'
    }
  ], 4);

  assert.deepEqual(
    selected.map(item => item.domain),
    ['www.jiqizhixin.com']
  );
});

test('selectCoverageResults rejects dictionary-style matches that only overlap on generic title words', () => {
  const selected = selectCoverageResults([
    {
      title: 'Evolvingの意味・使い方・読み方 | Weblio英和辞書',
      url: 'https://ejje.weblio.jp/content/Evolving',
      domain: 'ejje.weblio.jp',
      snippet: 'evolving の意味と使い方'
    },
    {
      title: 'Evolving Deception 论文解读',
      url: 'https://zhuanlan.zhihu.com/p/99887766',
      domain: 'zhuanlan.zhihu.com',
      snippet: '聚焦 deception 风险与 self-evolving agents'
    }
  ], 4, 'Evolving Deception: When Agents Evolve, Deception Wins');

  assert.deepEqual(
    selected.map(item => item.domain),
    ['zhuanlan.zhihu.com']
  );
});

test('selectChineseBlogResults requires paper-specific overlap instead of generic multilingual token matches', () => {
  const selected = selectChineseBlogResults([
    {
      title: 'ネイティブに聞いた「Evolve」の意味 ネイティブの実際の使い ...',
      url: 'https://binge-reading.com/archives/4732',
      domain: 'binge-reading.com',
      snippet: 'Evolve 的含义与例句'
    },
    {
      title: 'Evolving Deception 论文精读',
      url: 'https://zhuanlan.zhihu.com/p/11223344',
      domain: 'zhuanlan.zhihu.com',
      snippet: '围绕 deception 与 self-evolving agents 的风险分析'
    }
  ], 3, 'Evolving Deception: When Agents Evolve, Deception Wins');

  assert.deepEqual(
    selected.map(item => item.domain),
    ['zhuanlan.zhihu.com']
  );
});

test('dedupeSearchResults removes duplicate urls while preserving order', () => {
  const deduped = dedupeSearchResults([
    { title: 'A', url: 'https://a.com/x', domain: 'a.com', snippet: '' },
    { title: 'B', url: 'https://a.com/x', domain: 'a.com', snippet: '' },
    { title: 'C', url: 'https://b.com/y', domain: 'b.com', snippet: '' }
  ]);

  assert.deepEqual(deduped.map(item => item.title), ['A', 'C']);
});

test('selectRelevantGitHubRepos keeps likely paper repos and drops unrelated matches', () => {
  const repos = [
    {
      full_name: 'SubramanyamSahoo/SAHOO-Safeguarded-Alignment-for-High-Order-Optimization-Objectives-in-Recursive-Self-Improvement',
      html_url: 'https://github.com/SubramanyamSahoo/SAHOO-Safeguarded-Alignment-for-High-Order-Optimization-Objectives-in-Recursive-Self-Improvement',
      description: 'Official code for the SAHOO paper',
      stargazers_count: 42
    },
    {
      full_name: 'random-user/alignment-notes',
      html_url: 'https://github.com/random-user/alignment-notes',
      description: 'Some unrelated alignment notes',
      stargazers_count: 2
    }
  ];

  const selected = selectRelevantGitHubRepos({
    repos,
    paperTitle: 'SAHOO: Safeguarded Alignment for High-Order Optimization Objectives in Recursive Self-Improvement',
    arxivId: '2603.06333'
  });

  assert.equal(selected.length, 1);
  assert.match(selected[0].full_name, /SAHOO/i);
});

test('buildEnrichmentQueries adds arxiv-id and site-targeted chinese blog lookups', () => {
  const queries = buildEnrichmentQueries({
    paperTitle: 'Group-Evolving Agents: Open-Ended Self-Improvement via Experience Sharing',
    arxivId: '2603.12345v2'
  });

  assert.ok(queries.generalQueries.includes('2603.12345'));
  assert.ok(queries.zhQueries.includes('2603.12345 论文 解读'));
  assert.ok(queries.zhQueries.some(query => query.includes('site:zhuanlan.zhihu.com')));
  assert.ok(queries.zhQueries.some(query => query.includes('site:mp.weixin.qq.com')));
});
