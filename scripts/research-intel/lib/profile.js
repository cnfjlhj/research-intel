#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const { normalizeTitle, parseResearchBrief } = require('./core');

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function loadProfile(profileDir) {
  const briefPath = path.join(profileDir, 'research_brief.md');
  const seedsPath = path.join(profileDir, 'seed_papers.jsonl');
  const feedbackPath = path.join(profileDir, 'feedback.jsonl');
  const methodTaxonomyPath = path.join(profileDir, 'method_taxonomy.json');
  const methodTreeNotesPath = path.join(profileDir, 'method_tree_notes.md');

  const brief = fs.readFileSync(briefPath, 'utf8');
  const profile = parseResearchBrief(brief);
  const seeds = readJsonl(seedsPath);
  const feedback = readJsonl(feedbackPath);
  const taxonomyConfig = fs.existsSync(methodTaxonomyPath)
    ? JSON.parse(fs.readFileSync(methodTaxonomyPath, 'utf8'))
    : {};

  profile.seeds = seeds;
  profile.feedback = feedback;
  profile.methodTreeNotes = fs.existsSync(methodTreeNotesPath)
    ? fs.readFileSync(methodTreeNotesPath, 'utf8')
    : '';
  profile.rootTitle = taxonomyConfig.root_title || 'Self-Evolving Agents';
  profile.methodTaxonomy = Array.isArray(taxonomyConfig.branches) ? taxonomyConfig.branches : [];
  profile.readTitles = new Set(
    seeds
      .filter(item => item.status === 'read')
      .map(item => normalizeTitle(item.title))
  );

  return profile;
}

module.exports = {
  loadProfile,
  readJsonl
};
