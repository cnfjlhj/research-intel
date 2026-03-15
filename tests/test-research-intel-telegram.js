#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTelegramTransportCandidates,
  getTelegramConfig,
  parseProxyUrl
} = require('../scripts/research-intel/lib/telegram');

test('getTelegramConfig reads bot token, chat id, and optional proxy flags', () => {
  const config = getTelegramConfig({
    TELEGRAM_BOT_TOKEN: 'token',
    TELEGRAM_CHAT_ID: '123',
    TELEGRAM_API_BASE_URL: 'https://example.invalid',
    TELEGRAM_USE_PROXY: 'true',
    TELEGRAM_PROXY_URL: 'http://127.0.0.1:7890'
  });

  assert.equal(config.botToken, 'token');
  assert.equal(config.chatId, '123');
  assert.equal(config.apiBaseUrl, 'https://example.invalid');
  assert.equal(config.useProxy, true);
  assert.equal(config.proxyUrl, 'http://127.0.0.1:7890');
});

test('parseProxyUrl converts proxy url into axios proxy config', () => {
  assert.deepEqual(parseProxyUrl('http://127.0.0.1:7890'), {
    protocol: 'http',
    host: '127.0.0.1',
    port: 7890
  });
});

test('buildTelegramTransportCandidates prefers explicit proxy, then detected local proxies, then direct', async () => {
  const candidates = await buildTelegramTransportCandidates(
    {
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_CHAT_ID: '123',
      TELEGRAM_USE_PROXY: 'true',
      TELEGRAM_PROXY_URL: 'http://10.0.0.1:9000'
    },
    {
      portChecker: async (_host, port) => port === 7890
    }
  );

  assert.deepEqual(candidates, [
    {
      label: 'proxy:http://10.0.0.1:9000',
      proxyUrl: 'http://10.0.0.1:9000'
    },
    {
      label: 'proxy:http://127.0.0.1:7890',
      proxyUrl: 'http://127.0.0.1:7890'
    },
    {
      label: 'direct',
      proxyUrl: ''
    }
  ]);
});

test('buildTelegramTransportCandidates deduplicates identical explicit and local proxies', async () => {
  const candidates = await buildTelegramTransportCandidates(
    {
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_CHAT_ID: '123',
      TELEGRAM_USE_PROXY: 'true',
      TELEGRAM_PROXY_URL: 'http://127.0.0.1:7890'
    },
    {
      portChecker: async (_host, port) => port === 7890
    }
  );

  assert.deepEqual(candidates, [
    {
      label: 'proxy:http://127.0.0.1:7890',
      proxyUrl: 'http://127.0.0.1:7890'
    },
    {
      label: 'direct',
      proxyUrl: ''
    }
  ]);
});
