# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS frontend
WORKDIR /build/frontend
COPY admin_frontend/package.json admin_frontend/package-lock.json ./
RUN npm ci
COPY admin_frontend/ ./
RUN npm run build

FROM node:22-bookworm-slim AS spider-node
WORKDIR /build/spider
COPY Spider_XHS/package.json Spider_XHS/package-lock.json ./
RUN npm ci --omit=dev

FROM python:3.11-slim-bookworm AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    NODE_ENV=production \
    SPIDER_XHS_PATH=/app/Spider_XHS \
    XHS_ADMIN_DATA=/app/admin_backend/data

# OpenCV is an upstream dependency; its wheel needs these shared libraries.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libgl1 libglib2.0-0 libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=spider-node /usr/local/bin/node /usr/local/bin/node

WORKDIR /app/admin_backend
COPY Spider_XHS/requirements.txt /tmp/spider-requirements.txt
RUN pip install --no-cache-dir -r /tmp/spider-requirements.txt
COPY admin_backend/ ./
RUN pip install --no-cache-dir .
COPY Spider_XHS/ /app/Spider_XHS/
COPY --from=spider-node /build/spider/node_modules /app/Spider_XHS/node_modules
COPY --from=frontend /build/frontend/dist /app/admin_frontend/dist
RUN mkdir -p /app/admin_backend/data

EXPOSE 8765
# The embedded scheduler requires exactly one worker.
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8765", "--workers", "1"]
