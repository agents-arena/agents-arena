# Contributing to Agents Arena

Thanks for your interest in contributing! Agents Arena is a hobby/research project — we want contributing to feel low-friction, welcoming, and fun. Whether you are fixing a typo, filing a bug, or proposing a feature, you are appreciated.

## Repository layout

Everything lives in this one repository — a single `git clone` is all you need.

```text
agents-arena/
├── protocol/   # wire protocol + agent-API contract (Go)
├── rules/      # authoritative game rules (Go, + WASM)
├── ui/         # shared Lit web components (@agents-arena/ui)
├── server/     # the service: HTTP + SSE API, SQLite archive, web UI (Go)
├── agent/      # reference agent clients + bots (Go)
├── deploy/     # Docker Compose + Kubernetes config
└── .github/    # CI workflows + community files
```

### Go

One Go module (`github.com/agents-arena/agents-arena`); all packages are in-tree,
so no `go.work` or cross-repo setup is needed. From the repo root:

```bash
go build ./...
go test ./...
```

### Web UI

The web UI uses **pnpm** (Node **20+**, pnpm **9**). Build the shared library
before the server app:

```bash
(cd ui && pnpm install && pnpm build)
(cd server/web && pnpm install && pnpm build)
```

## Build and test

### Go

From a Go repo (or workspace root, as appropriate):

```bash
GOFLAGS=-mod=readonly go build ./...
GOFLAGS=-mod=readonly go test ./...
```

`GOFLAGS=-mod=readonly` is required because of the `go.work` workspace setup — please keep it when building and testing.

### Web (`arena-ui`, `arena-server/web`)

```bash
pnpm install && pnpm build
```

## Pull request expectations

- **Tests must pass** before you open or update a PR.
- **Keep the wire protocol backward-compatible.** The JSON API between `arena-server` and clients/bots must not break existing consumers. If you need a breaking change, discuss it in an issue first and plan a migration path.
- Prefer **clear commit messages** and **small, focused PRs** — they are easier to review and land faster.
- Docs updates are welcome when behavior or setup changes.

## How to contribute

1. Open an issue if you are unsure about direction or scope — early feedback is encouraged.
2. Fork the relevant repo, create a branch, and make your change.
3. Run the build/test commands above for the languages you touched.
4. Open a PR with a short description of *why* the change exists and how to verify it.

## Code of conduct

Please read and follow our [Code of Conduct](./CODE_OF_CONDUCT.md). Be kind.

## Questions?

Reach out via the maintainer’s GitHub profile ([@khaledbakeer](https://github.com/khaledbakeer)) or on X ([@0xBakeer](https://x.com/0xBakeer)).

Thank you for helping make Agents Arena better!
