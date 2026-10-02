# Cali handoff

Updated: 2026-10-02

## What this repository is

CALI (Class Ally) is an independent academic workspace for Rizal Technological University students. This is a React 19, TypeScript, Vite, and Tailwind CSS project with Supabase Auth and database migrations. `cali.md` records the broader product decisions and proposed modules; `README.md` covers local setup.

## Next phase decision

- Reminder timing is defined across classes, tasks, and events: 30 minutes, 1 hour, 3 hours, 5 hours, or Custom. Custom uses separate hours and minutes fields and must be non-zero. The confirmed $0 technology baseline is native browser Web Push, Supabase Postgres/RLS, a TypeScript Supabase Edge Function using pinned `web-push@3.6.7`, and an authenticated cron-job.org request once per minute. Vercel continues to host only the PWA. Delivery, subscriptions, migrations, and notification-click handling remain unimplemented.

## Completed work

### Product foundation and account flow

- Established the product scope, student journey, data model, and development sequence in `cali.md`.
- Added Supabase migrations for student profiles and repeating weekly schedule subjects/meetings, with ownership and eligibility policies.
- Added Google OAuth with PKCE, session restoration, sign-out, error and access-denied states, and a verified `@rtu.edu.ph` Google account eligibility check.
- Added first-sign-in onboarding for a unique lowercase username, program (listed or custom), and year level. Trusted database functions populate and refresh the Google name and avatar.
- Completed the workspace foundation: a responsive sidebar and mobile navigation, a personalized `/dashboard`, a `/profile` page, and routed Schedules, Tasks, Study, and Community pages. The dashboard shows compact live schedule and task summaries plus quick actions. It highlights classes happening now, the next three weekly meetings, and the next three actionable tasks. Dashboard and Schedules data use skeleton loading; empty states distinguish an unconfigured schedule, a day with no classes, and a day whose classes have finished.
- Added profile editing for the unique username, program, and year level, plus a confirmed account deletion flow backed by `20260925000000_delete_own_account.sql`.

### Landing page and splash

- Rebuilt the landing page with a focused hero, four feature cards (schedule, tasks, study, and Cali Community reviewer sharing), a three-step getting-started section, and an about section. Copy presents CALI's intended experience without invented implementation details or “upcoming” labels.
- Added smooth anchor scrolling, scroll offsets beneath the sticky header, and a logo link that returns to `/` without leaving `#home` in the URL.
- Added a mobile hamburger menu for navigation, theme controls, and “Try Cali for free”; its toggle stays within the header so it does not shift the hero.
- Reworked the splash into an academic lined-paper treatment without the side border or ripple. Its restrained wordmark reveal, rule, and status copy are smaller on mobile. Reduced-motion users bypass the splash animation.
- Added transparent blue and white CALI wordmark SVG assets. The graduation-cap detail in the light-on-dark asset uses a dark inner line.
- Added a favicon at `public/favicon.svg` using the graduation-cap shape and colors from the wordmark.

### Visual system, footer, and team

- Changed the palette from blue/indigo to cooler dodger-blue, aqua, and sky tones, and changed the body typeface to DM Sans. Theme tokens live in `src/index.css`.
- Added System (default), Light, and Dark preferences, persisted under `cali-theme`. An inline script applies the initial theme before the app loads. Dark mode covers the page, header, footer, cards, menus, splash, and account pages.
- Synchronized theme transition timing at 260 ms; the two wordmark variants crossfade with the surfaces rather than switching in a later React render.
- Redesigned the footer in the same light or dark theme as the page, with a smaller mobile wordmark, improved spacing, a “Meet the Cali team” link, and hover-only link underlines. The same footer is shared by the landing and team pages.
- Added `/team` with the four supplied team members, roles, bios, and photos.
- Added Terms & Conditions, Privacy Policy, and Community Guidelines pages.

### Dashboard and schedule design pass (2026-09-25)

- Tightened the Schedules header and placed the weekly-view instruction directly beneath its heading. Day cards remain equal in width and height, including empty days, across responsive layouts.
- Changed the empty-day copy to "No classes" ("No classes today" for the current day). Schedule and dashboard empty states now use muted gray icons, lighter type, and neutral backgrounds instead of prominent blue fills and heavy headings.
- Removed decorative gradients from the dashboard greeting, workspace title cards, profile identity card, onboarding intro, and team call to action. The greeting and workspace title cards now use solid white surfaces with borders. Functional gradients remain in the splash, loading skeleton, and time picker.
- Replaced the dashboard Quick Actions text list with three clickable icon cards for adding a class meeting, editing academic details, and opening study tools. Cards have hover and keyboard-focus feedback and reduced copy.

