# Changelog

All notable changes to the LuraDB Web Client are documented in this file. The
format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Command palette (Ctrl+K / Cmd+K): jump straight to any screen, domain, or
  docs article by typing a few letters.
- SQL console: a `params` field in the toolbar sends a JSON array bound to
  `?` placeholders, for any statement class.
- Data browser (REL mode): an "alter table" assistant next to the index pill
  generates `ADD COLUMN` / `DROP COLUMN` / `RENAME COLUMN` / `RENAME TABLE`
  statements into the SQL editor, guided by the server's v1 restrictions.

### Changed

- Explorer: the expanded domain renders as a bordered card; each engine section
  is a single label row (color dot, "+" action) without empty-state placeholders.
- Domain lists and the expanded explorer domain now refresh automatically
  (every 30–60s), so changes made by other clients appear without a reload.

## [0.0.1] - 2026-08-11

### Added

- Initial release: an IDE for LuraDB over its REST API — LuraSQL console; data
  browser across the KV, JSON and relational engines (with live KV watch); REST
  explorer over the OpenAPI contract; engines & jobs; admin (domains, users,
  permissions, key rotation); configuration; and built-in docs. Packaged as a
  Tauri 2 desktop app.

[unreleased]: https://github.com/hwein/luradb-web-client/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/hwein/luradb-web-client/releases/tag/v0.0.1
