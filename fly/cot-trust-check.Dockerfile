FROM node:20-bookworm-slim
WORKDIR /app
COPY coworker/package.json coworker/
COPY router router
RUN cd coworker && npm install --omit=dev
COPY coworker/src coworker/src
WORKDIR /app/coworker
ENV NODE_ENV=production
CMD ["node", "--import", "tsx", "src/worker.ts"]
