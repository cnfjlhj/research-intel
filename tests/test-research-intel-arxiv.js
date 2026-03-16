#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPdfCandidateUrls,
  buildSearchQueries,
  fetchArxivEntriesByIds,
  parseArxivFeed
} = require('../scripts/research-intel/lib/arxiv');

test('parseArxivFeed keeps the versioned pdf url from the feed when available', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <id>http://arxiv.org/abs/2505.07757v2</id>
        <title>Emotion-Gradient Metacognitive RSI</title>
        <summary>Test summary.</summary>
        <published>2025-05-12T17:02:47Z</published>
        <updated>2026-03-04T12:15:01Z</updated>
        <author><name>Rintaro Ando</name></author>
        <link href="https://arxiv.org/pdf/2505.07757v2" rel="related" type="application/pdf" title="pdf"/>
      </entry>
    </feed>`;

  const [paper] = parseArxivFeed(xml);
  assert.equal(paper.pdfUrl, 'https://arxiv.org/pdf/2505.07757v2');
});

test('buildPdfCandidateUrls expands to versioned and .pdf fallbacks without duplicates', () => {
  const urls = buildPdfCandidateUrls({
    arxivId: '2505.07757',
    absUrl: 'http://arxiv.org/abs/2505.07757v2',
    pdfUrl: 'https://arxiv.org/pdf/2505.07757'
  });

  assert.deepEqual(urls, [
    'https://arxiv.org/pdf/2505.07757',
    'https://arxiv.org/pdf/2505.07757.pdf',
    'https://arxiv.org/pdf/2505.07757v2',
    'https://arxiv.org/pdf/2505.07757v2.pdf'
  ]);
});

test('buildSearchQueries expands beyond generic focus keywords using signals, taxonomy, and liked feedback', () => {
  const queries = buildSearchQueries({
    focusKeywords: [
      'self-evolving agents',
      'recursive self-improvement',
      'automated discovery'
    ],
    positiveSignals: [
      'experience sharing',
      'meta-evolution'
    ],
    feedback: [
      {
        liked: true,
        notes: 'Prefer verifier-guided memory archive loops over broad application-only stories.'
      }
    ],
    methodTaxonomy: [
      {
        id: 'experience-accumulation',
        title: '如何让经验被持续积累',
        keywords: ['memory archive', 'verifier loop']
      }
    ]
  });

  const combined = queries.join('\n');
  assert.match(combined, /all:"self-evolving agents"/);
  assert.match(combined, /all:"self-evolving agents" AND all:"experience sharing"|all:"experience sharing" AND all:"self-evolving agents"/);
  assert.match(combined, /all:"memory archive"/);
  assert.match(combined, /all:"verifier loop"/);
  assert.match(combined, /all:"automated discovery" AND all:"memory archive"|all:"automated discovery" AND all:"verifier loop"/);
});

test('buildSearchQueries avoids overly broad solo themes while keeping concrete method queries', () => {
  const queries = buildSearchQueries({
    focusKeywords: [
      'open-ended evolution',
      'automated discovery',
      'self-evolving agents'
    ],
    positiveSignals: [
      'experience sharing'
    ],
    feedback: [],
    methodTaxonomy: []
  });

  assert.equal(queries.includes('all:"open-ended evolution"'), false);
  assert.equal(queries.includes('all:"automated discovery"'), false);
  assert.ok(queries.includes('all:"self-evolving agents"'));
  assert.ok(queries.includes('all:"self-evolving agents" AND all:"experience sharing"'));
});

test('buildSearchQueries avoids standalone broad-theme queries and prefers compound discovery queries', () => {
  const queries = buildSearchQueries({
    focusKeywords: [
      'self-evolving agents',
      'open-ended evolution',
      'automated discovery',
      'program evolution',
      'meta-evolution'
    ],
    positiveSignals: [
      'evolutionary search',
      'experience sharing'
    ],
    feedback: [],
    methodTaxonomy: []
  });

  assert.equal(queries.includes('all:"open-ended evolution"'), false);
  assert.equal(queries.includes('all:"automated discovery"'), false);
  assert.equal(queries.includes('all:"evolutionary search"'), false);
  assert.equal(queries.includes('all:"program evolution"'), false);
  assert.equal(queries.includes('all:"meta-evolution"'), false);
  assert.ok(queries.some(query => query.includes('all:"automated discovery" AND all:"self-evolving agents"') || query.includes('all:"self-evolving agents" AND all:"automated discovery"')));
  assert.ok(queries.some(query => query.includes('all:"program evolution" AND all:"self-evolving agents"') || query.includes('all:"self-evolving agents" AND all:"program evolution"')));
  assert.ok(queries.some(query => query.includes('all:"meta-evolution" AND all:"self-evolving agents"')));
});

test('buildSearchQueries filters noisy repeated feedback ngrams before turning them into arxiv queries', () => {
  const queries = buildSearchQueries({
    focusKeywords: [
      'self-evolving agents'
    ],
    positiveSignals: [
      'experience sharing'
    ],
    feedback: [
      {
        liked: true,
        notes: 'Need strong code agent baseline beyond code agent harness, not code agent code agent loops.'
      }
    ],
    methodTaxonomy: []
  });

  assert.equal(queries.includes('all:"code agent code agent"'), false);
  assert.equal(queries.includes('all:"agent baseline code agent"'), false);
  assert.equal(queries.includes('all:"agent code agent"'), false);
});

test('buildSearchQueries drops low-signal taxonomy phrases that would broaden the pool too much', () => {
  const queries = buildSearchQueries({
    focusKeywords: [
      'self-evolving agents'
    ],
    positiveSignals: [
      'experience sharing'
    ],
    feedback: [
      {
        liked: true,
        notes: 'Prefer verifier loop and memory archive, not just tool use context stories.'
      }
    ],
    methodTaxonomy: [
      {
        id: 'what-evolves',
        title: '到底让什么东西在演化',
        keywords: ['godel', 'tool use', 'context', 'search policy']
      }
    ]
  });

  assert.equal(queries.includes('all:"godel"'), false);
  assert.equal(queries.includes('all:"tool use"'), false);
  assert.equal(queries.includes('all:"context"'), false);
  assert.ok(queries.includes('all:"search policy"'));
});

test('buildSearchQueries avoids standalone weak efficiency signals but still keeps compound method queries', () => {
  const queries = buildSearchQueries({
    focusKeywords: [
      'self-evolving agents',
      'recursive self-improvement'
    ],
    positiveSignals: [
      'sample efficiency',
      'experience sharing'
    ],
    feedback: [],
    methodTaxonomy: []
  });

  assert.equal(queries.includes('all:"sample efficiency"'), false);
  assert.equal(queries.includes('all:"experience sharing"'), false);
  assert.ok(queries.includes('all:"self-evolving agents" AND all:"sample efficiency"'));
  assert.ok(queries.includes('all:"self-evolving agents" AND all:"experience sharing"'));
});

test('fetchArxivEntriesByIds uses id_list and de-duplicates repeated ids', async () => {
  const originalFetch = global.fetch;
  const seenUrls = [];
  global.fetch = async url => {
    seenUrls.push(String(url));
    return {
      ok: true,
      text: async () => `<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <id>http://arxiv.org/abs/2603.12345v1</id>
            <title>Imported Paper</title>
            <summary>Imported summary.</summary>
            <published>2026-03-12T00:00:00Z</published>
            <updated>2026-03-12T00:00:00Z</updated>
            <author><name>Test Author</name></author>
            <link href="https://arxiv.org/pdf/2603.12345v1" rel="related" type="application/pdf" title="pdf"/>
          </entry>
        </feed>`
    };
  };

  try {
    const papers = await fetchArxivEntriesByIds(['2603.12345', '2603.12345', '2603.99999']);
    assert.equal(seenUrls.length, 1);
    assert.match(seenUrls[0], /id_list=2603\.12345%2C2603\.99999/);
    assert.equal(papers.length, 1);
    assert.equal(papers[0].arxivId, '2603.12345');
  } finally {
    global.fetch = originalFetch;
  }
});
