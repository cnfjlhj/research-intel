#!/usr/bin/env node

function normalizeTitleForPaperhash(title) {
  return String(title || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/-/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function buildPaperhash(title, authors = []) {
  if (!authors.length) {
    return null;
  }
  const firstAuthor = authors[0].trim().split(/\s+/).pop().toLowerCase();
  return `${firstAuthor}|${normalizeTitleForPaperhash(title)}`;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'research-intel-bot/0.1 (+local)'
    }
  });
  if (!response.ok) {
    throw new Error(`OpenReview request failed (${response.status})`);
  }
  return response.json();
}

async function fetchOpenReviewForPaper(title, authors) {
  const paperhash = buildPaperhash(title, authors);
  if (!paperhash) {
    return null;
  }

  const submission = await fetchJson(`https://api2.openreview.net/notes?paperhash=${encodeURIComponent(paperhash)}`);
  if (!submission.notes || submission.notes.length === 0) {
    return null;
  }

  const forumId = submission.notes[0].forum || submission.notes[0].id;
  const thread = await fetchJson(`https://api2.openreview.net/notes?forum=${encodeURIComponent(forumId)}&limit=1000`);
  return { submission, thread, forumId, paperhash };
}

function summarizeOpenReviewThread(thread) {
  if (!thread || !thread.notes || thread.notes.length === 0) {
    return '暂无公开 OpenReview 信息。';
  }

  const notes = thread.notes;
  const decision = notes.find(note => (note.invitations || []).some(value => value.includes('/-/Decision')));
  const metaReview = notes.find(note => (note.invitations || []).some(value => value.includes('/-/Meta_Review')));
  const officialReviews = notes.filter(note => (note.invitations || []).some(value => value.includes('/-/Official_Review')));
  const rebuttals = notes.filter(note => (note.invitations || []).some(value => value.includes('/-/Official_Comment')));

  const lines = [];
  if (decision?.content?.decision?.value) {
    lines.push(`Decision: ${decision.content.decision.value}`);
  }
  if (metaReview?.content?.summary?.value) {
    lines.push(`Meta Review: ${metaReview.content.summary.value}`);
  }
  if (officialReviews.length > 0) {
    lines.push(`Official Reviews: ${officialReviews.length} 条公开评审。`);
  }
  if (rebuttals.length > 0) {
    lines.push(`Rebuttal: ${rebuttals.length} 条公开作者回应。`);
  }

  return lines.length > 0 ? lines.join('\n') : '暂无可提炼的公开 OpenReview 摘要。';
}

module.exports = {
  buildPaperhash,
  fetchOpenReviewForPaper,
  summarizeOpenReviewThread
};
