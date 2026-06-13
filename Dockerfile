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
RUN apk add --no-cache tini
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist

EXPOSE 4317
ENTRYPOINT ["tini", "--", "node", "dist/cli/main.js"]
CMD ["/workspace", "--host", "0.0.0.0"]
