# Changelog

All notable changes to the LuraDB Web Client are documented in this file. The
format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Desktop: connections can opt in to accepting self-signed TLS certificates, per connection.

### Changed

- KV set null now keeps the key listed and shows an explicit NULL state.
- Requires LuraDB 0.2.0 or newer.

### Fixed

- Scrollbars and native controls now follow the active theme.

## [0.0.3] - 2026-08-12

### Fixed

- Docs: the view now fills the window height; sidebar and article scroll independently.
- Data browser (REL mode): with expand active, the row detail no longer repeats the raw link key above the resolved value section.
- Data browser (REL mode): expanded value sections now use the available panel height instead of a fixed 240px cap.
- Data browser: "open in kv/json browser" from a REL row detail now reliably selects the target, also when the list was already loaded; the kv key list scrolls to the selection and marks it.
- Admin: the domains card counts objects across all engines (documents, kv keys, tables, views) instead of JSON documents only.

## [0.0.2] - 2026-08-11

### Added

- Command palette (Ctrl+K / Cmd+K): jump straight to any screen, domain, or
  docs article by typing a few letters.
- SQL console: a `params` field in the toolbar sends a JSON array bound to
  `?` placeholders, for any statement class.
- Data browser (REL mode): an "alter table" assistant next to the index pill
  generates `ADD COLUMN` / `DROP COLUMN` / `RENAME COLUMN` / `RENAME TABLE`
  statements into the SQL editor, guided by the server's v1 restrictions.
- Engines & jobs: a "▶ reindex…" trigger in the tasks card starts a JSON
  domain reindex (all indexes or one field) without the REST explorer.
- Data browser (JSON mode): the idx pill opens an index management panel —
  create or delete field indexes, with a one-click reindex prompt right after
  creating one.
- Data browser (JSON mode): an "import ndjson ↑" button next to export opens
  a bulk-import modal — paste or load an NDJSON file, then POST it in one
  shot and see an `imported · failed` summary with a full per-line error list.
- Data browser (KV mode): a "bulk…" panel selects scanned keys with a
  `contains` filter and runs delete / clear / set-null across the selection,
  with confirmation and a per-key failure report.
- Data browser (REL mode): with expand active, the row detail shows the
  linked KV value / JSON document below the field list, with a jump to the
  target key in its own browser (dangling links stay a muted docs pointer).

### Changed

- Explorer: the expanded domain renders as a bordered card; each engine section
  is a single label row (color dot, "+" action) without empty-state placeholders.
- Domain lists and the expanded explorer domain now refresh automatically
  (every 30–60s), so changes made by other clients appear without a reload.
- Docs: the LuraSQL article now also covers column types, constraints,
  `ALTER TABLE` restrictions, and identifier/limit rules.

### Fixed

- Light theme: status, engine-label and accent colors were tuned for the dark
  theme and washed out on light surfaces — request status ("200 OK"), REST
  method labels, KVREF/JSONREF markers, SQL string literals and secondary text
  are now legible throughout. The light accent also matches the brand blue
  again instead of drifting towards teal.

## [0.0.1] - 2026-08-11

### Added

- Initial release: an IDE for LuraDB over its REST API — LuraSQL console; data
  browser across the KV, JSON and relational engines (with live KV watch); REST
  explorer over the OpenAPI contract; engines & jobs; admin (domains, users,
  permissions, key rotation); configuration; and built-in docs. Packaged as a
  Tauri 2 desktop app.

[unreleased]: https://github.com/hwein/luradb-web-client/compare/v0.0.3...HEAD
[0.0.3]: https://github.com/hwein/luradb-web-client/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/hwein/luradb-web-client/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/hwein/luradb-web-client/releases/tag/v0.0.1
