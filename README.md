# Shiftly

A multi-client, multi-site web platform for roster and attendance management of outsourced workers — starting with the Nestle Group pilot.

## About

Shiftly's target architecture stands on four pillars:

1. A **deterministic Roster Engine** that auto-generates weekly draft rosters and refuses to publish rule-violating rosters (unmet requirements are reported as explicit deficits)
2. **Site-scoping at the data level** — every non-HO user is bound to exactly one site, enforced server-side
3. **Fully config-driven** rules and salary rates, changed by HO via configuration, with no code changes
4. **An audit trail** for every sensitive decision (publishes, config changes, attendance corrections, force majeure)

The full target architecture — modules, data model, rules C1–C7, and open decisions — is documented in [`docs/architecture.md`](./docs/architecture.md).

## Tech stack

| Layer | Choice | Status |
|---|---|---|
| Framework | Next.js 16 (App Router) | Scaffolded |
| UI | React 19, Tailwind CSS 4 | Scaffolded |
| Language | TypeScript | Scaffolded |
| Runtime / package manager | Bun | Scaffolded |
| Database | PostgreSQL (recommended) | TBD |
| Authentication | Session-based (email + password) | TBD |
| Hosting / deployment | — | TBD |

## Getting started

Prerequisites: [Bun](https://bun.sh) 1.4+.

```bash
bun install
bun dev
```

Open [http://localhost:3000](http://localhost:3000) to see the result. The app auto-reloads as you edit files under `app/`.

## Available scripts

| Script | What it does |
|---|---|
| `bun dev` | Start the development server |
| `bun run build` | Production build |
| `bun run start` | Serve the production build |
| `bun run lint` | Run ESLint |

## Notes for contributors

> ⚠️ This repo uses a newer Next.js with breaking API and convention changes. Read the bundled guides in `node_modules/next/dist/docs/` (after `bun install`) before writing route, layout, or server code — and heed deprecation notices. Do not rely on Next.js patterns from older versions.

The project is in an early scaffold stage. Auth, UI library, and container setup are being worked through the repository's issue tracker.
