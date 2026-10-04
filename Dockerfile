# syntax=docker/dockerfile:1

# ---- build: install everything, build the SPA and bundle the API ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/planner/package.json packages/planner/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN npm run build -w @wn/web && npm run build -w @wn/api
# Keep only runtime dependencies for the final image.
RUN npm prune --omit=dev --no-audit --no-fund

# ---- runtime ----
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app/apps/api
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/api/package.json ./package.json
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/drizzle ./drizzle
COPY --from=build /app/apps/web/dist /app/web
COPY data /app/data
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
