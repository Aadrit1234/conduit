# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && mkdir -p dist/db && cp src/db/schema.sql dist/db/schema.sql

# ---- runtime ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
# schema.sql lives at dist/db/schema.sql; the server applies it on boot (idempotent).
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/health >/dev/null || exit 1
CMD ["node", "dist/index.js"]
