# Shiftly: Architecture Document

| | |
|---|---|
| Version | 0.4 |
| Source | Derived from PRD v0.2 |
| Status | Awaiting review; some decisions still TBD (see section 10) |
| Audience | Developers building Shiftly |

> This document describes the **target architecture**; the repo now implements its foundation — Better Auth with three roles, PostgreSQL via Drizzle ORM, and dashboard CRUD for sites, site_locations, users, workers, and work areas (roster/attendance/reporting pages are descriptive stubs). Decisions that are not yet final remain marked **TBD** so they are not mistaken for agreed-upon choices.
>
> **Revision (Oct 2026):** the `client` entity was removed. The domain model is now `site` 1:N `site_locations`, with three roles — **superadmin** (full access), **HO** (one site), **admin** (one site_location). Operational data (departments, workers, MP requests, rates) lives at the location level (departments were later moved to the site level — see the latest revision note).
>
> **Update (Oct 2026):** the formerly-TBD database (PostgreSQL), ORM/migrations (Drizzle), and session auth (Better Auth, email + password) are now decided and partially implemented — see sections 2, 6, and 10.
>
> **Revision (Oct 2026):** departments moved from the site_location level to the **site** level, and a new **work_area** entity was added. `department` is parented under `site`; `work_area` is scoped by both a `site_location` and a `department`, guarded by composite foreign keys that require the location and department to belong to the same site. Workers, MP requests, and rates remain at the location level.
>
> **Revision (Oct 2026):** the **department** entity was removed. `work_area` is now the single grouping unit, parented directly under `site_location` — the same-site guarantee comes from the `(site_location_id, site_id)` composite foreign key into `site_location (id, site_id)`. Users may bind optionally to a work area. The roster engine's grouping unit — MP requirements, assignments, and rule C7 — is the work area. The department concept is retired; this note supersedes the earlier revision notes above wherever they mention departments.
>
> **Update (Oct 2026):** rule configuration and the audit trail are now implemented as real tables — `roster_rule_config` and the append-only `audit_log` in `drizzle/schema/rule-config-schema.ts`, managed through a Settings page. Rule config resolves at **three** scope levels (global base → per-site override → per-location override); this supersedes the "per site" wording in §5.2 and §6 wherever it appears.
>
> **Revision (2026-10-20, rules):** the work-area-match rule (the old C7) is removed — the enum change is one-way. The qualification rule — formerly C8 — is now **C7**, dormant until workers carry qualifications and work areas declare requirements. The rule set is **C1–C7**. This note supersedes the earlier revision notes above wherever they reference the old C7/C8 numbering.
>
> **Revision (Oct 2026, qualifications):** a worker now holds a **set** of positions (1..n) through the new `worker_position` pivot; the single `worker.position_id` column is gone. The pivot carries a denormalized `site_id` welded by two composite foreign keys — `(worker_id, site_id)` → `worker (id, site_id)` and `(position_id, site_id)` → `position (id, site_id)` — so a cross-site pair is impossible at the DB level, and `(worker_id, position_id)` is the primary key, so a duplicate pair is too. Position deletion is blocked only while a live (non-soft-deleted) worker still holds the position. The qualification rule (now C7) stays dormant: assignment-side qualification requirements are not implemented.

---

## 1. Overview

Shiftly is a **multi-site & multi-location** web platform for roster and attendance management of Sodexo outsourced workers, starting with the Nestle pilot (Nestle, Google, Huawei are `site` rows in the data model). The architecture stands on four pillars:

1. A **deterministic Roster Engine** that auto-generates weekly draft rosters in compliance with all configurable work rules, and **refuses to publish rosters that violate rules** (unmet requirements are reported as explicit deficits, not silently violated).
2. **Scope-based isolation at the data level**: the superadmin has full access, each HO is bound to exactly one site (covering all its site_locations), each Admin to one site_location — and all queries are automatically scoped to the session's bound site/location on the server.
3. **Fully config-driven**: roster rules and salary rate structures are changed via configuration by HO, with no code changes.
4. **An audit trail** for sensitive decisions: roster publishing, configuration changes, attendance corrections, force majeure handling.

System context:

