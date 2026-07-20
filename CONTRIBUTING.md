# Contributing to the LuraDB Web Client

This guide applies equally to human and AI contributors. It is short and direct
on purpose — the file itself is an example of the standard it describes: fast,
small, no bloat.

## 1. Project philosophy & scope

The Web Client is an **IDE for LuraDB**, and nothing else. It speaks the LuraDB
REST API and makes it pleasant to browse, query and administer — dense,
transparent, honest about the protocol underneath (see [README.md](README.md)
for the full positioning). It is not a general-purpose database GUI, not a
multi-backend tool, and it does not paper over gaps in the server. Every
contribution is measured against one sentence:

> Does it make working against the LuraDB API better — without inventing
> behavior the server does not have?

**Feature bar (binding).** A feature must:

- (a) demonstrate a real, provable benefit for that use case, and
- (b) not already be achievable, de facto, through existing screens.

Making that case is the proposer's job, not the maintainer's. Pure
quality-of-life features without substance get rejected. Anything the server API
does not support is solved honestly on the client, labeled visibly, or left out —
never simulated.

## 2. Ways to contribute

- **Bug reports** — open an issue with the client version, the server version
  (`GET /version`), reproduction steps, expected vs. observed behavior, and any
  relevant console output.
- **Feature contributions** — open a PR (see §3) and argue the feature bar from
  §1 in writing.
- **Documentation fixes** — open a PR.

The maintainer does not hold design discussions. The written case belongs in the
PR description (or an issue it links to). It gets read and decided, not debated.

## 3. Code contributions & CLA

PRs are open: no pre-approval, no mandatory issue, no need to contact the
maintainer first. If you understand the rules and the scope, submit directly.
Rejection stays on the table at any time — a feature PR without a convincing
written case carries that risk alone.

Merge prerequisites, beyond review and a green CI:

- The **CLA is agreed** — once. On your first PR, read [CLA.md](CLA.md) and add a
  comment stating: *"I have read the CLA and I agree to it."* That covers all your
  later contributions from the same account.

The CLA preserves the maintainer's ability to dual-license the codebase — the
public Fair Source license plus separate commercial terms — as a whole. Without
it, externally contributed lines would have to be excluded from that.

## 4. Binding rules

- PRs target `next`, never `main`. `next` builds against the LuraDB `next` API,
  `main` against the released `main` API.
- Commit messages follow [Conventional Commits
  1.0.0](https://www.conventionalcommits.org/en/v1.0.0/): imperative, concise,
  subject line ≤ 72 characters. A body is only needed if it explains something
  the diff doesn't already show. No tool/AI attribution trailers (no
  `Co-Authored-By` bot). Reference issues with `Fixes #N`, not a narrative.
- **TypeScript strict**, no `any` (use `unknown` + narrowing in the rare
  exception). Function components + hooks. Server state via TanStack Query only —
  no second cache in `useState`/context. Never hand-edit the generated API types
  (`src/api/schema.d.ts`).
- **Styling only through design tokens** — colors, radii, fonts always
  `var(--…)`, never hex/oklch literals in components. Both themes (dark/light)
  are considered for every UI change.
- The API key is never logged, never placed in URLs or query strings, never
  compiled into the bundle (no `VITE_` prefix for secrets).
- Code follows KISS: no over-engineering, no speculative abstractions, match the
  surrounding style. Comments are short and only for what isn't obvious. No
  backwards-compatibility hacks.
- New dependencies need explicit maintainer approval in an issue first (with
  justification).
- `npm run check` (runs before `npm test`) and `npm test` must both be green.
  New behavior comes with tests (Vitest + Testing Library; mock the API through
  MSW handlers, not ad-hoc fetch stubs).
- The public repo's language is English — code, comments, docs and commit
  messages.

## 5. What happens to your PR

CI must be green and the CLA signed; then the maintainer reads it and decides.

This is a spare-time project: there are no response-time guarantees, no
obligation to discuss or justify a decision, and no guaranteed review rounds. PRs
and issues that miss the feature bar, the rules or the scope can be closed
without comment.

An accepted PR is merged into `next` and ships with the next release (`next`
merges to `main` on release, tagged, published as a GitHub release). See the
repository's [Releases](https://github.com/hwein/luradb-web-client/releases) page.

## 6. AI-assisted contributions

Explicitly fine. The same rules apply without exception, and you are responsible
for what you submit, however it was produced. Generated bloat is treated exactly
like hand-written bloat: rejected.

## 7. Security

Never report a vulnerability through an issue or PR. Use the reporting path in
[SECURITY.md](SECURITY.md) instead.
