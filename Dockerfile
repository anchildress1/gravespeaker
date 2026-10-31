FROM node:26.12.1-bookworm-slim AS base
# Corepack is no longer bundled with Node 25+.
RUN npm install -g --ignore-scripts pnpm@11.28.9
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM base AS build
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm build

FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

FROM node:26.12.1-bookworm-slim AS runner
# Cloud Run terminates TLS, so the origin must come from forwarded headers or form POSTs 403.
# Phone photos of headstones run 2-5 MB; adapter-node defaults to 512K.
WORKDIR /app
ENV NODE_ENV=production PORT=8080 \
    PROTOCOL_HEADER=x-forwarded-proto HOST_HEADER=host BODY_SIZE_LIMIT=12M
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json ./
USER node
EXPOSE 8080
CMD ["node", "build"]