```mermaid
graph LR
    SA["Sodexo Superadmin<br/>global: creates sites,<br/>assigns HO per site"]
    HO["Sodexo HO<br/>one site: creates site_locations,<br/>assigns Admin per location"]
    AS["Sodexo Admin<br/>roster, attendance, force majeure<br/>limited to 1 site_location"]

    S(("Shiftly"))

    SA -->|manage sites & HO accounts,<br/>full access to everything| S
    HO -->|manage locations & Admin accounts,<br/>per-site configuration| S
    AS -->|manage roster & attendance,<br/>enter MP requirements| S
    S -->|dashboard & reports| HO & SA

    S ---|roster & attendance| W["Worker<br/>(never logs in at all)"]
```

Workers are **never** users of the system. All input (roster and attendance) is performed by the Admin of the location. Clients (Nestle, Google, Huawei, …) have **no access** to the application — their MP requirements arrive via manual channels (email/WhatsApp) and are entered by the Admin.

The operational hierarchy: a **site** (e.g. Nestle) is managed by exactly **1 HO**; a site contains many **site_locations** (1:N); each site_location is managed by its own **Admin**.

---

## 2. Tech Stack

| Layer | Choice | Status |
|---|---|---|
| Framework | Next.js 16 (App Router) | Implemented |
| UI | React 19, Tailwind CSS 4, shadcn/ui | Implemented |
| Language | TypeScript | Implemented |
| Runtime / package manager | Bun | Implemented |
| Database | PostgreSQL 18 (docker compose for local & prod) | Implemented |
| ORM / migrations | Drizzle ORM + drizzle-kit (`drizzle/schema/`, `drizzle/migrations/`) | Implemented |
| Authentication | Better Auth — session-based (email + password), three roles; optional MFA in a later phase | Implemented (MFA not yet) |
| Hosting / deployment | Docker images (`Dockerfile`, `compose.prod.yaml`); external host | External host **TBD** |
| Tests | Bun's built-in test runner (`bun test`), DB-backed suites need the compose Postgres | Implemented |

Rationale for PostgreSQL (from the PRD): scheduling data is relational and query-rich, and data integrity matters for attendance and the audit trail.

---

## 3. High-Level Architecture

A modular monolith on Next.js App Router: one deployable, with clear module boundaries at the code level (not microservices). The heaviest core module (the Roster Engine) runs as pure server-side logic so it can be tested with property tests without I/O.

```mermaid
graph TB
    subgraph "Next.js Application (App Router)"
        UI["UI Layer<br/>(RSC + client components,<br/>responsive, payload-efficient)"]
        subgraph "Domain Modules"
            AUTH["1. Auth & RBAC"]
            MD["2. Master Data<br/>(site, site_location,<br/>work_area, shift, worker)"]
            REQ["3. Request Management<br/>(weekly & daily MP requirements)"]
            RULES["4. Rules & Configuration<br/>(rules engine config)"]
            ROSTER["5. Roster Engine<br/>(generate + validate + publish)"]
            ATT["6. Attendance"]
            REP["7. Reporting & Dashboard"]
            PAY["8. Payroll Config & Estimation"]
        end
        SVC["Cross-module services:<br/>scope guard (location/site) · audit trail ·<br/>CSV/Excel export/import"]
    end
    DB[("PostgreSQL")]
    FILES["Worker import &<br/>report export (CSV/Excel)"]

    UI --> AUTH & MD & REQ & RULES & ROSTER & ATT & REP & PAY
    RULES --> ROSTER
    MD --> ROSTER
    REQ --> ROSTER
    ROSTER --> ATT
    ATT --> PAY
    ATT --> REP
    AUTH & MD & REQ & ROSTER & ATT & REP & PAY & RULES --> SVC
    SVC --> DB
    SVC --- FILES
```

### Separation principles

- **Pure domain logic**: the generator, rule validator, and salary estimation calculations are written as pure functions (data in, results out), decoupled from UI and database. This is a prerequisite for the correctness and performance evaluation in section 5.
- **Scope-based isolation as a data-access layer**: not the "manual filter on every page" pattern, but a single centralized mechanism that forces all domain queries through the session's scope (location for Admin, site for HO, everything for superadmin) (section 7).
- **Configuration as data**: rules (C1–C7) and salary rates are stored as configuration rows, read by the engine at runtime, not hardcoded constants.

---

## 4. Core Modules and Responsibilities

