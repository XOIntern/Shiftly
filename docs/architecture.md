# Architecture

How Shiftly is put together: the apps in this repo, how they talk, and where the product direction in [DESIGN.md](../DESIGN.md) is heading. Status labels distinguish what is **built** (code exists in this repo) from what is **planned** (decided in DESIGN.md, not yet implemented).

## System overview

```
┌─────────────────────┐        ┌─────────────────────┐        ┌────────────┐
│ client/             │  HTTP  │ server/             │  SQL   │ PostgreSQL │
│ React 19 + Vite SPA │ ─────► │ Elysia on Bun       │ ─────► │ (Prisma 8) │
│ TanStack Router     │  JSON  │ Elysia routes       │        │            │
└─────────────────────┘        └─────────────────────┘        └────────────┘
```

Two apps in one repository, deployed separately:

- **client/** is the browser app. Everything a supervisor, Nestle viewer, or operator sees.
- **server/** is the API. Elysia HTTP handlers that own all business rules (roster validation, shift rules, RBAC) and the only path to the database.

There is no shared package yet. When the client needs API types from the server, the plan is to serve Elysia's type information via its Edén/Treaty RPC layer or a generated contract, not to hand-copy interfaces. Decided when the first real endpoint lands.

## Client

Built. Stack as installed in [client/package.json](../client/package.json):

| Concern        | Choice                             | Why                                                                                    |
| -------------- | ---------------------------------- | -------------------------------------------------------------------------------------- |
| Framework      | React 19 + TypeScript 6            |                                                                                         |
| Bundler        | Vite 8                             | Fast dev server, the ecosystem default for this stack                                    |
| Routing        | TanStack Router, file-based routes | Type-safe routes, generated tree in `src/routeTree.gen.ts`, auto code splitting enabled  |
| Server state   | TanStack Query v5                  | Caching, retries, and offline mutation queueing surface for later                       |
| Client state   | Zustand v5                         | Small UI/app state (filters, selections); server state stays in TanStack Query          |
| Table          | TanStack Table v9                  | Headless, needed for the roster grid (DESIGN.md 6.2)                                    |
| Forms          | TanStack Form                      | Headless, same family                                                                   |
| Styling        | Tailwind CSS v4                    | Via `@tailwindcss/vite` plugin, CSS-first config                                        |
| Components     | shadcn on Base UI                  | Source-owned components in `src/components/ui/`, theme tokens map from DESIGN.md 13     |
| Animation      | Motion                             | Shift popover/cell transitions, sync spinner (DESIGN.md 11); respect `prefers-reduced-motion` |
| Lint           | Oxlint                             | Config in `.oxlintrc.json`                                                              |

Structure:

```
client/src/
├── routes/          # file-based routes (__root.tsx, index.tsx, about.tsx)
├── components/ui/   # shadcn components (button.tsx so far)
├── lib/utils.ts     # cn() and small helpers
├── assets/
└── index.css        # Tailwind entry, design tokens land here
```

Planned per DESIGN.md: role-scoped route trees (section 12), the virtualized roster grid (6.2), the operator read-only view (6.3), and an offline-first layer where edits persist locally before syncing (section 8). TanStack Query is already in place to carry that layer.

## Server

Built. Stack from [server/package.json](../server/package.json):

- **Elysia** on Bun (`bun run --watch src/index.ts`). One app instance in [src/index.ts](../server/src/index.ts) so far, listening on port 3000.
- **Prisma 8 (RC)** using the **contract** workflow. This differs from the classic generator flow, so here is how it works in this repo:

```
src/prisma/contract.prisma   # models, the source of truth you edit
        │  bun run contract:emit   (prisma contract emit)
        ▼
src/prisma/contract.json     # emitted schema contract
src/prisma/contract.d.ts     # emitted TypeScript types
        │
        ▼
src/prisma/db.ts             # postgres<Contract> client from @prisma/orm-postgres,
                             # configured in prisma.config.ts with DATABASE_URL
```

- Models are defined only in `contract.prisma`. Never edit `contract.json` or `contract.d.ts` by hand; re-run `bun run contract:emit` after schema changes.
- `DATABASE_URL` comes from `.env` (loaded by `dotenv/config` in both `db.ts` and `prisma.config.ts`).
- Reference notes for the Prisma version live in [server/prisma-8.md](../server/prisma-8.md).

Current schema has one model (`User` in [contract.prisma](../server/src/prisma/contract.prisma)). Planned, driven by DESIGN.md: Employee, Line, Shift, RosterEntry, Request, and audit tables for force majeure and conflict resolution. The runtime requirement "offline edits are stored locally first, then synced" (DESIGN.md 8) means the API must be designed around idempotent, client-generated mutations with conflict detection; that constraint shapes endpoint design more than anything else in this system.

## Cross-cutting decisions

| Decision            | State    | Detail                                                                                     |
| ------------------- | -------- | ------------------------------------------------------------------------------------------ |
| Language of the API | Built    | TypeScript everywhere, ESM (`"type": "module"`) in both apps                                |
| Package manager     | Built    | Bun for the server; the client moved to Bun too (see commit history)                        |
| Design tokens       | Planned  | CSS variables from DESIGN.md section 13 go in `client/src/index.css`, Tailwind v4 reads them |
| Auth                | Planned  | `User` model exists with password hash; session/token strategy undecided                    |
| RBAC                | Planned  | Four roles from DESIGN.md 12: Nestle, Sodexo HO, Sodexo Site, Operator. Enforced server-side; the client hides what a role cannot use |
| Deployment          | Undecided | No hosting config in the repo yet                                                          |

## Data flow, target shape

```
Operator edits a cell (offline)
  → client writes to local storage, marks cell pending (amber dot)
  → connection returns, TanStack Query mutation queue drains
  → server validates against shift rules (5+2, 4-day break, request demand)
  → accepted: server persists, client clears the pending marker
  → rejected/conflict: cell gets a conflict state, both versions shown in the review panel
```

This flow is the reason the server owns every rule check: the client may be offline or lying, so the server is the single point where the roster can be judged valid.

## Known gaps

- The server has no roster, employee, or request endpoints yet; it returns a hello-world string.
- No tests exist in either app (`server` test script is a placeholder).
- `client/README.md` and the repo `README.md` are still Vite template boilerplate.
- Auth, deployment, and the offline sync engine are decided only at the DESIGN.md level, not implemented.
