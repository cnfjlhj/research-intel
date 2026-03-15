#!/usr/bin/env node

const path = require('path');
const { spawnSync } = require('child_process');

function runGit(args, workdir) {
  const result = spawnSync('git', args, {
    cwd: workdir,
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }

  return (result.stdout || '').trim();
}

function maybeCommitPath({ repoDir, relativePath, message }) {
  runGit(['rev-parse', '--is-inside-work-tree'], repoDir);
  const status = runGit(['status', '--porcelain', '--', relativePath], repoDir);
  if (!status.trim()) {
    return {
      committed: false,
      relativePath,
      commitHash: '',
      message: 'no changes'
    };
  }

  runGit(['add', '--', relativePath], repoDir);
  runGit(['commit', '-m', message, '--', relativePath], repoDir);
  const commitHash = runGit(['rev-parse', 'HEAD'], repoDir);
  return {
    committed: true,
    relativePath,
    commitHash,
    message
  };
}

function relativeToRepo(repoDir, targetPath) {
  return path.relative(repoDir, targetPath);
}

module.exports = {
  maybeCommitPath,
  relativeToRepo
};
