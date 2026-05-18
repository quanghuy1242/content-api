## Commands

- `pnpm check` — full CI gate: lint (oxlint) → duplicate gate (Fallow mild) → typecheck → test
- `pnpm lint` — oxlint with strict architecture rules (the architecture gate)
- `pnpm lint:fix` — auto-correct safe lint issues
- `pnpm check:dup` — hard duplicate-code gate with Fallow mild mode and the repo's 3% wrapper threshold
- `pnpm advise` — advisory quality pass: Aislop + conservative semantic Fallow
- `pnpm advise:dupes` — semantic duplicate-code advisory scan
- `pnpm advise:aislop` — broad advisory scanner for duplicate imports, duplicate blocks, complexity, wrapper, and security signals
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm test` — vitest with Cloudflare Workers pool

## Architecture lint

The oxlint plugin at `scripts/oxlint-js-plugins/architecture.js` enforces clean-architecture layer boundaries. Rules are wired in `.oxlintrc.json`. Fix the code — never loosen rules to pass lint.

## Advisory checks

Run `pnpm advise` after substantial code changes, especially before finalizing agent work. Treat findings as review input, not automatic blockers: fix clear local cleanup, inspect duplicate blocks before extracting, and mention important intentionally ignored findings when relevant. Do not weaken architecture lint because advisory tools complain.

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