### Schedule management and local scanning (2026-09-25)

- Completed manual weekly schedule management: students can create subjects and meetings, edit saved details, and delete a subject with confirmation from any meeting card or directly from the Unscheduled section. Subject deletion cascades to all of its meetings and does not leave an unscheduled copy behind. Imported subjects explicitly lacking a meeting time can remain in Unscheduled until scheduled or deleted.
- Added a free, on-device RTU registration-form scanner using PaddleOCR.js, a background browser worker, locally hosted PP-OCRv5 models, and deterministic table parsing. It works in both the web app and installed PWA. Images are not uploaded or stored, and semester and term values are ignored.
- Added an editable three-step import flow for image selection, review, and saving. It supports subject and meeting corrections, additions, removal confirmations, prominent accuracy guidance, and direct links from missing-detail instructions to the affected fields. Final schedule replacement uses a confirmation modal on desktop and mobile.
- Added client and database validation for required schedule fields, duplicate records, valid RTU day codes, ordered meeting times, and bounded payload sizes.
- Added `20260925010000_replace_own_schedule.sql`. Its authenticated `replace_own_schedule` function validates the full import and replaces the current schedule in one transaction.
- Scanner limits are 12 MB and 20 megapixels per JPG, PNG, or WebP image, with a 2048-pixel maximum processing edge. There is no scan quota or paid OCR service.

### Installable web app foundation (2026-09-26)

- Made Cali installable as an online-only PWA on supported desktop and mobile browsers with a web app manifest, regular and maskable icons, Apple touch metadata, and a root-scoped service worker.
- The service worker cache-first stores only requested immutable files under the versioned `/ocr/v1/` model/runtime path. It never caches registration images, OCR results, app files, or Supabase data, and the app remains online-only. Navigation requests use `no-store`, service-worker registration uses `updateViaCache: 'none'`, and startup requests a worker update to reduce stale deployed assets without requiring users to reinstall the PWA.
- Added an installation section to Profile. Chromium browsers can launch their native install prompt; iPhone and iPad users receive Safari Add to Home Screen instructions; installed instances show their installed status.
- Public-page actions now respect the restored Supabase session. Ready students go directly to the dashboard, and students with unfinished onboarding resume setup instead of restarting Google OAuth.
- Added branded 404, authentication failure, access-denied, and unexpected application error states. A global notice reports when Cali goes offline and briefly confirms when Cali is back online.
- The navigation-only offline fallback is self-contained inside `public/sw.js`; it explains that Cali requires a connection and offers a retry action without caching the application.

### Recent responsive refinements (2026-09-26)

- Centered the calendar icon, copy, and Add a schedule action in the mobile dashboard's empty Your classes state.
- Simplified the Profile installation card by removing its decorative download icon. Its action remains full width on mobile.
- Corrected the offline and restored-connection notice icon contrast in light and dark themes and changed the restored copy to “Cali is back online.”

### Scanner reliability, review, and modal refinements (completed 2026-09-27)

- Reworked image preparation and OCR worker startup so the same local scanner runs reliably in the regular browser and installed PWA. The worker installs its abort path before model initialization, and cancellation disposes its internal transport immediately.
- The scanner can now be closed while recognition is active. Close and Cancel open a stop-scanning confirmation; keeping the scan returns to the live progress view, while stopping discards the selected image and unfinished result.
- Confirmation dialogs are layered above the still-visible scanner instead of replacing or hiding it. Their backdrops dim and blur the scanner while preserving the page → scanner → confirmation visual hierarchy and working pointer controls.
- Made the scanner fit small screens: progress markers keep circular proportions, summary counts remain in one row, content is contained without horizontal overflow, and review actions are smaller and safely inset from the bottom viewport.
- Replaced technical runtime and stale-chunk messages with concise recovery guidance. A stale deployed module offers a Reload Cali action; detailed errors remain in the developer console.
- Changed review guidance to “Details to verify,” removed decorative warning/missing-detail icons in favor of subtle yellow and red emphasis, added a prominent reminder that OCR may be inaccurate, and improved destructive/error contrast in dark mode. The final save confirmation no longer uses a warning icon.

### Student task planner (2026-09-28)