| # | Module | Responsibilities | Primary users |
|---|---|---|---|
| 1 | Auth & RBAC | Login sessions, 3 roles (Superadmin, HO, Admin), binding users to sites/locations | All |
| 2 | Master Data | Site, site_location (location/city), work_area, shift definitions, worker (qualifications, PKWT/PKWTT, active status), user accounts per scope, CSV/Excel import | Superadmin (sites, HO accounts), HO (locations, Admin accounts), Admin (workers) |
| 3 | Request Management | Weekly & daily MP requirements entered by the admin on behalf of the client; weekly requests approved or rejected by HO, withdrawn by the admin while still open, status follows the roster | Admin, HO |
| 4 | Rules & Configuration | Global roster rule parameters (C1–C7) + per-site overrides, change history | HO |
| 5 | Roster Engine | Auto-generate drafts, real-time validation, block publishing while violations exist, explicit deficits, publish auditing | Admin |
| 6 | Attendance | Daily per-shift attendance input (present/leave/sick/absent), bulk input, corrections with a trail, attendance without a roster as an exception | Admin |
| 7 | Reporting & Dashboard | MP realization vs. requirement, workers approaching limits, attendance recap, export (per-location & cross-site views) | HO, Superadmin |
| 8 | Payroll Config & Estimation | Rate structure per shift/site/location/worker, salary estimation calculated from attendance, export | HO, Superadmin |

Module dependencies flow one way (the table above is ordered from upstream to downstream): Rules and Master Data feed the Roster Engine; the published output becomes the basis for Attendance; Attendance feeds Salary Estimation and Reporting. This direction is enforced so upstream modules never depend on downstream ones.

---

## 5. Roster Engine (Core Module)

The engine is **deterministic (rule-based), not generative AI**: output must be explainable and reproducible.

### 5.1 Internal components

```mermaid
graph LR
    REQIN["MP requirements<br/>(work area x shift x day)"]
    CFG["Active RuleConfig<br/>(global + site override)"]
    W["Worker pool<br/>(qualifications, day accumulation,<br/>shift history)"]

    GEN["Generator<br/>(deterministic greedy heuristic)"]
    VAL["Validator<br/>(evaluates C1-C7)"]
    DRAFT["Draft roster<br/>(always valid)"]
    DEF["Deficit report<br/>(per work area/shift/day)"]

    REQIN --> GEN
    CFG --> GEN
    W --> GEN
    GEN --> VAL
    VAL --> DRAFT
    GEN --> DEF
    VAL -.->|"reject rule-violating candidates"| GEN
```

- **Generator**: fills MP coverage requirements by selecting candidates that minimize violation risk (lightest load, furthest from work-day limits). Regeneration can be done per work area without affecting other work areas.
- **Validator**: a pure function that evaluates assignments against all active rules and returns violations **with specific reasons** ("5 work days this week already", "Shift 3 yesterday, mandatory day off", "Mandatory break not yet taken"). Used in two places: the generator (candidate selection) and the roster editor (real-time validation while the admin edits manually).
- **Publish gate**: a roster cannot be published while violations remain. Publishing writes an audit trail (who, when, roster version).

### 5.2 Configurable rules (C1–C7)

| ID | Rule | Default |
|---|---|---|
| C1 | Maximum work days per week per worker | 5 days (5+2 pattern) |
| C2 | Maximum work days per month per worker | 20 days |
| C3 | Forward shift rotation (1 → 2 → 3), no "dropping" to an earlier shift | active |
| C4 | After shift 3, the following day must be a rest day | active |
| C5 | Mandatory break trigger: accumulated work days since the last break | 60 work days |
| C6 | Mandatory break duration | 4 consecutive days |
| C7 | Workers only assigned to work requiring a qualification they hold (dormant until qualification data exists) | active |

Global configuration can be overridden per site and per site_location (most specific wins). Only HO (or superadmin) may change it, every change is logged (old value → new value), and changes only apply to rosters created afterward (not retroactive). Implemented: the `roster_rule_config` table with scope-specific partial unique indexes (section 6).

### 5.3 Evaluation strategy (engine acceptance criteria)

| Aspect | Target |
|---|---|
| Correctness | 0 violations in a simulation of 7 work areas x up to 200 workers/work area x 12 weeks, including full load |
| Coverage | >= 95% of MP requirements met; the remainder reported as an accurate deficit |
| Fairness | Difference in work-day distribution between workers within one work area <= 2 days/month |
| Performance | Weekly roster generation for one site_location (worst case ~1,400 workers) < 30 seconds |

