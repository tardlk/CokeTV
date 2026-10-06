FROM node:22-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web ./web
COPY vite.config.js ./
COPY jsconfig.json components.json ./
RUN npm run build && npm prune --omit=dev

FROM node:22-trixie-slim
WORKDIR /app
ARG INSTALL_BROWSER=0
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv php-cli php-curl php-mbstring php-xml php-sqlite3 ffmpeg ca-certificates \
    && if [ "$INSTALL_BROWSER" = "1" ]; then apt-get install -y --no-install-recommends chromium; fi \
    && rm -rf /var/lib/apt/lists/*
COPY engine/spider/py/base/requirements.txt /tmp/python-requirements.txt
RUN python3 -m venv /opt/python && /opt/python/bin/pip install --no-cache-dir -r /tmp/python-requirements.txt
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY src ./src
COPY engine ./engine
COPY scripts/check-shell.mjs scripts/container-smoke.mjs ./scripts/
RUN node scripts/check-shell.mjs
# 先建好数据目录并交给 node 用户，再声明 VOLUME 并以非 root 运行：
# 挂载新卷时会继承这里的属主，否则 node 用户无法创建 admin.json/state.json。
RUN mkdir -p /app/data && chown -R node:node /app/data
ENV NODE_ENV=production TZ=Asia/Shanghai PORT=54058 HOST=0.0.0.0 PYTHON_PATH=/opt/python/bin/python3 PHP_PATH=php HOME=/home/node
USER node
VOLUME /app/data
EXPOSE 54058
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD node -e "fetch('http://127.0.0.1:54058/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
