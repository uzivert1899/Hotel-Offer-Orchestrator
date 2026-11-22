FROM node:20-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim AS production

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl tar \
    && rm -rf /var/lib/apt/lists/* \
    && curl --fail --location --silent --show-error \
      "https://temporal.download/cli/archive/latest?platform=linux&arch=amd64" \
      --output /tmp/temporal-cli.tar.gz \
    && tar -xzf /tmp/temporal-cli.tar.gz -C /tmp temporal \
    && mv /tmp/temporal /usr/local/bin/temporal \
    && chmod +x /usr/local/bin/temporal \
    && rm /tmp/temporal-cli.tar.gz

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY start-render.sh ./start-render.sh
RUN chmod +x /app/start-render.sh

EXPOSE 3000

CMD ["node", "dist/server.js"]
