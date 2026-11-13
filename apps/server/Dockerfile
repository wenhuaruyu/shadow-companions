FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --omit=dev --ignore-scripts
COPY --chown=node:node apps/server/src ./apps/server/src
COPY --chown=node:node apps/web/src/games/back-alley.js ./apps/web/src/games/back-alley.js
USER node
ENV HOST=0.0.0.0 PORT=3000 STORAGE_MODE=rpc
EXPOSE 3000
CMD ["node", "apps/server/src/v2/index.js"]
