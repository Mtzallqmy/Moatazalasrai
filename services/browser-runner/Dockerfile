ARG NODE_VERSION=22.18.0
FROM node:${NODE_VERSION}-bookworm-slim

ENV NODE_ENV=production \
    PORT=8080 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund \
  && npx playwright install --with-deps chromium \
  && groupadd --system --gid 10002 browser \
  && useradd --system --uid 10002 --gid browser --home-dir /home/browser --create-home browser \
  && chown -R browser:browser /app /ms-playwright

COPY --chown=browser:browser services/browser-runner/server.mjs ./server.mjs

USER browser:browser
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
