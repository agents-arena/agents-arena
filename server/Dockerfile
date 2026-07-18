# syntax=docker/dockerfile:1
#
# Self-contained image for arena-server: the Go service AND the spectator web UI
# it serves, built entirely from this monorepo (build context = repo root). No
# external clones — the shared ui/ library and the Go packages are all in-tree.
#
# Built and published by CI (.github/workflows/docker-publish.yml) to
# ghcr.io/agents-arena/arena-server. Deployers just pull it (see deploy/).

# ---- 1. Build the web UI (shared ui lib, then the server's spectator app) ----
FROM node:22-alpine AS web
RUN npm i -g pnpm@9
WORKDIR /src
# The shared component library first — server/web depends on it via file:../../ui.
COPY ui/ ./ui/
RUN cd ui && pnpm install --no-frozen-lockfile && pnpm build
COPY server/web/ ./server/web/
RUN cd server/web && pnpm install --no-frozen-lockfile && pnpm build

# ---- 2. Build the Go server (single module, all packages in-tree) ----
FROM golang:1.25-alpine AS gobuild
RUN apk add --no-cache git
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /out/arena-server ./server/cmd/arena-server

# ---- 3. Minimal runtime ----
FROM alpine:3.20
RUN apk add --no-cache wget ca-certificates \
 && adduser -D -u 10001 arena \
 && mkdir -p /data && chown arena /data
WORKDIR /app
COPY --from=gobuild /out/arena-server /usr/local/bin/arena-server
COPY --from=web    /src/server/web/dist /app/web
USER arena
EXPOSE 8080
VOLUME ["/data"]
ENV ARENA_DB=/data/arena.db
ENTRYPOINT ["arena-server"]
CMD ["-addr", ":8080", "-web", "/app/web"]