Because the engine is a pure function, all targets above are tested via unit/property tests without requiring UI or a database.

---

## 6. Data Model

Core entities (from PRD 4.1):

```mermaid
erDiagram
    SITE ||--o{ SITE_LOCATION : "has (1:N)"
    SITE_LOCATION ||--o{ SHIFT_DEFINITION : "owns"
    SITE_LOCATION ||--o{ ROSTER_PLAN : "owns"
    SITE_LOCATION ||--o{ MP_REQUEST : "receives"
    SITE ||--o{ RULE_CONFIG : "site-level overrides (HO)"
    SITE ||--o{ RATE_CONFIG : "site-level rates"
    SITE_LOCATION ||--o{ RATE_CONFIG : "location rates"
    SITE_LOCATION ||--o{ WORK_AREA : "hosts"
    POSITION }o--o{ WORKER : "worker_position qualification set"
    WORKER ||--o{ ROSTER_ASSIGNMENT : "assigned"
    WORKER ||--o{ ATTENDANCE_RECORD : "recorded"
    WORKER ||--o{ RATE_CONFIG : "per-worker override"
    ROSTER_PLAN ||--o{ ROSTER_ASSIGNMENT : "contains"
    SHIFT_DEFINITION ||--o{ ROSTER_ASSIGNMENT : "defines"
    SHIFT_DEFINITION ||--o{ RATE_CONFIG : "rate per shift"
    USER }o--o| SITE : "HO bound to 1 site"
    USER }o--o| SITE_LOCATION : "Admin bound to 1 location"
    USER }o--o| WORK_AREA : "optional work-area binding"
    USER ||--o{ AUDIT_LOG : "performs"

    SITE {
        string name "e.g. Nestle, Google, Huawei"
    }
    SITE_LOCATION {
        string name "physical location/city, e.g. Jakarta vs Bogor"
    }
    USER {
        string role "superadmin | ho | admin (superadmin unbound)"
    }
    MP_REQUEST {
        string type "weekly | daily"
        string status "open | approved | fulfilled | rejected | withdrawn"
    }
    ROSTER_PLAN {
        string status "draft | published"
        string version "for publish auditing"
    }
    ROSTER_ASSIGNMENT {
        date date "worker x date x shift"
    }
    ATTENDANCE_RECORD {
        string status "present | leave | sick | absent"
        bool without_roster "exception with a trail"
    }
    RULE_CONFIG {
        string scope "global | per site | per location"
        json parameter "C1-C7, old -> new values in audit"
    }
    RATE_CONFIG {
        string scope "location | site | worker"
        decimal hourly_rate "per shift definition"
    }
    AUDIT_LOG {
        string action "publish, config change, attendance correction, force majeure"
    }
```

Schema design notes:

