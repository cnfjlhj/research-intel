#!/usr/bin/env node

const { normalizeTitle } = require('./core');

function slugifyNodeId(text) {
  return normalizeTitle(text).replace(/\s+/g, '-');
}

function createEmptyResearchNetwork() {
  return {
    version: 2,
    updatedAt: null,
    nodes: [],
    edges: []
  };
}

function cloneNetwork(network) {
  return JSON.parse(JSON.stringify(network || createEmptyResearchNetwork()));
}

function upsertNode(network, node) {
  const existing = network.nodes.find(item => item.id === node.id);
  if (existing) {
    Object.assign(existing, node);
    return existing;
  }
  network.nodes.push(node);
  return node;
}

function upsertEdge(network, edge) {
  const existing = network.edges.find(item =>
    item.source === edge.source && item.target === edge.target && item.type === edge.type
  );
  if (existing) {
    Object.assign(existing, edge);
    return existing;
  }
  network.edges.push(edge);
  return edge;
}

function paperNodeId(title) {
  return `paper:${slugifyNodeId(title)}`;
}

function anchorNodeId(title) {
  return `anchor:${slugifyNodeId(title)}`;
}

function topicNodeId(keyword) {
  return `topic:${slugifyNodeId(keyword)}`;
}

function conceptNodeId(text) {
  return `concept:${slugifyNodeId(text)}`;
}

function problemNodeId(text) {
  return `problem:${slugifyNodeId(text)}`;
}

function methodNodeId(text) {
  return `method:${slugifyNodeId(text)}`;
}

function questionNodeId(text) {
  return `open_question:${slugifyNodeId(text)}`;
}

function blogNodeId(url) {
  return `blog:${slugifyNodeId(url)}`;
}

function repoNodeId(fullName) {
  return `repo:${slugifyNodeId(fullName)}`;
}

