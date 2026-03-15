#!/usr/bin/env node

const fs = require('fs');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class MinuteRateLimiter {
  constructor(limitPerMinute = 5) {
    this.limitPerMinute = limitPerMinute;
    this.timestamps = [];
  }

  async waitTurn() {
    const now = Date.now();
    this.timestamps = this.timestamps.filter(ts => now - ts < 60_000);
    if (this.timestamps.length < this.limitPerMinute) {
      this.timestamps.push(now);
      return;
    }

    const oldest = this.timestamps[0];
    const waitMs = Math.max(0, 60_000 - (now - oldest) + 250);
    await sleep(waitMs);
    return this.waitTurn();
  }
}

function imageFileToDataUrl(filePath) {
  const ext = filePath.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
  const data = fs.readFileSync(filePath).toString('base64');
  return `data:image/${ext};base64,${data}`;
}

function normalizeMessageContent(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map(item => {
        if (typeof item === 'string') {
          return item;
        }
        if (item?.type === 'text') {
          return item.text || '';
        }
        return '';
      })
      .join('\n')
      .trim();
  }
  return '';
}

async function requestChatOnce({
  apiBaseUrl,
  apiKey,
  model,
  promptText,
  attachedPageImages = [],
  temperature = 0,
  timeoutMs = 60000
}) {
  const content = [
    { type: 'text', text: promptText },
    ...attachedPageImages.map(filePath => ({
      type: 'image_url',
      image_url: {
        url: imageFileToDataUrl(filePath)
      }
    }))
  ];

  let response;
  try {
    response = await fetch(apiBaseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content
          }
        ],
        temperature
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw new Error(`chat completion timed out after ${timeoutMs}ms`);
    }
    throw error;
  }

  const raw = await response.text();
  if (!response.ok) {
    const error = new Error(`chat completions failed (${response.status})`);
    error.status = response.status;
    error.raw = raw;
    throw error;
  }

  const parsed = JSON.parse(raw);
  const message = parsed.choices?.[0]?.message?.content;
  return {
    raw,
    content: normalizeMessageContent(message)
  };
}

async function generateTextWithFallbacks({
  apiBaseUrl,
  apiKey,
  models,
  promptText,
  attachedPageImages = [],
  rateLimiter,
  maxAttemptsPerModel = 2,
  timeoutMs = 60000
}) {
  const failures = [];

  for (const model of models) {
    for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt += 1) {
      await rateLimiter.waitTurn();
      try {
        const result = await requestChatOnce({
          apiBaseUrl,
          apiKey,
          model,
          promptText,
          attachedPageImages,
          timeoutMs
        });
        return {
          ...result,
          model,
          attempt
        };
      } catch (error) {
        failures.push({
          model,
          attempt,
          status: error.status || null,
          message: error.message,
          raw: error.raw || ''
        });

        const retryable = !error.status || error.status === 429 || error.status >= 500;
        if (!retryable) {
          break;
        }
      }
    }
  }

  const summary = failures.map(item => `${item.model}#${item.attempt}: ${item.message}`).join(' | ');
  throw new Error(`All chat completion models failed: ${summary}`);
}

async function generateHtmlWithFallbacks(options) {
  try {
    return await generateTextWithFallbacks(options);
  } catch (error) {
    if (String(error.message || '').startsWith('All chat completion models failed:')) {
      error.message = error.message.replace('All chat completion models failed:', 'All HTML generation models failed:');
    }
    throw error;
  }
}

module.exports = {
  MinuteRateLimiter,
  generateTextWithFallbacks,
  generateHtmlWithFallbacks
};