- Added task creation and editing with title, optional notes, required due date, optional due time, priority, and an optional schedule-subject link. Filters cover subject and priority.
- Added confirmed deletion, unsaved-change protection, overdue states, deliberate completion, dark-mode styling, loading/error/empty states, and a live dashboard summary of the next three actionable tasks.
- Refined the Tasks UI to match the Schedules workspace with solid theme-token surfaces, compact responsive planner rows, and an editor with grouped sections and a fixed action footer. Delete and unsaved-change actions use focused confirmation dialogs.
- Added `20260927000000_create_tasks.sql` with the private `tasks` table, indexes, validation, owner-only RLS, same-owner subject checks, `ON DELETE SET NULL` subject behavior, and atomic create/move functions.
- Added focused Vitest coverage for task validation, local deadline semantics, status ordering, completion transitions, and dashboard ranking.
- Added Today, Upcoming, and Completed as focused list views. Today separates overdue, planned/due-today, and suggested work; Upcoming groups approaching deadlines; Completed preserves access to finished work and reopening without a board.
- Simplified task capture into one unified details form: title, subject, due date, optional due time, importance, steps, and notes. The redundant planning disclosure and visible planned-date field were removed; “Add to today” still manages the internal planned date from the planner.
- Added `20260928000000_student_task_planner.sql` with private checklist steps, planner fields, ownership policies, and trusted checklist replacement/toggle functions. The dashboard now uses the same planner ranking and surfaces the next unfinished step.
- Replaced ambiguous completion controls with deliberate actions. Task previews show the next step without updating it; selecting task content in Today or Upcoming opens a responsive structured overview with explicit Mark done and Undo controls for steps plus separate Edit and full-task Mark done actions. Full-task completion still requires confirmation.
- Removed effort estimates and their summary metric from the interface, client model, and planner calculations; students now see only planning information that drives an immediate action. The deployed `estimate_minutes` column remains unused for non-destructive compatibility.
- Simplified Tasks on 2026-10-01 by removing the Kanban Board and embedded task Calendar. Today, Upcoming, Completed, task details, editing, steps, filters, completion, and reopening remain. Existing task status and ordering fields are retained for data compatibility, and calendar planning will move to a separate module.

### Independent Calendar foundation (2026-10-01)

- Added `/calendar` and placed Calendar directly after Tasks in the desktop sidebar and mobile navigation drawer.
- Added a dedicated Cali-branded Calendar screen that reads repeating class meetings and open task deadlines without changing their existing database models.
- Calendar follows the same centered width, spacing, and rounded surface system as the other workspace modules. It provides one focused Month view with a selected-day detail panel instead of duplicating the weekly and daily browsing already available in Schedules.
- Month date cells use blue academic-cap and amber checklist icons instead of repeated schedule text, dots, or abstract bars. The same indicators appear in the legend, and each full day cell selects a readable detail panel with full-size preview actions.
- Added a bottom-right Calendar create menu for Class meeting, Task deadline, and Event. Class and task creation receive the selected weekday/date through route parameters; Event is a separate private calendar record with title, date, optional time range, location, notes, and color.
- Added ten named color presets for schedule subjects and Events: Ocean, Sky, Teal, Mint, Fern, Sunflower, Tangerine, Coral, Rose, and Violet. Only the key is stored; theme-aware CSS values preserve contrast in light and dark mode. Migration: `20261001000000_calendar_events_and_colors.sql`.
- Added loading, retryable error, and first-use empty states. Calendar entries open preview modals with focused class or task details and a link to the owning module. Numeric section counts were intentionally omitted. Selected-date creation remains for the next Calendar phase.

### Web Push reminders (2026-10-02)

- Added independent reminders to every class meeting, task, and event. New items default to No reminder; available lead times are 30 minutes, 1 hour, 3 hours, 5 hours, and a custom value from 1 minute through 7 days. Tasks and events require a specific time.
- Added device-level Enable/Disable Notifications controls to Profile. Permission is requested only from a user action or when the user explicitly saves an item with a reminder. Signing out removes the current browser subscription; other subscribed devices remain active.
- Added private push subscriptions, an indexed next-reminder queue, per-device delivery records, owner RLS, trusted subscription RPCs, and automatic queue triggers in `20261002010000_push_reminders.sql`. Item edits rebuild pending work, completed/deleted tasks cancel it, and recurring classes enqueue their next weekly occurrence.
- Added the `send-reminders` Supabase Edge Function with pinned `web-push@3.6.7`, dedicated cron-secret authentication, atomic claiming, a 15-minute late-delivery window, up to three transient retries, permanent expired-subscription cleanup, and duplicate prevention per device.
- Extended `public/sw.js` with push display and notification-click handling. Notifications open the relevant class, task, or event. Class copy includes subject code/title and optional room; tasks include their subject and due time; events include their start time and optional location.
- Reminder calculations use Asia/Manila. cron-job.org remains the once-per-minute scheduler and must stay inactive until its final production smoke test is complete.
- The migration and Edge Function are deployed to the linked Supabase project. Production frontend deployment is live at `https://cali-class-ally.vercel.app`; the deployed service worker responds successfully and contains both push handlers.

