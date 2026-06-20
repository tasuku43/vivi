# syntax=docker/dockerfile:1

FROM node:20-alpine AS ui-build
WORKDIR /src

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM golang:1.22-alpine AS go-build
WORKDIR /src

COPY . .
COPY --from=ui-build /src/ui/dist ./ui/dist

RUN go test ./...
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/vivi ./cli

FROM alpine:3.20 AS runtime
WORKDIR /app

ENV GIT_OPTIONAL_LOCKS=0 \
    GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0=safe.directory \
    GIT_CONFIG_VALUE_0=* \
    VIVI_DATA_DIR=/data
RUN apk add --no-cache ca-certificates git tini && mkdir -p /data
COPY --from=go-build /out/vivi /app/vivi

EXPOSE 4317
ENTRYPOINT ["tini", "--", "/app/vivi"]
CMD ["/workspace", "--host", "0.0.0.0", "--git-review-timeout", "180s"]
