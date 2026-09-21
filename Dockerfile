# The whole Sales Engine as one image: the Next.js workspace and the quote
# module (FastAPI) in a single container, one public port, one deployment.
#
# The module listens on the container's loopback only; the workspace proxies it
# (next.config.ts) and is the only thing exposed. See scripts/start.mjs.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip python3-venv ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps first — they change least often.
COPY modules/guided-selling/requirements.txt ./modules/guided-selling/requirements.txt
RUN pip3 install --break-system-packages --no-cache-dir -r modules/guided-selling/requirements.txt

# Node deps next. devDependencies are needed for `next build`.
COPY package.json package-lock.json* ./
RUN npm ci --include=dev

# Then the source.
COPY . .

# QUOTE_WORKSPACE_URL must be present at build time: next.config.ts bakes the
# proxy destinations into the routes manifest, and scripts/start.mjs derives the
# module's listen port from this same value, so the two cannot drift. It is a
# loopback address inside the container, identical in every environment, so it
# is pinned here rather than left to a dashboard field someone could change.
ENV QUOTE_WORKSPACE_URL=http://127.0.0.1:8001
RUN npm run build

EXPOSE 3000
CMD ["node", "scripts/start.mjs"]