- **Implemented so far**: `site`, `site_location`, `user`, `work_area`, `position`, `worker`, `worker_position`, `roster_rule_config`, and `audit_log` exist as real tables (`drizzle/schema/site-schema.ts`, `drizzle/schema/auth-schema.ts`, `drizzle/schema/work-area-schema.ts`, `drizzle/schema/position-schema.ts`, `drizzle/schema/worker-schema.ts`, `drizzle/schema/rule-config-schema.ts`) with FK-restricted parent references, `is_active` flags where applicable, and **soft delete** (`deleted_at` + partial unique indexes that ignore deleted rows). `site` and `site_location` carry `(id, site_id)` unique keys so the `work_area`, `position`, and `worker` composite FKs can enforce same-site scoping at the DB level. `roster_rule_config` resolves each rule (C1–C7) at three scopes — global base, per-site, per-location — via scope-specific partial unique indexes, with a CHECK welding every location-level row to its parent site; the append-only `audit_log` is the soft-delete exception (rows are written once and kept, no `updated_at`). Better Auth adds its own `session`, `account`, and `verification` tables. All remaining entities below are still design-only.
- **Deletion guards**: a `site` is refused deletion while live work areas exist under it; existing site_locations, work areas, and users have their own guards (users check work-area bindings first). A `position` is refused deletion only while a live worker still holds it in `worker_position`. A soft-deleted `site` is listed by the sites page when its list filter is set to Deleted sites (`?show=deleted`), where the superadmin can restore it (the site row only, still inactive; refused when a live site now has its name) or delete it permanently, one at a time or in bulk: its master data (locations, work areas, positions, shifts, workers, users, rule config) is purged with it in one transaction, and the purge is refused while any roster plan, request, or audit-log row exists for the site, so history is never deleted. A database test lists every foreign key into the tables that purge removes and fails when a table is neither purged, history-guarded nor removed by cascade, so a table added later cannot block the delete unnoticed. A soft-deleted `site_location` follows the same pattern on the locations page (`?show=deleted`, with the site filter kept for the superadmin): the superadmin and an HO inside their own site can restore it (the location row only, `is_active` kept; refused when its site is deleted or a live location of the site has its name), and the superadmin alone can delete it permanently, one at a time or in bulk. That purge removes the location's work areas, shifts, workers, users and location-level rule config in one transaction, is refused while a live work area, worker, shift or bound user remains, and is refused while any roster plan, request, or audit-log row exists for the location or was written by one of its users, so history is never deleted. A foreign row answers "Deleted location not found." rather than proving it exists, and a database test covers the foreign keys into the purged tables as it does for sites. Soft-deleted `position` and `work_area` rows are listed the same way on their pages (`?show=deleted`, showing site, location for work areas, and the deleted date). Every role that can delete there can restore, inside its own scope (superadmin all; HO their site; admin their own location, and for positions the site of their location), and a row outside the scope answers "Deleted position/work area not found." A restore keeps `is_active` and is refused when the parent is deleted (the site for a position, the location for a work area), when a live row already holds the name, and, for a work area, when a position it requires is itself deleted. Permanent delete is superadmin only: a position is removed on its own and refused while any worker or work-area link points at it, links of soft-deleted workers and work areas included (those links are what a later restore of them checks, so the owner is purged first), and on any request line; a work area is removed together with its own position links and refused on any roster assignment or request line. A database test per entity covers the foreign keys into the purged tables. Soft-deleted `shift_definition` and `worker` rows are listed the same way on the shifts and workers pages (`?show=deleted`, with site, location and the deleted date; shift order sorts numerically). All three roles can delete there, so all three can restore, inside their own scope (superadmin all; HO their site; admin their own location), and a row outside the scope answers "Deleted shift/worker not found." A restore keeps `is_active` and is refused when the location is deleted, when a live shift in the location now uses the order index (the unique-index error maps to the same text) or a live worker the employee id, and, for a worker, when a position it holds is itself deleted. Permanent delete is superadmin only: a shift is removed on its own and a worker together with its own position links, and both are refused on any roster assignment (a shift also on any request line), leaving every row in place. A database test per entity covers the foreign keys into the purged tables. Soft-deleted users are listed the same way on the users page (`?show=deleted`, showing name, email, role, binding and the deleted date), with the access the page already has: a superadmin sees and restores every deleted user, an HO exactly the deleted admins of their own site's locations, deleted locations included, and a row outside that reach answers "Deleted user not found." A restore keeps `is_active`, leaves credentials untouched and recreates no session; it is refused when an admin's location is deleted, when an HO-role user's site is deleted, or when a live user now has the email. Permanent delete is superadmin only: it removes the user row, and sessions and accounts go through the foreign-key cascade, but it is refused for any user who authored an audit row, generated or published a roster plan, or created a request, so history is never deleted. User ids are text, so bulk selection checks for a non-empty id rather than a uuid. A database test covers the foreign keys into `user`.
- **No client entity**: the earlier Client → Site hierarchy was removed (Oct 2026 revision). What used to be "the client" (Nestle Group) is now a **site**; what used to be "a site with a city" is now a **site_location**. Client companies remain external counterparties — they convey MP requirements manually — but are not tables in the system.
- **Site is framework, location is operations**: a `SITE` carries its name and its HO binding; shift definitions, workers, MP requests, and location rates all live under `SITE_LOCATION`.
- **Work areas**: a `WORK_AREA` is a plain child of a `SITE_LOCATION`. It carries denormalized `site_id` with a composite foreign key — `(site_location_id, site_id)` → `site_location (id, site_id)` — so a work area physically cannot hang off a location from a different site. Partial unique `(site_location_id, name)` ignoring soft-deleted rows.
- **Worker positions**: a `POSITION` is a site-level catalog entry (`(id, site_id)` unique). A `WORKER` belongs to one `SITE_LOCATION` (composite FK welding it to the same site) and holds a **set** of positions through `WORKER_POSITION`, whose two composite FKs — `(worker_id, site_id)` and `(position_id, site_id)` — weld every pair to a single site. `(worker_id, position_id)` is the primary key; there is no separate id. Editing a worker replaces its whole set in one transaction (delete → update → insert), and moving a worker to another site rewrites every pivot row's `site_id`.
- **Multi-site & multi-location from day one**: every operational table carries a `site_location` reference (its site is derivable through it), so data isolation never depends on a "single site" assumption.
- **User bindings**: `role` ∈ (superadmin, ho, admin). The HO carries exactly one `siteId`; the Admin carries exactly one `siteLocationId`; the superadmin is bound to nothing and has full access. Users may additionally carry an optional `workAreaId` (nullable FK, delete-restricted; scoped management mirrors the work-area module).
- **Versioned RosterPlan**: publishing creates a new version recorded in the audit trail; post-publish edits produce the next version.
- **AttendanceRecord without a roster**: attendance for a worker without a roster entry remains possible, flagged as an exception (dispensation) with a trail.
- **Hierarchical RuleConfig**: a global row as the base, per-site and per-location rows as overrides (managed by HO). The same resolution pattern is used by RateConfig (section 8).
- Configuration changes are **not retroactive**: a published roster stores the configuration context in effect when it was created.

