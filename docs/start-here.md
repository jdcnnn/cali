# Start here

For a complete explanation of every module and the supporting infrastructure, read [Cali's end-to-end technical guide](technical-guide.md).

Cali is one React application connected to Supabase for sign-in and saved data. You can learn it one feature at a time. Start with Tasks, then move to Schedules or Calendar; Study adds OCR, document editing, and AI generation, so leave it for later.

## First session

1. Run `npm install`, then `npm run dev`. On Windows, use `npm.cmd` if PowerShell blocks `npm`.
2. Follow the environment setup in the [README](../README.md#local-development). Keep `.env` private. The configured Supabase project may contain live data, so use your own account and disposable records when checking changes.
3. Open `src/main.tsx`: this starts React, loads global styles, and renders `App`.
4. Open `src/App.tsx`: search for `<Routes>` to find the pages and their URLs. This file also contains the shared workspace layout and access checks. You do not need to understand every function on the first read.
5. Pick one screen and follow its imports using the map below.

## Where things live

| Location | Purpose | When to open it |
| --- | --- | --- |
| `src/components/` | Page screens and reusable controls | Changing what a user sees or clicks |
| `src/lib/` | Data types, calculations, validation, browser utilities, and the Supabase client | Understanding a screen's data and rules |
| `src/styles/` | Page and shared CSS | Changing appearance; start with the stylesheet imported by your page |
| `src/auth/` | Sign-in and the current student's session | Understanding login and access |
| `src/theme/` | Theme state and controls | Changing light/dark theme behavior |
| `src/hooks/` | Shared React behavior | Understanding an imported `use...` function |
| `api/` | Server endpoints used by the frontend | Following an AI generation request |
| `server/` | Server-only reviewer generation and validation | Working on AI generation |
| `supabase/migrations/` | Ordered SQL history defining tables, access rules, and database functions | Understanding how data is stored or saved |
| `supabase/functions/send-reminders/` | Background reminder sender | Working on push reminders |
| `public/` | Static files, app icons, service worker, and OCR models | Working on installation, reminders, or scanning assets |
| `scripts/` | Build checks, asset generation, and provider verification | Maintaining development/deployment tools |

`node_modules/` is installed dependency code and `dist/` is generated build output. Skip both when learning the app. Keep existing migrations: they are database history, including filenames that mention testing.

## Follow one feature: creating a task

Read these in order:

1. `src/components/TasksPage.tsx`: search for `TaskEditor` to see the form, then `saveTask` to see what happens when it is submitted.
2. `src/lib/tasks.ts`: look at `Task`, `TaskDraft`, `emptyTaskDraft`, and `validateTaskDraft`. These describe task data and the form's rules.
3. Back in `saveTask`, find `supabase.rpc("cali_save_own_task", ...)`. `rpc` calls a database function; this is where the task and checklist are saved together.
4. `supabase/migrations/20261014073723_audit_security_and_atomic_tasks.sql`: search for `cali_save_own_task` to see that database function and its ownership checks. Earlier task migrations describe the tables it uses.
5. `src/styles/tasks.css`: this is the page's main styling. Shared styles can also affect its controls and layout.

The flow is: form -> validation -> Supabase database function -> updated React state -> screen renders again. Many features use this pattern, although some read or write tables directly instead of calling a database function.

## Choose work by feature

| Feature | Starting screen | Related logic/styles |
| --- | --- | --- |
| Tasks | `src/components/TasksPage.tsx` | `src/lib/tasks.ts`, `src/styles/tasks.css` |
| Schedules | `src/components/SchedulesPage.tsx` | `src/styles/schedules.css`; follow `ScheduleScanner.tsx` only for import work |
| Calendar | `src/components/CalendarPage.tsx` | `src/lib/calendarColors.ts`, `src/styles/calendar.css` |
| Study | `src/components/StudyPage.tsx`, `src/components/StudySetsPage.tsx` | `src/lib/reviewers.ts`, `src/lib/studySets.ts`, `src/styles/study.css` |
| Community | `src/components/CommunityPage.tsx` | `src/lib/community.ts`, `src/styles/community.css` |
| Administration | `src/components/AdminDashboard.tsx` | `src/lib/admin.ts`, `src/styles/admin-*.css` |

For group work, let each person own a feature and coordinate edits to shared files such as `App.tsx` and global styles. A good first change is adjusting one page label or spacing, then tracing one save action before changing its behavior.

## Check a change

Run `npm run lint` and `npm run build`. The build checks TypeScript, required deployment settings, browser-bundle secrets, and asset budgets; it needs the environment variables described in the README.

The automated test files and test runner were removed to simplify this repository. Lint and build checks do not prove that a feature works. Open the affected page and manually check its normal flow, validation errors, cancellation, and saving/reloading. For visual changes, check both phone and desktop widths and both themes.

The README has setup and feature details. `cali.md` records product decisions; `HANDOFF.md` and audit documents contain deeper implementation and historical verification notes. You can read those when your feature needs them.
