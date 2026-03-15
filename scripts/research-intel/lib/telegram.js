#!/usr/bin/env node

const fs = require('fs');
const net = require('net');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../../../.env'), quiet: true });

let cachedTransportsPromise = null;

function getTelegramConfig(env = process.env) {
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
  }

  return {
    botToken,
    chatId,
    apiBaseUrl: env.TELEGRAM_API_BASE_URL || 'https://api.telegram.org',
    useProxy: String(env.TELEGRAM_USE_PROXY || '').toLowerCase() === 'true',
    proxyUrl: env.TELEGRAM_PROXY_URL || ''
  };
}

function parseProxyUrl(proxyUrl) {
  const url = new URL(proxyUrl);
  return {
    protocol: url.protocol.replace(':', ''),
    host: url.hostname,
    port: Number(url.port || (url.protocol === 'https:' ? 443 : 80))
  };
}

function candidateKey(candidate) {
  if (!candidate.proxyUrl) {
    return 'direct';
  }
  return `proxy:${candidate.proxyUrl}`;
}

function isRetriableNetworkError(error) {
  const message = String(error?.message || '');
  const code = String(error?.code || '');
  return [
    code.includes('ETIMEDOUT'),
    code.includes('ECONNRESET'),
    code.includes('ECONNREFUSED'),
    code.includes('EHOSTUNREACH'),
    code.includes('ENETUNREACH'),
    /timeout/i.test(message),
    /socket hang up/i.test(message),
    /network error/i.test(message)
  ].some(Boolean);
}

function checkTcpPort(host, port, timeoutMs = 300) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = value => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function buildTelegramTransportCandidates(env = process.env, { portChecker = checkTcpPort } = {}) {
  const config = getTelegramConfig(env);
  const candidates = [];
  const seen = new Set();

  const pushCandidate = candidate => {
    const key = candidateKey(candidate);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    candidates.push(candidate);
  };

  if (config.useProxy && config.proxyUrl) {
    pushCandidate({
      label: `proxy:${config.proxyUrl}`,
      proxyUrl: config.proxyUrl
    });
  }

  if (await portChecker('127.0.0.1', 7890)) {
    pushCandidate({
      label: 'proxy:http://127.0.0.1:7890',
      proxyUrl: 'http://127.0.0.1:7890'
    });
  }

  if (await portChecker('127.0.0.1', 7891)) {
    pushCandidate({
      label: 'proxy:http://127.0.0.1:7891',
      proxyUrl: 'http://127.0.0.1:7891'
    });
  }

  pushCandidate({
    label: 'direct',
    proxyUrl: ''
  });

  return candidates;
}

async function getTelegramTransportCandidates(env = process.env) {
  if (!cachedTransportsPromise) {
    cachedTransportsPromise = buildTelegramTransportCandidates(env);
  }
  return cachedTransportsPromise;
}

function buildAxiosConfig(candidate, extra = {}) {
  const config = {
    timeout: extra.timeout || 30000,
    ...extra
  };

  if (candidate.proxyUrl) {
    config.proxy = parseProxyUrl(candidate.proxyUrl);
  } else {
    config.proxy = false;
  }

  return config;
}

async function requestTelegramWithFallbacks(method, buildAttempt) {
  const config = getTelegramConfig();
  const transports = await getTelegramTransportCandidates();
  const errors = [];

  for (const transport of transports) {
    try {
      const result = await buildAttempt({
        apiBaseUrl: config.apiBaseUrl,
        botToken: config.botToken,
        transport
      });

      if (!result?.data?.ok) {
        throw new Error(`Telegram ${method} failed: ${JSON.stringify(result?.data || {})}`);
      }

      return result.data.result;
    } catch (error) {
      const detail = `${transport.label}: ${error.message || error}`;
      errors.push(detail);
      if (!isRetriableNetworkError(error)) {
        throw new Error(`Telegram ${method} failed via ${detail}`);
      }
    }
  }

  throw new Error(`Telegram ${method} failed after retries: ${errors.join(' | ')}`);
}

async function sendTelegramMessage({ text, disableNotification = false }) {
  const { chatId } = getTelegramConfig();
  return requestTelegramWithFallbacks('sendMessage', async ({ apiBaseUrl, botToken, transport }) => {
    return axios.post(
      `${apiBaseUrl}/bot${botToken}/sendMessage`,
      {
        chat_id: chatId,
        text,
        ...(disableNotification ? { disable_notification: true } : {})
      },
      buildAxiosConfig(transport, {
        timeout: 20000
      })
    );
  });
}

async function sendTelegramDocument({ filePath, caption = '', disableNotification = false }) {
  const { chatId } = getTelegramConfig();
  if (!fs.existsSync(filePath)) {
    throw new Error(`Telegram document not found: ${filePath}`);
  }

  return requestTelegramWithFallbacks('sendDocument', async ({ apiBaseUrl, botToken, transport }) => {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('document', fs.createReadStream(filePath));
    if (caption) {
      form.append('caption', caption);
    }
    if (disableNotification) {
      form.append('disable_notification', 'true');
    }

    return axios.post(
      `${apiBaseUrl}/bot${botToken}/sendDocument`,
      form,
      buildAxiosConfig(transport, {
        timeout: 180000,
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      })
    );
  });
}

module.exports = {
  buildTelegramTransportCandidates,
  getTelegramConfig,
  parseProxyUrl,
  sendTelegramDocument,
  sendTelegramMessage
};