---

## 7. Auth, RBAC, and Scope-Based Isolation

### 7.1 Roles

| Role | Binding | Access scope | Rights |
|---|---|---|---|
| Superadmin | — (unbound) | All sites & all their site_locations | Create sites, create HO accounts, global rule & rate configuration, full monitoring |
| HO | Exactly one site | All site_locations of that site | Create site_locations & Admin accounts for their site, per-site rule & rate overrides, monitoring & reporting within the site |
| Admin | Exactly one site_location | Only that location | Manage their location's roster, attendance, workers; enter MP requirements on behalf of the client |

Note: the client (e.g. Nestle) has no access to the application; MP requirements arrive via manual channels (email/WhatsApp) and are entered by the Admin. 1 site : 1 HO and 1 site_location : 1 Admin are the intended bindings.

### 7.2 Enforcement at the data level

The principle from PRD US-11: scoping is enforced **at the data/authorization level, not by hiding UI**. The implementation status:

1. Every user session carries its scope: superadmin = "all", HO = one site (covering all of its site_locations), Admin = one site_location — implemented in `lib/scope.ts` (`scopeOf`, `canManageUser`, `userScopeFilter`).
2. All access to operational data (workers, roster, attendance, MP requests, site configuration) goes through a single data-access layer that **must** inject the location filter (for Admin) or the site filter (for HO) from the session; superadmin bypasses filters. Domain modules have no query path that bypasses it. (Implemented for the user/site/location, work-area, and rule-config modules; the roster/attendance modules don't exist yet.)
3. Session-based authentication via Better Auth (email + password) on the server, mounted at `app/api/auth/[...all]/route.ts`; soft-deleted users are blocked from sign-in and their sessions evicted. Optional MFA in a later phase.

---

## 8. Rate Resolution and Salary Estimation

Rate resolution is hierarchical, from most specific wins:

```
per-worker override  →  location rate  →  site rate  →  global default
```

- Rates are defined **per shift** (shifts 1, 2, 3 differ) and can vary by location/city within a site (e.g. Nestle Jakarta vs Nestle Bogor) and by site.
- Salary estimate = recorded work hours/days (from attendance and published rosters) x the rate at the highest applicable resolution.
- Attendance changes (corrections, force majeure) automatically update estimates; recaps are available per worker, work area, shift, location, site, and period, with Excel/CSV export for the existing payroll process.
- Architectural boundary: Shiftly stops at **estimation**. No deductions (BPJS, PPh21), no payslips, no payroll bookkeeping.

---

## 9. Key Data Flows

```mermaid
flowchart LR
    A["Admin inputs weekly<br/>MP requirements (from client)"] --> A2["HO approves<br/>the request"]
    A2 --> B["Admin<br/>generates draft roster"]
    B --> C["Edit + real-time validation"]
    C -->|violations remain| C
    C -->|valid| D["Publish roster<br/>(audit trail)"]
    D --> E["Daily attendance<br/>entered by admin"]
    E --> F["Recap & reports"]
    E --> G["Salary estimation<br/>(attendance x rate)"]

    H["Client's daily request<br/>(entered by Admin)"] -.->|same validation| D
    I["Force majeure:<br/>worker suddenly absent"] -.->|"valid replacement candidate<br/>(qualified, lowest load)"| D
```

Request lifecycle: a weekly request is `open` until HO approves or rejects it, and only an `open` request can be edited. An `approved` request is the basis for that week's roster; publishing the roster marks it `fulfilled`. A daily request needs no approval and becomes `fulfilled` when its slot is filled. An admin can withdraw an `open` request, weekly or daily: it becomes `withdrawn`, which is terminal. The request stays in the list and in the audit trail, and its one-per-period slot is free for a replacement request. HO rejects a request; it does not withdraw one. An unpublished draft roster can likewise be discarded by an admin, which removes its assignments; published versions are never deleted, and the requests behind a discarded draft stay `approved`.

Two side paths (daily requests, force majeure) modify the running-day roster and **must pass the same validator** as the weekly roster, then are recorded in the audit trail.

---

## 10. Open Technical Decisions (TBD)

| # | Decision | Status |
|---|---|---|
| 1 | Database | **Decided (Oct 2026): PostgreSQL 18**, docker compose for local dev and prod bundles |
| 2 | Session auth library/approach | **Decided (Oct 2026): Better Auth** — session-based email + password |
| 3 | Hosting & deployment | Partially decided: Docker (`Dockerfile`, `compose.prod.yaml`); **external host still TBD** — before the pilot |
| 4 | ORM/schema migration tooling | **Decided (Oct 2026): Drizzle ORM + drizzle-kit** |
| 5 | Background job strategy (e.g. v1.1 notifications) | **TBD** — before v1.1 |

Decisions the PRD **has already locked** and are not being reopened: a deterministic engine (not generative AI), scope-based isolation at the data level (location for Admin, site for HO, full access for superadmin), the **Oct 2026 domain-model revision** (no client entity; `site` 1:N `site_locations`; roles superadmin/HO/admin; workers, MP requests, and rates at the location level) — superseded on the department point by the latest revision note (the department is removed; `work_area` is the `site_location` child and the engine's grouping unit), all rules config-driven, no worker self-service, no payslips/deductions.

Decisions made since (see the table above): PostgreSQL + Drizzle ORM, Better Auth session authentication, Docker for packaging.

---

## 11. Non-Functional Considerations

| Aspect | Architectural target |
|---|---|
| Daily operational pages | Per-shift attendance loads in < 2 seconds for ~200 workers; pagination and no heavy assets |
| Engine performance | Roster generation < 30 seconds for a full site (~1,400 workers) |
| Scale | ~7 work areas per site_location x 200 workers per site_location; multi-site & multi-location correct in the schema from day one |
| Weak networks | Daily operational pages are payload-efficient (not a PWA/offline in v1; re-evaluated in v2.0) |
| 3-shift operations | No maintenance windows during operational hours without notice |
| Sensitive data security | Rates/salary editable by HO only, always audited, not exposed externally; worker personal data (NIK, etc.) access is restricted |

---

## 12. Roadmap Implications for the Architecture

| Phase | What it affects in the architecture |
|---|---|
| MVP (4–6 weeks) | Modules 1–6 plus rate configuration; scope-based isolation and the multi-site/multi-location schema **from the first commit**; engine + validator as pure functions so they can be verified before the Nestle pilot |
| v1.1 | Daily requests, force majeure, dashboard/export, full audit trail, salary estimation: no core schema changes, only new flows on top of the MVP foundation |
| v2.0 | New-site onboarding purely via master data (no new deployment); notifications (email/WA), API integration, PWA/offline: connection points are prepared through module separation, but not built in the MVP |

---

## 13. References

- PRD v0.2 (not part of the repo's published tree): source of all requirements, rules C1–C7, user stories, the Sept 17 discovery decisions, and the Oct 2026 domain-model revision (no `client`; `site` 1:N `site_locations`; roles superadmin/HO/admin).
- PRD appendix: interpretation of the discovery decisions that underpins the architectural choices in this document.
