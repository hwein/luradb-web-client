<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/luradb-web-client-wordmark.svg">
  <img src=".github/luradb-web-client-wordmark-light.svg" alt="LuraDB Web Client" height="40">
</picture>

#

The LuraDB Web Client is an **IDE for [LuraDB](https://github.com/hwein/luradb)** —
dense, monospaced where the data lives, dark by default, and honest about the
protocol underneath. It speaks nothing but the LuraDB REST API and ships
primarily as a **cross-platform desktop app** (Tauri 2): the recommended first
tool for LuraDB — install it, enter a server URL and key, and start working. No
web server required; the same build optionally runs as a browser SPA behind a
reverse proxy.

## Workbench

A single-page client in the shape of a development environment: an icon rail on
the left, a persistent domain explorer, a status bar at the bottom — and seven
work areas between them.

| Area | Purpose |
| :--- | :--- |
| **LuraSQL Console** | SQL editor with tabs, expand chips for cross-engine links, result grid |
| **Data Browser** | Master-detail browsing across all three engines: JSON search, KV keys (with live watch), relational rows |
| **REST Explorer** | Request builder over the OpenAPI contract; every response in raw form |
| **Engines & Jobs** | Status and metric cards, running tasks, recent requests |
| **Admin** | Domains, users and domain permissions, key rotation |
| **Configuration** | View, diff and download `luradb.toml` (apply = restart) |
| **Docs** | Built-in documentation, contextually linked (F1, "why?" on errors) |

## Guiding principles

- **REST-transparent.** Every view shows the HTTP call that produced it — in
  footers, result headers and admin notes. The client teaches the API as you use it.
- **Engine color code.** REL blue · JSON amber · KV green — for engine identity
  only. The accent carries interaction, status green/red carries outcome. Never repurposed.
- **Domain = isolation.** The UI never mixes objects from two domains;
  cross-engine links stay within a single domain.
- **Docs one keystroke away.** F1 everywhere, a toggleable split beside the SQL
  editor, contextual links on errors.
- **Honesty.** No fake features. Whatever the server API does not (yet) provide is
  solved honestly on the client, labeled visibly, or left out — never simulated.

## Install

Download the latest Windows installer from the
[Releases](https://github.com/hwein/luradb-web-client/releases) page.

> Builds are currently **unsigned**. Windows SmartScreen shows an "unknown
> publisher" warning on first run — choose *More info → Run anyway*. Signed
> builds may follow later.

Other platforms (Linux, macOS) are not published as installers yet, but the app
builds from source on all three — see [Build from source](#build-from-source).

## Server compatibility

Each client release declares a **minimum LuraDB server version** it supports.
On connect the client calls `GET /version` and refuses to operate against a
server below that minimum.

| Client | Minimum LuraDB server |
| :--- | :--- |
| 0.0.x | 0.1.0 |

When a LuraDB change requires it, a new client release raises the minimum;
older releases stay downloadable but unmaintained.

## Build from source

Requires **Node ≥ 22**. Desktop builds additionally require the **Rust
toolchain** via [rustup](https://rustup.rs) plus the per-platform
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) (Windows: MSVC
Build Tools + WebView2; Linux: `webkit2gtk`, `libayatana-appindicator3`,
`librsvg2`; macOS: Xcode Command Line Tools).

```
npm install
npm run dev        # browser mode: Vite dev server (proxy → 127.0.0.1:3000)
npm run app:dev    # desktop app in dev mode (Tauri; needs Rust)
npm run check      # tsc --noEmit + ESLint — always before npm test
npm test           # Vitest
npm run build      # web build (dist/)
npm run app:build  # desktop app + installers (NSIS/MSI, deb/rpm/AppImage, dmg)
```

`app:build` first produces a ready-to-run app (Windows:
`src-tauri\target\release\app.exe`, assets embedded — no install needed) and then
also packages installers. `npm run app:build -- --no-bundle` skips packaging for
the fastest path to a fresh executable.

The TypeScript API types (`src/api/`) are committed and used as the build input.
Regenerate them deliberately with `npm run api:types`, which fetches the OpenAPI
contract from the [LuraDB repository](https://github.com/hwein/luradb) (`main` for
released, `next` for in-development API).

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the scope,
rules and the one-time CLA. Report vulnerabilities via the path in
[SECURITY.md](SECURITY.md), never through public issues.

## License

Functional Source License 1.1 with an Apache 2.0 future grant
([FSL-1.1-ALv2](LICENSE.md)).
