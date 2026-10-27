FROM node:26.12.1-bookworm-slim AS base
# Corepack is no longer bundled with Node 25+.
RUN npm install -g pnpm@11.28.9
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM base AS build
RUN LEFTHOOK=0 pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM base AS prod-deps
RUN LEFTHOOK=0 pnpm install --frozen-lockfile --prod --ignore-scripts

FROM node:26.12.1-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=prod-deps --chmod=555 /app/node_modules ./node_modules
COPY --from=build --chmod=555 /app/build ./build
COPY --chmod=444 package.json ./
USER node
EXPOSE 8080
CMD ["node", "build"]
