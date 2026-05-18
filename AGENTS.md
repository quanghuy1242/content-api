## Commands

- `pnpm check` — full CI gate: lint (oxlint) → typecheck → test
- `pnpm lint` — oxlint with strict architecture rules (the architecture gate)
- `pnpm lint:fix` — auto-correct safe lint issues
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm test` — vitest with Cloudflare Workers pool

## Architecture lint

The oxlint plugin at `scripts/oxlint-js-plugins/architecture.js` enforces clean-architecture layer boundaries. Rules are wired in `.oxlintrc.json`. Fix the code — never loosen rules to pass lint.

## Tests

- `@cloudflare/vitest-pool-workers` — tests run in a worker context, import from `cloudflare:test`
- D1 migrations are seeded via `import migrationSql from "../drizzle/0000_*.sql?raw"`
- No external services needed; JWKS is mocked via `createApp({ fetchImpl })`

## Aliases

`@/*` → `src/*` (tsconfig paths + vitest resolve.alias)

## Package manager

`pnpm@11.1.2` via corepack

## Rules

1. Always keep README.md up to date.
2. When work from a planning document is completed, update that document's top `Status` metadata to show it is implemented and update README.md's planning/status list in the same change.
3. Name planning documents with a leading numbered prefix in the `xxx_...` format so their sequence stays trackable.
