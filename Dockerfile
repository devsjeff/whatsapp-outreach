# syntax=docker/dockerfile:1.7

FROM node:20.18.3-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json* ./
COPY prisma ./prisma
# Install all deps (including TypeScript) for the build stage.
RUN npm install

FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npx prisma generate \
  && npm run build \
  && test -f dist/index.js \
  && test -f dist/worker.js \
  && npm prune --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
  && chown -R node:node /app /entrypoint.sh
USER node
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/index.js"]
