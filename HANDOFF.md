# CALI handoff

Updated: 2026-09-25

## What this repository is

CALI (Class Ally) is an independent academic workspace for Rizal Technological University students. This is a React 19, TypeScript, Vite, and Tailwind CSS project with Supabase Auth and database migrations. `cali.md` records the broader product decisions and proposed modules; `README.md` covers local setup.

## Completed work

### Product foundation and account flow

- Established the product scope, student journey, data model, and development sequence in `cali.md`.
- Added Supabase migrations for student profiles and repeating weekly schedule subjects/meetings, with ownership and eligibility policies.
- Added Google OAuth with PKCE, session restoration, sign-out, error and access-denied states, and a verified `@rtu.edu.ph` Google account eligibility check.
- Added first-sign-in onboarding for a unique lowercase username, program (listed or custom), and year level. Trusted database functions populate and refresh the Google name and avatar.
- Completed the workspace foundation: a responsive sidebar and mobile navigation, a personalized `/dashboard`, a `/profile` page, and routed Schedules, Tasks, Study, and Community pages. The dashboard shows a compact live schedule summary, a Tasks availability panel, and quick actions. It highlights classes happening now and the next three weekly meetings. Dashboard and Schedules data use skeleton loading; empty states distinguish an unconfigured schedule, a day with no classes, and a day whose classes have finished.
- Added profile editing for program and year level, plus a confirmed account deletion flow backed by `20260925000000_delete_own_account.sql`.

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

## Current behavior and known follow-ups

- The last proposed mobile theme popover overlay was **reverted** at the user's request. In the current mobile menu, expanding the theme options takes up space and moves the “Try Cali for free” button down.
- The manual Schedules page now has Monday–Sunday cards, day-specific add forms, saved meeting details, edit and delete menus, and styled confirmations for unsaved edits and deletion. Deletion removes only the selected meeting. Subjects with no timed meetings remain visible below the day cards.
- Registration-form image intake, browser OCR, AI parsing, review and atomic replacement, and closed-tab Web Push reminders are the remaining Schedule work. Reminder timing, delivery tolerance, and how students pause recurring reminders still need decisions.
- Tasks, Study, and Community routes still explain planned tools. The dashboard now shows live upcoming classes; task content remains future work.
- Recent visual changes passed `npm.cmd run build` and `npm.cmd run lint`. The browser session was unavailable for a live visual check; review the dashboard and Schedules layouts at desktop and mobile sizes when continuing.
- Live OAuth requires a configured Supabase project, the migrations, redirect URLs, and a verified RTU Google account. See `README.md` for details. A live end-to-end OAuth check was not part of the landing-page styling work.

## Key files

| Area | Files |
| --- | --- |
| Routes, onboarding, and dashboard | `src/App.tsx`, `src/components/DashboardSchedules.tsx`, `src/components/dashboard-schedules.css` |
| Schedule page | `src/components/SchedulesPage.tsx`, `src/components/schedules.css` |
| Landing, team, policies, footer, and splash | `src/components/LandingPage.tsx`, `TeamPage.tsx`, `PolicyPage.tsx`, `SiteFooter.tsx`, `SplashScreen.tsx` |
| Shared wordmark and assets | `src/components/CaliWordmark.tsx`, `src/assets/` |
| Visual styles | `src/index.css`, `src/components/entry.css`, `src/theme/theme.css` |
| Theme state and picker | `src/theme/ThemeProvider.tsx`, `ThemeContext.ts`, `ThemePicker.tsx`, `index.html` |
| Authentication and database | `src/auth/`, `src/lib/supabase.ts`, `supabase/migrations/` |
| Product plan and setup | `cali.md`, `README.md` |

## Run and verify

Install dependencies with `npm install`, then run `npm run dev`. Run `npm run build` and `npm run lint` before shipping. The local `.env` must define `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; it is ignored by Git. On this Windows setup, `npm.cmd` can be used if PowerShell blocks `npm.ps1`.

The generated `dist/` build can be recreated with `npm run build`.
