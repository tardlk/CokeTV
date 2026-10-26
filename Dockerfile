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
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates util-linux \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY src ./src
COPY LICENSES ./LICENSES
COPY engine ./engine
COPY scripts/check-shell.mjs scripts/verify.mjs scripts/prepare-container-data.mjs ./scripts/
COPY scripts/docker-entrypoint.sh /usr/local/bin/coketv-entrypoint
RUN chmod 755 /usr/local/bin/coketv-entrypoint && command -v setpriv
RUN node scripts/check-shell.mjs
# Startup fixes only data ownership/modes, then execs the service without root or capabilities.
RUN mkdir -p /app/data && chown -R node:node /app/data
ENV NODE_ENV=production TZ=Asia/Shanghai PORT=54058 HOST=0.0.0.0 HOME=/home/node
USER root
ENTRYPOINT ["/usr/local/bin/coketv-entrypoint"]
VOLUME /app/data
EXPOSE 54058
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD node -e "fetch('http://127.0.0.1:54058/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
