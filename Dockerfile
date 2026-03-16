FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    chromium \
    curl \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    git \
    lsof \
    poppler-utils \
    procps \
    tmux \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g @openai/codex@0.114.0

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

RUN mkdir -p \
  /app/work/research-intel/profile \
  /app/work/research-intel/runtime \
  /app/research-intel-records/daily \
  /app/research-intel-records/history \
  /app/research-intel-records/knowledge \
  /app/research-intel-records/papers \
  /app/logs/research-intel

CMD ["node", "scripts/research-intel/web-server.js"]
