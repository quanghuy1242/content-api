# Test Suite Performance Optimizations

**Before:** ~82 s for 128 tests  
**After:** ~10 s for 128 tests

---

## Root causes and fixes (in order of impact)

### 1. `ensureSystemCatalog()` called on every write request — ~200 D1 round-trips each time

**File:** `src/infrastructure/repositories/drizzle-content-role.repository.ts`

**Problem:** `ensureSystemCatalog()` is invoked by every write use case (create post, book, category, media, IAM binding, IAM role, bootstrap). It issued ~200 sequential D1 calls per invocation (50 permissions × 2 ops + 12 roles × delete + re-insert permissions). Each call was a separate IPC round-trip to workerd's SQLite engine.

**Fix:** Two changes together:
1. Module-level `catalogSynced` flag — the full sync only runs once per Worker lifetime. In tests all 128 tests share one Worker, so it runs once total instead of ~100 times. In production, Workers restart on deploy, resetting the flag.
2. Converted the sync from `Promise.all(items.map(async (x) => { await call1; await call2; }))` (still N sequential pairs per item) to a single `db.batch([...all statements...])` call — one D1 round-trip for the entire catalog.

**New method in `CrudAdapter`:** `buildInsertIgnore()` — returns a `BatchItem<"sqlite">` with `onConflictDoNothing()` so the batch can upsert safely when rows already exist (seed pre-populates the catalog).

**Savings:** ~30 s

---

### 2. `bootstrapContentIamAdmin()` made a full HTTP request inside every test body

**File:** `tests/helpers.ts`

**Problem:** `bootstrapContentIamAdmin()` was called at the start of ~44 individual test bodies across `books.test.ts`, `books-lifecycle.test.ts`, `iam-book.test.ts`, `iam-guards.test.ts`, and `iam-roles.test.ts`. Each call did:
- RSA-256 JWT sign
- Full HTTP dispatch through `app.fetch()`
- JWT verification (RSA-256) in the auth middleware
- Principal validation fetch (M2M token + validation call)
- Several D1 queries (ensureSystemCatalog + countActiveAdmins + batch insert)
- `waitOnExecutionContext()` wait

**Fix:** Replaced the HTTP call with `seedBootstrapAdmin()` — a direct 2-row D1 batch (one `content_iam_bootstrap_organizations` row + one `system:org.content_admin` binding). The tests that explicitly test the bootstrap *endpoint* (`iam-guards.test.ts` concurrent-race test, `iam-roles.test.ts` "rejects second bootstrap") call `request(...)` directly and are unaffected.

**Savings:** ~13 s

---

### 3. All test files spawning separate Workers

**Files:** `vitest.config.mts`, `tests/all.test.ts` (new), all test files

**Problem:** By default, `@cloudflare/vitest-pool-workers` starts one Worker per test file. With 14 test files, that's 14 × (workerd startup + migration + module import) overhead, run serially.

**Fix:** Barrel file (`tests/all.test.ts`) imports all test files. `vitest.config.mts` sets `include: ["tests/all.test.ts"]` so vitest sees exactly one file → one Worker. Every test file's tests were wrapped in a `describe()` block with scoped `beforeAll`/`beforeEach` hooks — without this, all hooks register globally in the barrel and fire before every single test.

**Savings:** ~15 s (worker startup × 13 eliminated workers)

---

### 4. `seed()` used two sequential `db.batch()` calls, R2 put on every reset

**File:** `tests/helpers.ts`

**Problem:** `seed()` did:
1. `await env.DB.batch([...14 DELETE statements...])`
2. `await Promise.all([env.DB.batch([...15+ INSERT statements...]), 3× R2.put(...)])`

The DELETEs blocked the INSERTs (sequential awaits). The 3 R2 puts ran every test reset even though R2 objects for `media-alice` are never deleted.

**Fix:**
- Combined DELETEs + INSERTs into one `env.DB.batch([...all 30 statements...])` — one D1 round-trip.
- `r2Seeded` flag — R2 puts run once per Worker lifetime only.

**Savings:** ~3 s

---

### 5. RSA-256 key pair re-generated in every `beforeAll`

**File:** `tests/helpers.ts`

**Problem:** `setupBeforeAll()` called `generateKeyPair("RS256")` unconditionally. With 12 describe blocks each having `beforeAll(setupBeforeAll)`, this ran 12 times.

**Fix:** `keyPairInitialized` flag — key pair is generated once; all describes share it.

**Savings:** ~3 s (primarily visible in the import phase metric)

---

## Invariants to maintain when adding new tests

See the "Test performance rules" section in `CLAUDE.md` / `AGENTS.md` for the authoritative list. Summary:

| Rule | Why it matters |
|---|---|
| Add new test files to `tests/all.test.ts` barrel | Missing from barrel → new Worker spawned |
| Wrap new test file in `describe("name", () => { ... })` | Without it, hooks register globally → N× overhead |
| Use `beforeAll(setupBeforeAll)` + `beforeEach(setupBeforeEach)` inside the describe | Not outside, not at top level |
| Call `seedBootstrapAdmin()` for DB-level admin state, `request(...)` for endpoint tests | `bootstrapContentIamAdmin()` is now a thin wrapper over `seedBootstrapAdmin()` |
| Don't add setup hooks to pure-unit or in-memory describes | `media-upload` and `runScheduledPublish` are already correct |

## Architecture note on `CrudAdapter`

`CrudAdapter` is the single construction boundary for all D1 statements. When building a `db.batch([...])` call:
- `crud.buildInsert(table, values)` — plain insert (fails on conflict)
- `crud.buildInsertIgnore(table, values)` — INSERT OR IGNORE (silent skip on conflict)
- `crud.buildUpdate(table, values, condition)` — update by arbitrary condition
- `crud.buildDelete(table, condition)` — delete by arbitrary condition

Do not call `this.db.insert(...).values(...).onConflictDoNothing()` inline in repositories — route it through `buildInsertIgnore` instead.
