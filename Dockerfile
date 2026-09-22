# The Sales Engine as one image: a single Next.js application, one port, one
# process. Nothing else has to be running for it to work.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

WORKDIR /app

# Dependencies first — they change least often. devDependencies are needed for
# `next build`.
COPY package.json package-lock.json* ./
RUN npm ci --include=dev

# Then the source.
COPY . .
RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
