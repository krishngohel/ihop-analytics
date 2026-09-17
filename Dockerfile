FROM node:22-slim AS build
WORKDIR /app
COPY client/package*.json client/
RUN cd client && npm ci
COPY client client
RUN cd client && npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production OPS_DB_PATH=/data/ops.db PORT=4000
COPY server/package*.json server/
RUN cd server && npm ci --omit=dev
COPY server/src server/src
COPY --from=build /app/client/dist client/dist
VOLUME /data
EXPOSE 4000
WORKDIR /app/server
CMD ["node", "--experimental-sqlite", "src/index.js"]
