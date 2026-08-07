ARG NODE_VERSION=22.18.0
FROM node:${NODE_VERSION}-bookworm-slim

ENV NODE_ENV=production \
    PORT=8080 \
    SANDBOX_WORKSPACE_ROOT=/data/workspaces

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    bubblewrap \
    build-essential \
    ca-certificates \
    coreutils \
    git \
    python3 \
    python3-pip \
    python3-venv \
    util-linux \
  && python3 -m venv /opt/moataz-data \
  && /opt/moataz-data/bin/pip install --no-cache-dir \
    numpy==2.3.2 \
    pandas==2.3.1 \
    duckdb==1.3.2 \
    pyarrow==21.0.0 \
    openpyxl==3.1.5 \
    matplotlib==3.10.5 \
    pillow==11.3.0 \
    scipy==1.16.1 \
    jupyter-core==5.8.1 \
  && /opt/moataz-data/bin/python -c "import pandas,numpy,duckdb,pyarrow,openpyxl,matplotlib,PIL,scipy,jupyter_core" \
  && rm -rf /root/.cache /var/lib/apt/lists/* \
  && groupadd --system --gid 10001 sandbox \
  && useradd --system --uid 10001 --gid sandbox --home-dir /home/sandbox --create-home sandbox \
  && mkdir -p /app /data/workspaces \
  && chown -R sandbox:sandbox /app /data

WORKDIR /app
COPY --chown=sandbox:sandbox server.mjs ./server.mjs

USER sandbox:sandbox
EXPOSE 8080
VOLUME ["/data/workspaces"]

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
