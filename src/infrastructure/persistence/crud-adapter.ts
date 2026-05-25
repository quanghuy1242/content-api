import { and, asc, desc, eq, gt, lt, or, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { AnySQLiteColumn, AnySQLiteTable } from "drizzle-orm/sqlite-core";
import { decodeCursor, encodeCursor, type CursorPage } from "@/shared/pagination/cursor";

export type FindRowsWhereOptions = {
  orderBy?: AnySQLiteColumn;
  direction?: "asc" | "desc";
  limit?: number;
};

type Db = DrizzleD1Database<Record<string, unknown>>;

type SortDirection = "asc" | "desc";

export type CrudFilterConfig = {
  column: AnySQLiteColumn;
  op: "eq";
};

export type CrudSortConfig = {
  column: AnySQLiteColumn;
  direction: SortDirection;
};

export type CrudListOptions<Row> = {
  table: AnySQLiteTable;
  idColumn: AnySQLiteColumn;
  cursorColumn: AnySQLiteColumn;
  getCursor: (row: Row) => { createdAt: Date; id: string };
  limit: number;
  cursor?: string;
  maxLimit?: number;
  filters?: Record<string, CrudFilterConfig>;
  filterValues?: Record<string, unknown>;
  sort?: CrudSortConfig;
  where?: SQL<unknown>[];
};

/**
 * Shared Drizzle/D1 persistence primitive for the documented "mostly CRUD"
 * resources.
 *
 * Resource repositories own table-specific mapping and custom predicates, but
 * repeated row operations, cursor pagination, filter normalization, and basic
 * insert/update/delete semantics must stay here. Keeping this adapter boring is
 * what prevents each repository from reimplementing subtly different CRUD.
 */
export class CrudAdapter {
  constructor(private readonly db: Db) {}

  /**
   * Builds a Drizzle insert statement without executing it.
   *
   * Repositories should usually call `insertRow()` for immediate writes. This
   * helper exists for workflow-specific infrastructure code that must compose
   * multiple insert statements into a single `db.batch(...)` call while still
   * using the shared adapter as the insert construction boundary.
   */
  buildInsert(table: AnySQLiteTable, values: Record<string, unknown>): BatchItem<"sqlite"> {
    return this.buildInsertQuery(table, values) as unknown as BatchItem<"sqlite">;
  }

  /**
   * Builds an INSERT OR IGNORE statement without executing it.
   *
   * Use this variant in bulk-init batch builds where rows may already exist
   * and a conflict should silently skip the row. The companion `buildUpdate`
   * or `buildInsert` covers the normal write path where conflicts are errors.
   */
  buildInsertIgnore(table: AnySQLiteTable, values: Record<string, unknown>): BatchItem<"sqlite"> {
    return this.buildInsertQuery(table, values).onConflictDoNothing() as unknown as BatchItem<"sqlite">;
  }

  /**
   * Builds a Drizzle update statement without executing it.
   *
   * Workflow infrastructure uses this when a state mutation and audit event must
   * commit in one D1 batch while still keeping query construction centralized.
   */
  buildUpdate(table: AnySQLiteTable, values: Record<string, unknown>, condition: SQL<unknown>): BatchItem<"sqlite"> {
    return (this.db as never as {
      update: (table: AnySQLiteTable) => {
        set: (values: Record<string, unknown>) => {
          where: (condition: SQL<unknown>) => unknown;
        };
      };
    })
      .update(table)
      .set(this.withoutUndefined(values))
      .where(condition) as unknown as BatchItem<"sqlite">;
  }

  /**
   * Executes a pre-built list of batch statements in a single D1 round-trip.
   *
   * Repositories that compose statements via `buildInsert`, `buildInsertIgnore`,
   * `buildUpdate`, or `buildDelete` must call this instead of `db.batch()`
   * directly — `db.batch()` is restricted to workflow files by architecture lint.
   */
  async runBatch(stmts: BatchItem<"sqlite">[]): Promise<void> {
    await this.db.batch(stmts as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }

  /**
   * Builds a Drizzle delete statement without executing it.
   *
   * Workflow infrastructure uses this for audited revocation and replacement
   * flows that need deletes and inserts to commit together.
   */
  buildDelete(table: AnySQLiteTable, condition: SQL<unknown>): BatchItem<"sqlite"> {
    return (this.db as never as {
      delete: (table: AnySQLiteTable) => {
        where: (condition: SQL<unknown>) => unknown;
      };
    })
      .delete(table)
      .where(condition) as unknown as BatchItem<"sqlite">;
  }

  /**
   * Returns a cursor page using the API's stable `(createdAt, id)` seek cursor.
   * Repositories can add resource-specific `where` predicates but should not
   * duplicate cursor or limit logic outside this method.
   */
  async listRows<Row>(options: CrudListOptions<Row>): Promise<CursorPage<Row>> {
    const limit = this.normalizeLimit(options.limit, options.maxLimit ?? 100);
    const sort = options.sort ?? { column: options.cursorColumn, direction: "desc" };
    const conditions = [
      ...(options.where ?? []),
      ...this.buildFilterConditions(options.filters, options.filterValues),
      this.buildCursorCondition({
        cursor: options.cursor,
        cursorColumn: options.cursorColumn,
        idColumn: options.idColumn,
        direction: sort.direction,
      }),
    ].filter((condition): condition is SQL<unknown> => Boolean(condition));

    const rows = (await (this.db as never as {
      select: () => {
        from: (table: AnySQLiteTable) => {
          where: (condition: SQL<unknown> | undefined) => {
            orderBy: (...columns: SQL<unknown>[]) => {
              limit: (limit: number) => Promise<Row[]>;
            };
          };
        };
      };
    })
      .select()
      .from(options.table)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(
        sort.direction === "asc" ? asc(sort.column) : desc(sort.column),
        sort.direction === "asc" ? asc(options.idColumn) : desc(options.idColumn),
      )
      .limit(limit + 1)) as Row[];

    const data = rows.slice(0, limit);
    const nextRow = rows.length > limit ? data.at(-1) : undefined;
    const nextCursor = nextRow ? this.encodeRowCursor(nextRow, options.getCursor) : undefined;

    return {
      data,
      page: nextCursor ? { nextCursor } : {},
    };
  }

  /**
   * Reads one row by a resource id column. This keeps the common id lookup
   * shape centralized while allowing repositories to map the returned row.
   */
  async findRowById<Row>(table: AnySQLiteTable, idColumn: AnySQLiteColumn, id: string): Promise<Row | null> {
    return this.findFirstRow<Row>(table, eq(idColumn, id));
  }

  /**
   * Reads one row by an arbitrary Drizzle predicate. This keeps non-id lookups
   * such as slug/email/better-auth-id inside the same adapter as id lookups.
   */
  async findFirstRow<Row>(table: AnySQLiteTable, condition: SQL<unknown>): Promise<Row | null> {
    const rows = (await (this.db as never as {
      select: () => {
        from: (table: AnySQLiteTable) => {
          where: (condition: SQL<unknown>) => {
            limit: (limit: number) => Promise<Row[]>;
          };
        };
      };
    })
      .select()
      .from(table)
      .where(condition)
      .limit(1)) as Row[];

    return rows[0] ?? null;
  }

  /**
   * Inserts one row and centralizes the rare conflict-ignore case used by mirror
   * style synchronization code.
   */
  async insertRow(table: AnySQLiteTable, values: Record<string, unknown>, options?: { onConflictDoNothing?: boolean }) {
    const query = this.buildInsertQuery(table, values);

    if (options?.onConflictDoNothing) {
      await query.onConflictDoNothing();
      return;
    }

    await query;
  }

  /**
   * Updates one id-addressed row after dropping `undefined` fields so PATCH
   * semantics remain consistent across repositories.
   */
  async updateRow(table: AnySQLiteTable, idColumn: AnySQLiteColumn, id: string, values: Record<string, unknown>) {
    await (this.db as never as {
      update: (table: AnySQLiteTable) => {
        set: (values: Record<string, unknown>) => {
          where: (condition: SQL<unknown>) => Promise<unknown>;
        };
      };
    })
      .update(table)
      .set(this.withoutUndefined(values))
      .where(eq(idColumn, id));
  }

  /**
   * Deletes one id-addressed row and returns whether D1 reported a change.
   */
  async deleteRowById(table: AnySQLiteTable, idColumn: AnySQLiteColumn, id: string): Promise<boolean> {
    const result = await (this.db as never as {
      delete: (table: AnySQLiteTable) => {
        where: (condition: SQL<unknown>) => Promise<{ meta?: { changes?: number } }>;
      };
    })
      .delete(table)
      .where(eq(idColumn, id));

    return (result.meta?.changes ?? 0) > 0;
  }

  /**
   * Reads multiple rows matched by an arbitrary Drizzle predicate with optional
   * ordering and limit. Used by lifecycle repositories for scheduled-ready scans
   * and any other predicate-scoped multi-row read that needs stable ordering.
   */
  async findRowsWhere<Row>(
    table: AnySQLiteTable,
    columns: AnySQLiteColumn[],
    condition: SQL<unknown>,
    options?: FindRowsWhereOptions,
  ): Promise<Row[]> {
    const query = (this.db as never as {
      select: (cols: Record<string, AnySQLiteColumn>) => {
        from: (table: AnySQLiteTable) => {
          where: (condition: SQL<unknown>) => {
            orderBy: (...cols: SQL<unknown>[]) => {
              limit: (n: number) => Promise<Row[]>;
            };
            limit: (n: number) => Promise<Row[]>;
          };
        };
      };
    }).select(Object.fromEntries(columns.map((col) => [col.name, col])));

    const fromClause = query.from(table).where(condition);

    if (options?.orderBy !== undefined && options?.limit !== undefined) {
      return fromClause
        .orderBy(options.direction === "asc" ? asc(options.orderBy) : desc(options.orderBy))
        .limit(options.limit) as Promise<Row[]>;
    }

    if (options?.limit !== undefined) {
      return fromClause.limit(options.limit) as Promise<Row[]>;
    }

    return fromClause as unknown as Promise<Row[]>;
  }

  /**
   * Executes a conditional `UPDATE ... SET ... WHERE ...` and returns the number
   * of affected rows. Used by lifecycle repositories for compare-and-set
   * transitions — the `WHERE` clause can include a status guard so the update
   * only fires if the row is in the expected state, making cron publishes safe
   * under D1's lack of row-level locking.
   */
  async updateRowsConditional(
    table: AnySQLiteTable,
    params: { set: Record<string, unknown>; where: SQL<unknown> },
  ): Promise<{ rowsAffected: number }> {
    const result = await (this.db as never as {
      update: (table: AnySQLiteTable) => {
        set: (values: Record<string, unknown>) => {
          where: (condition: SQL<unknown>) => Promise<{ meta?: { changes?: number } }>;
        };
      };
    })
      .update(table)
      .set(this.withoutUndefined(params.set))
      .where(params.where);

    return { rowsAffected: result.meta?.changes ?? 0 };
  }

  /**
   * Deletes rows matched by a repository-supplied predicate and returns D1's
   * reported change count. Use this for scoped infrastructure cleanup, such as
   * removing expired idempotency rows, instead of hand-writing delete queries
   * in individual repositories.
   */
  async deleteRows(table: AnySQLiteTable, condition: SQL<unknown>): Promise<number> {
    const result = await (this.db as never as {
      delete: (table: AnySQLiteTable) => {
        where: (condition: SQL<unknown>) => Promise<{ meta?: { changes?: number } }>;
      };
    })
      .delete(table)
      .where(condition);

    return result.meta?.changes ?? 0;
  }

  private buildInsertQuery(table: AnySQLiteTable, values: Record<string, unknown>) {
    return this.db.insert(table).values(values);
  }

  private buildFilterConditions(
    filters: Record<string, CrudFilterConfig> | undefined,
    values: Record<string, unknown> | undefined,
  ) {
    if (!filters || !values) {
      return [];
    }

    return Object.entries(filters)
      .map(([name, filter]) => {
        const value = values[name];
        if (value === undefined || value === null || value === "") {
          return undefined;
        }

        switch (filter.op) {
          case "eq":
            return eq(filter.column, value);
        }
      })
      .filter((condition): condition is SQL<unknown> => Boolean(condition));
  }

  private buildCursorCondition(params: {
    cursor?: string;
    cursorColumn: AnySQLiteColumn;
    idColumn: AnySQLiteColumn;
    direction: SortDirection;
  }) {
    const cursor = decodeCursor(params.cursor);
    if (!cursor) {
      return undefined;
    }

    const cursorDate = new Date(cursor.createdAt);
    const compareCursor = params.direction === "asc" ? gt : lt;

    return or(
      compareCursor(params.cursorColumn, cursorDate),
      and(eq(params.cursorColumn, cursorDate), compareCursor(params.idColumn, cursor.id)),
    );
  }

  private encodeRowCursor<Row>(row: Row, getCursor: (row: Row) => { createdAt: Date; id: string }) {
    const cursor = getCursor(row);
    return encodeCursor(cursor.createdAt.getTime(), cursor.id);
  }

  private normalizeLimit(limit: number, maxLimit: number) {
    if (!Number.isFinite(limit)) {
      return Math.min(20, maxLimit);
    }

    return Math.min(Math.max(Math.trunc(limit), 1), maxLimit);
  }

  private withoutUndefined(values: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
  }
}
