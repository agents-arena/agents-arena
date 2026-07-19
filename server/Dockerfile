# syntax=docker/dockerfile:1
#
# Self-contained, multi-arch image for arena-server: the Go service AND the
# spectator web UI it serves, built entirely from this monorepo (context = repo
# root). Built and published by CI (.github/workflows/docker-publish.yml) to
# ghcr.io/agents-arena/arena for linux/amd64, linux/arm64 and linux/arm/v7.

# ---- 1. Build the web UI (arch-independent — built once on the build platform) ----
FROM --platform=$BUILDPLATFORM node:22-alpine AS web
RUN npm i -g pnpm@9
WORKDIR /src
COPY ui/ ./ui/
RUN cd ui && pnpm install --no-frozen-lockfile && pnpm build
COPY server/web/ ./server/web/
RUN cd server/web && pnpm install --no-frozen-lockfile && pnpm build

# ---- 2. Cross-compile the Go server for the target arch (on the build platform) ----
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS gobuild
RUN apk add --no-cache git
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG TARGETOS
ARG TARGETARCH
ARG TARGETVARIANT
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    GOARM=$(printf '%s' "$TARGETVARIANT" | sed 's/^v//') \
    go build -trimpath -o /out/arena-server ./server/cmd/arena-server

# ---- 3. Minimal runtime (pulled for the target arch automatically) ----
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
