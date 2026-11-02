# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Next.js version warning

This project uses Next.js **16.4.3**, whose APIs, conventions, and file structure differ from older Next.js versions. Before writing framework code, read the bundled version-matched docs in `node_modules/next/dist/docs/` (start with `01-app/01-getting-started/` and `01-app/02-guides/`). `AGENTS.md` contains a managed block that `next dev` writes and re-adds; leave it intact — removing it only recreates an uncommitted change.

## Commands

Package manager is pnpm 12 (Node >= 20.9). `pnpm-workspace.yaml` is not a monorepo workspace — it only holds pnpm's `allowBuilds` settings.

```bash
pnpm dev      # dev server with Turbopack on http://localhost:3000
pnpm build    # production build
pnpm start    # serve the production build
pnpm lint     # ESLint (flat config: eslint-config-next core-web-vitals + TypeScript)
```

There is no test framework configured, so there are no test or single-test commands.

## Framework configuration

- `next.config.ts` enables `cacheComponents: true` and `partialPrefetching: true`. This is Next.js's Cache Components model: cache async work with the `'use cache'` directive plus `cacheLife`/`cacheTag`, and stream uncached async data from components wrapped in `<Suspense>`. Prefer this over legacy caching APIs (`unstable_cache`, unprofiled `revalidateTag`) — check the bundled caching and revalidating docs before adding data fetching or mutations.
- Routing is App Router, with all application code under `src/`. The TypeScript path alias `@/*` maps to `src/*`.
- Next 16 conventions apply: request interception belongs in `proxy.ts` (`middleware.ts` is deprecated in Next 16), and route props use generated global types such as `LayoutProps<"/">` and `PageProps<...>` rather than hand-written param types.
- Tailwind CSS v4 is wired through Turbopack, not PostCSS: `next.config.ts` registers `@tailwindcss/turbopack` as the loader for `*.css`. There is intentionally no `postcss.config.*`. Global Tailwind import and theme tokens/colors live in `src/app/globals.css`.

## Architecture

- `src/app/layout.tsx` is the root layout: loads Geist/Geist Mono via `next/font/google`, imports global CSS, and applies the font CSS variables and full-height body classes.
- `src/app/page.tsx` (route `/`) is the entire application: one `'use client'` dashboard for a Vietnamese vehicle-maintenance tracker. It fetches from Supabase in `useEffect`, keeps data/selection/expansion in `useState`, and renders an expandable timeline grouped by year. The vehicle switcher works; the add-vehicle FAB has no handler or persistence yet.
- `src/lib/supabaseClient.ts` creates the Supabase client at module scope using `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (publishable key, safe for the browser) and throws a clear error when either is missing. There is no Auth configured.
- Database source of truth is `sql.md`: `vehicles` (garage), `maintenance_events` (service history, FK `vehicle_id`), and `maintenance_items` (line items, FK `event_id`, embedded by the dashboard query). `service_logs`, `service_items`, and the `service_type`/`cost_item_type` enums are legacy schema that no code queries.
- Upcoming maintenance is **computed, not stored**: `generateNextMilestone(currentOdo, vehicleType)` derives the next milestone (cars step 5,000 km, motorbikes 2,000 km), assigns a tier (`CẤP NHỎ` … `CẤP LỚN`) with hardcoded estimated costs/items, and stamps `due_date` with the current time. Every row from `maintenance_events` is treated as completed history — the DB has no upcoming/completed flag.
- Timeline behavior: cars sort before motorbikes and the first car is selected by default; `unifiedTimeline` is the virtual upcoming event plus history; groups follow insertion order (upcoming first, then history by descending ODO); the current year and previous year are expanded by default while other years are collapsed.
- No other routes, route handlers, server-rendered data fetching, auth, or tests exist. Supabase rows are cast (`as unknown as MaintenanceEvent[]`) because no generated DB types are checked in, so schema changes are not caught by TypeScript.

## Security state

- There is no Auth and no `user_id` anywhere. The browser uses the publishable key, so anyone with the site URL can query PostgREST directly; RLS is the only enforcement boundary. `sql.md` currently documents anon policies only for the legacy `service_logs`/`service_items` tables — verify RLS status for `vehicles`/`maintenance_events`/`maintenance_items` in the Supabase dashboard before deploying publicly.

## Conventions

- All UI copy is Vietnamese; keep new user-facing text in Vietnamese unless told otherwise.
- Styling uses Tailwind utility classes with a zinc/emerald palette and `dark:` variants (dark mode follows `prefers-color-scheme`).
- Client Components are prerendered on the server: do not read the current time during render (`new Date()`), or Next 16 raises `blocking-prerender-current-time-client`. The milestone generator is only reached after client-side data loads; keep any new time reads inside effects or event handlers.
- Before relying on the schema at compile time, generate Supabase types and replace the `as unknown as` casts. When moving beyond this client-only dashboard, check the bundled Cache Components docs before adding server-side data access.
