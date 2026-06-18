# syntax=docker/dockerfile:1

FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV GIT_OPTIONAL_LOCKS=0 \
    GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0=safe.directory \
    GIT_CONFIG_VALUE_0=* \
    PATHLENS_GIT_STATUS_TIMEOUT_MS=180000 \
    PATHLENS_GIT_STATUS_FALLBACK_TIMEOUT_MS=15000 \
    PATHLENS_DATA_DIR=/data
RUN apk add --no-cache git tini && mkdir -p /data
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist

EXPOSE 4317
ENTRYPOINT ["tini", "--", "node", "dist/cli/main.js"]
CMD ["/workspace", "--host", "0.0.0.0"]
