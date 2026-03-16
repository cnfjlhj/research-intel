#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  MinuteRateLimiter,
  generateTextWithFallbacks
} = require('../scripts/research-intel/lib/chat-html');

function startJsonServer(handler) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      handler(JSON.parse(body || '{}'), res);
    });
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function serverUrl(server) {
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

test('generateTextWithFallbacks falls back to the next model after a timeout', async () => {
  const timeoutMs = 100;
  const slowResponseDelayMs = 250;
  const seenModels = [];
  const server = await startJsonServer((payload, res) => {
    seenModels.push(payload.model);
    if (payload.model === 'slow-model') {
      setTimeout(() => {
        if (res.destroyed) {
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          choices: [{ message: { content: 'too late' } }]
        }));
      }, slowResponseDelayMs);
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { content: 'fast answer' } }]
    }));
  });

  try {
    const result = await generateTextWithFallbacks({
      apiBaseUrl: serverUrl(server),
      apiKey: 'test-key',
      models: ['slow-model', 'fast-model'],
      promptText: 'hello',
      rateLimiter: new MinuteRateLimiter(1000),
      maxAttemptsPerModel: 1,
      timeoutMs
    });

    assert.equal(result.model, 'fast-model');
    assert.equal(result.content, 'fast answer');
    assert.ok(seenModels.includes('fast-model'));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('generateTextWithFallbacks reports timeout when every model hangs', async () => {
  const timeoutMs = 100;
  const slowResponseDelayMs = 250;
  const server = await startJsonServer((_payload, res) => {
    setTimeout(() => {
      if (res.destroyed) {
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: 'too late again' } }]
      }));
    }, slowResponseDelayMs);
  });

  try {
    await assert.rejects(
      () => generateTextWithFallbacks({
        apiBaseUrl: serverUrl(server),
        apiKey: 'test-key',
        models: ['slow-model'],
        promptText: 'hello',
        rateLimiter: new MinuteRateLimiter(1000),
        maxAttemptsPerModel: 1,
        timeoutMs
      }),
      /timed out after 100ms/
    );
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