## Current behavior and known follow-ups

- The last proposed mobile theme popover overlay was **reverted** at the user's request. In the current mobile menu, expanding the theme options takes up space and moves the “Try Cali for free” button down.
- Core schedule management and intake are complete: manual creation, editing, cascading subject deletion from scheduled or unscheduled views, local web/PWA form scanning, cancellable recognition, editable review, validation, and atomic replacement are working.
- The scanner fixes and modal enhancements are complete. No scanner-specific follow-up is currently planned.
- All migrations through `20261002010000_push_reminders.sql` are applied to the linked Cali Supabase project. Remote migration history matches the repository, and the linked public schema passes database lint.
- Vercel project `jadeee/cali` is connected to `https://github.com/jdcnnn/cali.git` and configured for Vite with `dist` output. The latest checked `origin/main` commit automatically produced a Ready production deployment with the `cali-git-main` alias. Use `npx vercel ls cali` to verify future automatic deployments.
- Closed-tab Web Push reminders are implemented and deployed. The remaining release step is to activate the prepared cron-job.org job and verify one authenticated run plus a real-device notification.
- The PWA manifest and service-worker foundation are complete. The reminder phase can extend `public/sw.js` with push and notification-click handlers without introducing application or data caching.
- Study and Community routes still explain planned tools. Schedules and Tasks are implemented, and the dashboard shows live upcoming classes and task deadlines.
- The independent Calendar foundation and event previews are implemented. Selected-date creation and direct record targeting remain follow-ups.
- Scanner behavior has been verified by the user in both the regular web app and installed PWA. The student planner passes `npm test`, `npm.cmd run build`, and `npm.cmd run lint`; its desktop/mobile CSS and dark-mode states are implemented, but live planner interaction and a full device matrix still require manual verification because browser automation was unavailable in this environment.
- Live OAuth requires a configured Supabase project, the migrations, redirect URLs, and a verified RTU Google account. See `README.md` for details. A live end-to-end OAuth check was not part of the landing-page styling work.

## Key files

| Area | Files |
| --- | --- |
| Routes, onboarding, and dashboard | `src/App.tsx`, `src/components/DashboardSchedules.tsx`, `src/components/dashboard-schedules.css` |
| Schedule page and scanner | `src/components/SchedulesPage.tsx`, `src/components/schedules.css`, `src/components/ScheduleScanner.tsx`, `src/components/schedule-scan.css`, `src/lib/scheduleOcr.ts`, `src/lib/rtuScheduleParser.ts` |
| Tasks and dashboard summary | `src/components/TasksPage.tsx`, `src/components/DashboardTasks.tsx`, `src/components/tasks.css`, `src/lib/tasks.ts` |
| Independent calendar | `src/components/CalendarPage.tsx`, `src/components/calendar.css` |
| Landing, team, policies, footer, and splash | `src/components/LandingPage.tsx`, `TeamPage.tsx`, `PolicyPage.tsx`, `SiteFooter.tsx`, `SplashScreen.tsx` |
| Shared wordmark and assets | `src/components/CaliWordmark.tsx`, `src/assets/` |
| Visual styles | `src/index.css`, `src/components/entry.css`, `src/theme/theme.css` |
| Theme state and picker | `src/theme/ThemeProvider.tsx`, `ThemeContext.ts`, `ThemePicker.tsx`, `index.html` |
| PWA, installation, connection, and reminders | `public/manifest.webmanifest`, `public/sw.js`, `src/components/InstallCali.tsx`, `src/components/ConnectionNotice.tsx`, `src/components/ReminderField.tsx`, `src/lib/pwaInstall.ts`, `src/lib/pushNotifications.ts`, `src/lib/reminders.ts`, `supabase/functions/send-reminders/index.ts` |
| Authentication and database | `src/auth/`, `src/lib/supabase.ts`, `supabase/migrations/` |
| Product plan and setup | `cali.md`, `README.md` |

## Run and verify

Install dependencies with `npm install`, then run `npm run dev`. Run `npm test`, `npm run build`, and `npm run lint` before shipping. Apply all Supabase migrations, including `20261002010000_push_reminders.sql`, before testing reminders. The local/Vercel frontend environment must define `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_VAPID_PUBLIC_KEY`; it is ignored by Git. Edge Function secrets are `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, and `CALI_CRON_SECRET`. Keep private keys, cron secrets, the service role, and `SUPABASE_DB_PASSWORD` out of browser-facing Vite variables. On this Windows setup, `npm.cmd` can be used if PowerShell blocks `npm.ps1`.

The generated `dist/` build can be recreated with `npm run build`.
