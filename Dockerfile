ARG NODE_IMAGE=node:22-bookworm-slim
ARG PYTHON_IMAGE=python:3.11-slim-bookworm

FROM ${NODE_IMAGE} AS frontend
ARG NPM_REGISTRY=https://registry.npmmirror.com
WORKDIR /build/frontend
COPY admin_frontend/package.json admin_frontend/package-lock.json ./
RUN node -e 'const fs = require("fs"); const p = "package-lock.json"; fs.writeFileSync(p, fs.readFileSync(p, "utf8").split("https://registry.npmjs.org").join(process.argv[1].replace(/\/$/, "")));' "$NPM_REGISTRY" \
    && npm ci --registry="$NPM_REGISTRY" --fetch-retries=3 --fetch-timeout=120000 --no-audit --no-fund
COPY admin_frontend/ ./
RUN npm run build

FROM ${NODE_IMAGE} AS spider-node
ARG NPM_REGISTRY=https://registry.npmmirror.com
WORKDIR /build/spider
COPY Spider_XHS/package.json Spider_XHS/package-lock.json ./
RUN node -e 'const fs = require("fs"); const p = "package-lock.json"; fs.writeFileSync(p, fs.readFileSync(p, "utf8").split("https://registry.npmjs.org").join(process.argv[1].replace(/\/$/, "")));' "$NPM_REGISTRY" \
    && npm ci --omit=dev --registry="$NPM_REGISTRY" --fetch-retries=3 --fetch-timeout=120000 --no-audit --no-fund

FROM ${PYTHON_IMAGE} AS runtime
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ARG DEBIAN_MIRROR=https://mirrors.aliyun.com/debian
ARG DEBIAN_SECURITY_MIRROR=https://mirrors.aliyun.com/debian-security
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    NODE_ENV=production \
    SPIDER_XHS_PATH=/app/Spider_XHS \
    XHS_ADMIN_DATA=/app/admin_backend/data

# OpenCV is an upstream dependency; its wheel needs these shared libraries.
RUN python -c 'from pathlib import Path; import sys; p=Path("/etc/apt/sources.list.d/debian.sources"); s=p.read_text(); s=s.replace("http://deb.debian.org/debian-security", sys.argv[2].rstrip("/")).replace("http://deb.debian.org/debian", sys.argv[1].rstrip("/")); p.write_text(s)' "$DEBIAN_MIRROR" "$DEBIAN_SECURITY_MIRROR" \
    && apt-get -o Acquire::Retries=3 update \
    && apt-get install -y --no-install-recommends ca-certificates libgl1 libglib2.0-0 libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=spider-node /usr/local/bin/node /usr/local/bin/node

WORKDIR /app/admin_backend
COPY Spider_XHS/requirements.txt /tmp/spider-requirements.txt
RUN PIP_INDEX_URL="$PIP_INDEX_URL" pip install --no-cache-dir --timeout=120 --retries=3 -r /tmp/spider-requirements.txt
COPY admin_backend/ ./
RUN PIP_INDEX_URL="$PIP_INDEX_URL" pip install --no-cache-dir --timeout=120 --retries=3 .
COPY Spider_XHS/ /app/Spider_XHS/
COPY --from=spider-node /build/spider/node_modules /app/Spider_XHS/node_modules
COPY --from=frontend /build/frontend/dist /app/admin_frontend/dist
RUN mkdir -p /app/admin_backend/data

EXPOSE 8765
# The embedded scheduler requires exactly one worker.
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8765", "--workers", "1"]
