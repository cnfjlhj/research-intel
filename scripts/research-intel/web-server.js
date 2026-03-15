#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const { createResearchIntelWebApp } = require('./lib/web');

const ROOT_DIR = path.join(__dirname, '../..');
const RUNTIME_ENV_PATH = path.join(ROOT_DIR, 'work', 'research-intel', 'profile', 'runtime.env');

dotenv.config({ path: path.join(ROOT_DIR, '.env'), quiet: true });
if (fs.existsSync(RUNTIME_ENV_PATH)) {
  dotenv.config({ path: RUNTIME_ENV_PATH, quiet: true, override: true });
}

const port = Number(process.env.RESEARCH_INTEL_WEB_PORT || '3086');
const host = process.env.RESEARCH_INTEL_WEB_HOST || '0.0.0.0';
const sitePassword = process.env.RESEARCH_INTEL_WEB_PASSWORD || '';
const sessionSecret = process.env.RESEARCH_INTEL_WEB_SESSION_SECRET || '';

if (!sitePassword) {
  throw new Error('Missing RESEARCH_INTEL_WEB_PASSWORD runtime configuration.');
}

const app = createResearchIntelWebApp({
  rootDir: ROOT_DIR,
  sitePassword,
  sessionSecret
});

app.listen(port, host, () => {
  console.log(`research-intel web listening on http://${host}:${port}${'/research-intel/'}`);
});
