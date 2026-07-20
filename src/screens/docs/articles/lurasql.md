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
