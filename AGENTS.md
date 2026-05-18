## Commands

- `pnpm check` — full CI gate: lint (oxlint) → duplicate gate (Fallow mild) → typecheck → test
- `pnpm lint` — oxlint with strict architecture rules (the architecture gate)
- `pnpm lint:fix` — auto-correct safe lint issues
- `pnpm check:dup` — hard duplicate-code gate with Fallow mild mode and the repo's 3% wrapper threshold
- `pnpm advise` — advisory quality pass: Aislop + conservative semantic Fallow (filtered: suppresses known noise)
- `pnpm advise:raw` — unfiltered advisory output (shows all findings including known noise)
- `pnpm advise:aislop` — broad advisory scanner for duplicate imports, duplicate blocks, complexity, wrapper, and security signals
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm test` — vitest with Cloudflare Workers pool

## Architecture lint

The oxlint plugin at `scripts/oxlint-js-plugins/architecture.js` enforces clean-architecture layer boundaries. Rules are wired in `.oxlintrc.json`. Fix the code — never loosen rules to pass lint.

## Advisory checks

Run `pnpm advise` after substantial code changes. The filter script (`scripts/filter-advise.mjs`) suppresses known noise via `.advise-suppressions.json` and shows only new findings.

When new findings appear, handle them autonomously:

1. **Auto-suppress** these categories without asking (patterns mandated by architecture):
   - `complexity/file-too-large` in `scripts/oxlint-js-plugins/architecture.js`
   - `complexity/function-too-long` in route registration (`authz.routes.ts`) or composition wiring (`create-request-container.ts`)
   - `code-quality/duplicate-block` in route files (`*.routes.ts`) — each route validates + calls use case + presents, extracting adds indirection
   - `code-quality/duplicate-block` in mapper files (`*.mapper.ts`) — explicit one-to-one field mapping is the architecture rule
   - `ai-slop/narrative-comment` in any file — JSDoc at architectural boundaries is required by the JSDoc Standard
   - `ai-slop/thin-wrapper` — `createDb`, `encodeCursor` are intentional public APIs
   - `ai-slop/double-type-assertion` in `crud-adapter.ts` — Drizzle query return type limitation
   - `security/vulnerable-dependency` — note it, do not auto-upgrade deps

2. **Auto-suppress** fallow clone groups between known file-sets:
   - `*/*.entity.ts` files with other entity files — getter/update/toSnapshot pattern mandated by Entity Class Rules
   - `create-*.usecase.ts` files with other create use cases — idempotent create/replay pattern is structurally similar by design
   - Entity-mapper files — explicit field mapping pattern

3. **Review** (do NOT auto-suppress):
   - New rule types not in the list above
   - Clone groups involving files not in any existing suppression entry
   - `security/*` (except the known esbuild one)
   - Any finding with `severity: error`

4. **To add a suppression**: append to the `suppressions` array in `.advise-suppressions.json`:
   - aislop: `{ "tool": "aislop", "file": "<filePath>", "rule": "<rule>", "reason": "<why>" }`
   - fallow: `{ "tool": "fallow", "files": "<sorted|paths>", "reason": "<why>" }`

5. **Final check**: after suppressing findings, re-run `pnpm advise` to verify clean (green line).
6. **To see everything** (unfiltered): `pnpm advise:raw`

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