function safeLabel(text, maxLength = 72) {
  const value = String(text || '').trim();
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function uniqueStrings(items) {
  return [...new Set(
    (items || [])
      .map(item => String(item || '').trim())
      .filter(Boolean)
  )];
}

function splitSentences(text, limit = 2) {
  return String(text || '')
    .split(/(?<=[。！？.!?])\s+|\n+/)
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function summarizeAnchor(text) {
  return splitSentences(text, 1)[0] || String(text || '').trim();
}

function buildPaperIdentifier(paper, meta) {
  if (paper?.arxivId) {
    return `arxiv:${paper.arxivId}`;
  }
  if (meta?.arxiv?.id) {
    return `arxiv:${meta.arxiv.id}`;
  }
  return `paper:${slugifyNodeId(meta?.title || paper?.title || 'unknown-paper')}`;
}

function buildPaperCard({ paper, meta, openreviewSummary, dateString }) {
  const recommendation = meta?.recommendation_context || {};
  const abstract = meta?.abstract || paper?.summary || '';
  const abstractSentences = uniqueStrings(splitSentences(abstract, 2));
  const methodTags = uniqueStrings([
    ...(paper?.matchedKeywords || []),
    ...(paper?.matchedSignals || []),
    ...(recommendation.matched_keywords || []),
    ...(recommendation.matched_signals || [])
  ]);
  const relationToSeeds = uniqueStrings((paper?.relatedSeeds || []).map(seed => seed.title));
  const coreProblem = (
    abstractSentences.length > 0
      ? abstractSentences
      : uniqueStrings([summarizeAnchor(recommendation.reason_today)]).filter(Boolean)
  ).slice(0, 3);
  const mainClaims = abstractSentences.slice(0, 3);
  const limitations = [];
  const openQuestions = [];

  if (/暂无公开 OpenReview 信息/.test(String(openreviewSummary || ''))) {
    limitations.push('公开评审线索有限，局限需要后续从论文实验和外部讨论继续补。');
    openQuestions.push('暂无公开 OpenReview 讨论，后续可继续观察外部反馈。');
  }

  const codeLinks = uniqueStrings((paper?.webCoverage?.codeRepos || []).map(repo => repo.html_url || repo.url));
  const blogLinks = uniqueStrings((paper?.webCoverage?.chineseBlogs || []).map(blog => blog.url));
  const coverageLinks = uniqueStrings((paper?.webCoverage?.coverage || []).map(item => item.url));
  const openreviewForumUrl = meta?.openreview?.forum_url || '';
  const openreviewPdfUrl = meta?.openreview?.pdf_url || '';

  return {
    paper_id: buildPaperIdentifier(paper, meta),
    title: meta?.title || paper?.title || '',
    date: dateString,
    summary_anchor: summarizeAnchor(abstract) || summarizeAnchor(recommendation.reason_today) || paper?.title || '',
    core_problem: coreProblem,
    key_mechanisms: methodTags.slice(0, 4),
    method_tags: methodTags,
    benchmarks: uniqueStrings(meta?.arxiv?.categories || paper?.categories || []).slice(0, 6),
    main_claims: mainClaims,
    limitations,
    relation_to_seeds: relationToSeeds,
    read_after: relationToSeeds,
    open_questions: openQuestions,
    source_links: {
      arxiv_abs: meta?.arxiv?.abs_url || paper?.absUrl || '',
      arxiv_pdf: meta?.arxiv?.pdf_url || paper?.pdfUrl || '',
      openreview_forum: openreviewForumUrl,
      openreview_pdf: openreviewPdfUrl
    },
    availability: {
      has_openreview: Boolean(openreviewForumUrl || openreviewPdfUrl),
      has_open_source_code: codeLinks.length > 0,
      chinese_blog_count: blogLinks.length,
      coverage_count: coverageLinks.length
    },
    openreview_summary: String(openreviewSummary || '').trim(),
    external_links: {
      code: codeLinks,
      blogs: blogLinks,
      coverage: coverageLinks
    }
  };
}

function addTypedRelationNodes(next, paperId, values, { type, nodeId, edgeType, edgeLabel }, dateString) {
  for (const value of uniqueStrings(values)) {
    const targetId = nodeId(value);
    upsertNode(next, {
      id: targetId,
      type,
      label: value,
      firstSeen: dateString,
      lastSeen: dateString
    });
    upsertEdge(next, {
      source: paperId,
      target: targetId,
      type: edgeType,
      label: edgeLabel,
      lastSeen: dateString
    });
  }
}

function updateResearchNetwork({ network, profile, selectedPapers, dateString }) {
  const next = cloneNetwork(network);
  next.version = Math.max(2, Number(next.version || 1));
  next.updatedAt = dateString;

  for (const seed of profile.seeds || []) {
    upsertNode(next, {
      id: anchorNodeId(seed.title),
      type: 'anchor',
      label: seed.title,
      firstSeen: seed.firstSeen || dateString,
      lastSeen: dateString
    });
  }

  for (const paper of selectedPapers || []) {
    const paperId = paperNodeId(paper.title);
    const paperCard = paper.paperCard || buildPaperCard({
      paper,
      meta: paper.paperMeta || {},
      openreviewSummary: paper.openreviewSummary,
      dateString
    });

    upsertNode(next, {
      id: paperId,
      type: 'paper',
      label: paper.title,
      arxivId: paper.arxivId || '',
      published: paper.published || '',
      paperId: paperCard.paper_id,
      firstSeen: dateString,
      lastSeen: dateString
    });

    for (const seed of paper.relatedSeeds || []) {
      const seedId = anchorNodeId(seed.title);
      upsertNode(next, {
        id: seedId,
        type: 'anchor',
        label: seed.title,
        firstSeen: dateString,
        lastSeen: dateString
      });
      upsertEdge(next, {
        source: paperId,
        target: seedId,
        type: 'related_seed',
        label: '关联锚点',
        lastSeen: dateString
      });
    }

    for (const keyword of paper.matchedKeywords || []) {
      const keywordId = topicNodeId(keyword);
      upsertNode(next, {
        id: keywordId,
        type: 'topic',
        label: keyword,
        firstSeen: dateString,
        lastSeen: dateString
      });
      upsertEdge(next, {
        source: paperId,
        target: keywordId,
        type: 'matched_keyword',
        label: '命中关键词',
        lastSeen: dateString
      });
    }

    addTypedRelationNodes(next, paperId, paperCard.core_problem, {
      type: 'problem',
      nodeId: problemNodeId,
      edgeType: 'addresses',
      edgeLabel: '解决问题'
    }, dateString);

    addTypedRelationNodes(next, paperId, paperCard.method_tags, {
      type: 'concept',
      nodeId: conceptNodeId,
      edgeType: 'uses',
      edgeLabel: '方法标签'
    }, dateString);

    addTypedRelationNodes(next, paperId, paperCard.key_mechanisms, {
      type: 'method',
      nodeId: methodNodeId,
      edgeType: 'implements',
      edgeLabel: '关键机制'
    }, dateString);

    addTypedRelationNodes(next, paperId, paperCard.open_questions, {
      type: 'open_question',
      nodeId: questionNodeId,
      edgeType: 'inspires',
      edgeLabel: '待观察'
    }, dateString);

    for (const blog of paper.webCoverage?.chineseBlogs || []) {
      const blogId = blogNodeId(blog.url);
      upsertNode(next, {
        id: blogId,
        type: 'blog',
        label: blog.title,
        url: blog.url,
        domain: blog.domain,
        firstSeen: dateString,
        lastSeen: dateString
      });
      upsertEdge(next, {
        source: paperId,
        target: blogId,
        type: 'has_blog',
        label: '中文博客',
        lastSeen: dateString
      });
    }

    for (const repo of paper.webCoverage?.codeRepos || []) {
      const repoId = repoNodeId(repo.full_name);
      upsertNode(next, {
        id: repoId,
        type: 'repo',
        label: repo.full_name,
        url: repo.html_url,
        stars: repo.stargazers_count || 0,
        firstSeen: dateString,
        lastSeen: dateString
      });
      upsertEdge(next, {
        source: paperId,
        target: repoId,
        type: 'has_code',
        label: '开源代码',
        lastSeen: dateString
      });
    }

    for (const seedTitle of paperCard.read_after || []) {
      const seedId = anchorNodeId(seedTitle);
      upsertNode(next, {
        id: seedId,
        type: 'anchor',
        label: seedTitle,
        firstSeen: dateString,
        lastSeen: dateString
      });
      upsertEdge(next, {
        source: paperId,
        target: seedId,
        type: 'read_after',
        label: '顺着读',
        lastSeen: dateString
      });
    }
  }

  return next;
}

function edgeKey(edge) {
  return `${edge.source}::${edge.type}::${edge.target}`;
}

function buildNetworkDelta(previousNetwork, nextNetwork) {
  const previousNodes = new Map((previousNetwork?.nodes || []).map(node => [node.id, node]));
  const nextNodes = new Map((nextNetwork?.nodes || []).map(node => [node.id, node]));
  const previousEdges = new Map((previousNetwork?.edges || []).map(edge => [edgeKey(edge), edge]));
  const nextEdges = new Map((nextNetwork?.edges || []).map(edge => [edgeKey(edge), edge]));

  const addedNodes = [...nextNodes.values()].filter(node => !previousNodes.has(node.id));
  const removedNodes = [...previousNodes.values()].filter(node => !nextNodes.has(node.id));
  const addedEdges = [...nextEdges.values()].filter(edge => !previousEdges.has(edgeKey(edge)));
  const removedEdges = [...previousEdges.values()].filter(edge => !nextEdges.has(edgeKey(edge)));

  return {
    addedNodes,
    removedNodes,
    addedEdges,
    removedEdges,
    summary: `新增节点 ${addedNodes.length}，新增边 ${addedEdges.length}，删除节点 ${removedNodes.length}，删除边 ${removedEdges.length}`
  };
}

function mermaidNode(node) {
  return `  ${node.id.replace(/[^a-zA-Z0-9_:-]/g, '_')}["${safeLabel(node.label).replace(/"/g, "'")}"]`;
}

function mermaidEdge(edge) {
  const source = edge.source.replace(/[^a-zA-Z0-9_:-]/g, '_');
  const target = edge.target.replace(/[^a-zA-Z0-9_:-]/g, '_');
  return `  ${source} -->|${safeLabel(edge.label, 18).replace(/"/g, "'")}| ${target}`;
}

function renderResearchNetworkMarkdown(network) {
  const nodes = [...(network.nodes || [])]
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, 40);
  const nodeIds = new Set(nodes.map(node => node.id));
  const edges = (network.edges || []).filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const typeCounts = (network.nodes || []).reduce((accumulator, node) => {
    accumulator[node.type] = (accumulator[node.type] || 0) + 1;
    return accumulator;
  }, {});

  const lines = [
    '# Research Network',
    '',
    `- 更新时间：${network.updatedAt || 'unknown'}`,
    `- 节点数：${(network.nodes || []).length}`,
    `- 边数：${(network.edges || []).length}`,
    `- 类型分布：${Object.entries(typeCounts).map(([type, count]) => `${type} ${count}`).join('；') || '暂无'}`,
    '',
    '```mermaid',
    'graph LR'
  ];

  for (const node of nodes) {
    lines.push(mermaidNode(node));
  }
  for (const edge of edges) {
    lines.push(mermaidEdge(edge));
  }
  lines.push('```');
  lines.push('');
  lines.push('## Recent Papers');

  for (const node of nodes.filter(item => item.type === 'paper').slice(0, 10)) {
    lines.push(`- ${node.label}`);
  }

  lines.push('');
  return lines.join('\n');
}

module.exports = {
  buildNetworkDelta,
  buildPaperCard,
  createEmptyResearchNetwork,
  renderResearchNetworkMarkdown,
  slugifyNodeId,
  updateResearchNetwork
};
