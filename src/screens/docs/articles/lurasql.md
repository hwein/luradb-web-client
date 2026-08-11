id: lurasql
category: LuraSQL (rel engine)
title: A deliberately small SQL dialect
kicker: LuraSQL
---
LuraSQL is a standard-SQL subset, not a full relational engine — it deliberately stops short of joins beyond `LEFT JOIN`, subqueries, and aggregates, so every statement stays cheap and predictable to execute.

1. **One endpoint, three response shapes.** `POST /store-api/rel/{domain}/sql` takes `{"sql", "params", "expand"}`; the reply is `{columns, rows, row_count, limit_applied}` for `SELECT`, `{affected, last_pk}` for `INSERT`/`UPDATE`/`DELETE`, `{"ok": true}` for schema statements.
2. **Queries: `SELECT` with `LEFT JOIN` only.** No `INNER`/`RIGHT`/`FULL JOIN`, no subqueries, no `GROUP BY`, no aggregates beyond `COUNT(*)`. Rows come back as arrays, not objects, so two same-named join columns never collide.
3. **Schema changes: `CREATE`/`ALTER`/`DROP TABLE`, `CREATE`/`DROP INDEX`, `CREATE`/`DROP VIEW`.** Row writes (`INSERT`/`UPDATE`/`DELETE`) run through this same endpoint too.
4. **Exactly one statement per request.** A single trailing `;` is allowed; a second statement answers `400`, and so does an empty body.
5. **`?` binds positionally to `params`.** `WHERE status = ?` with `"params": ["paid"]`; a wrong parameter count is `400`, and so is comparing a column to `NULL` directly — use `IS [NOT] NULL` instead.
6. **Seven column types, and the wire format is fixed.** `INTEGER`/`REAL` come back as JSON numbers, `TEXT`/`KVREF`/`JSONREF` as strings, `BOOLEAN` as `true`/`false`, `TIMESTAMP` as an ISO-UTC string. Aliases are accepted (`VARCHAR(n)`, `INT`, `BIGINT`, `BOOL`, `DATETIME`, …) and any `(n)` length is parsed but ignored. There is no `JSON` column type — structured data belongs in the json engine, linked in via `JSONREF`. Writing a `TIMESTAMP` takes an ISO-8601 UTC string or integer millis; an offset like `+01:00` answers `400`, UTC only.
7. **Constraints are validated after parsing, not by the grammar.** Exactly one `PRIMARY KEY` per table, `INTEGER` or `TEXT` only, immutable on `UPDATE`; `AUTOINCREMENT` is only valid directly after `PRIMARY KEY`, and only on an `INTEGER` column. `UNIQUE` creates an implicit `{table}_{column}_key` index that can't be dropped on its own; `DEFAULT` must match the column's type, and `DEFAULT CURRENT_TIMESTAMP` only works on `TIMESTAMP`. `REFERENCES table` points at the target's primary key — the target must already exist — and writing a value with no matching row there answers `409`.
8. **`ALTER TABLE` is intentionally narrow.** `ADD COLUMN` can't declare `PRIMARY KEY`, `AUTOINCREMENT`, or `UNIQUE` — add a unique index separately instead — and a new `NOT NULL` column needs a literal `DEFAULT` in the same statement. `DROP COLUMN` refuses a primary key or an indexed column (`409`), and any change that would break a dependent view answers `409` too.
9. **Identifiers are plain and case-folded; a few limits are worth knowing.** Table/column/index names match `[a-z_][a-z0-9_]{0,49}` — up to 50 characters, no quoting, every keyword reserved — and are lowercased on the server, so `Orders` and `orders` name the same table. There are no SQL comments; `--` and `/* */` are syntax errors, not ignored text. By default, a `SELECT` without `LIMIT` is capped at 1000 rows (the response marks `limit_applied: true`) and an explicit `LIMIT` tops out around 10000, with statements themselves capped around 64 KiB — an instance can configure these differently.

## Example

```
POST /store-api/rel/shop/sql
{ "sql": "SELECT o.id, o.total FROM orders AS o WHERE o.status = ? LIMIT 50",
  "params": ["paid"] }

→ 200 { "columns": [{"name":"id","type":"INTEGER"},{"name":"total","type":"REAL"}],
        "rows": [[1042, 214.90], [1043, 89.00]],
        "row_count": 2, "limit_applied": false }
```

---
try: SELECT o.id, o.total FROM orders AS o WHERE o.status = 'paid' LIMIT 50
related: cross-engine-links | KVREF & JSONREF
related: errors-status-codes | SQL error codes
