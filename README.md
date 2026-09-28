# Cali

CALI is a web-based academic workspace for Rizal Technological University students. The current repository is one React, Vite, and TypeScript npm project. The planned Node API will live in api/, with server-only logic in server/.

For the product scope, confirmed decisions, and development sequence, read cali.md.

## Local development

Use a compatible Node.js version, then run:

~~~powershell
npm install
npm run dev
~~~

The project also has `npm run build`, `npm run lint`, and `npm test` scripts.

## Schedule module

The schedule management and intake flow is implemented. Students can create subjects and meetings manually, edit saved details, and delete a subject from either one of its meeting cards or the Unscheduled section. Deleting a subject also removes all of its weekly meetings, so deletion does not leave an unscheduled copy behind. Imported subjects explicitly marked without a meeting time can remain in Unscheduled until the student schedules or deletes them. Destructive actions and unsaved edits use confirmation dialogs.

Students can also import a schedule from an RTU registration/assessment form. The scanner accepts JPG, PNG, and WebP images and runs entirely on the device with the Apache-licensed PaddleOCR.js SDK, a background browser worker, and locally hosted PP-OCRv5 models. It works in the regular web app and the installed PWA. Images are not uploaded or stored, and no paid OCR service or generative AI is used. Semester and term text are ignored.

The import flow extracts subjects, units, block sections, meetings, and rooms into an editable review. OCR can be inaccurate, so the review prominently asks students to compare every detail with the source form. Missing or questionable details use restrained warning and error highlights; missing required values prevent saving and link directly to the affected field. Students can correct results, add or remove meetings, and confirm the final replacement in a modal before saving. The reviewed import replaces the current schedule atomically through `replace_own_schedule`, so a failed replacement does not leave a partial schedule.

Scanning can be cancelled from the scanner's close or Cancel controls. Because cancellation discards the selected image and unfinished results, Cali asks for confirmation while keeping the live scanner visible behind the confirmation dialog. Scanner failures are shown as concise, user-facing recovery messages rather than raw module or worker errors. If a deployment leaves an old JavaScript chunk open, the scanner offers a reload action to update Cali.

Scanner limits are 12 MB per image and 20 megapixels. Images are reduced to a maximum 2048-pixel edge for processing. There is no scan count, daily quota, subscription, or API usage limit. Manual entry remains available when local scanning is unsupported or a form cannot be recognized.

Apply all Supabase migrations before testing. `20260925010000_replace_own_schedule.sql` adds the authenticated atomic replacement function used by the scanner.

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in your local `.env`. The anon key is the public browser key. Never put a service role key in a `VITE_` variable or commit `.env`.

## Task module

The Tasks page is a responsive student planner with Today, Upcoming, and Board views. Quick capture requires only a title and due date, with an optional subject; students can expand planning details only when useful to add a planned work date, estimate, importance, notes, or an ordered checklist. Today separates overdue work, today’s plan, and suggested next work, while the original To do, In progress, and Done board remains available with persistent drag-and-drop ordering and accessible Move to actions.

The planner follows the same solid surface, spacing, typography, and responsive system as Schedules in light and dark themes. Desktop uses compact grouped task rows; mobile stacks Today and Upcoming into one readable column, while Board keeps its snap-aligned horizontal columns. Filters and task fields use styled, keyboard-accessible dropdowns, and destructive or unsaved-change actions require confirmation.

Task creation, movement, and checklist changes use authenticated database functions. Row-level security keeps tasks and checklist steps private to their owner, and linked subjects must belong to the same student. Deleting a schedule subject keeps its tasks and changes their subject to General. Completed tasks remain in Done until reopened or deleted.

The dashboard uses the same planner ranking and shows the next unfinished checklist step when one exists. It prioritizes overdue work, today’s work, and then the nearest deadlines. Date-only tasks remain due through the end of their local calendar day; a supplied due time makes the deadline precise.

Apply both task migrations before opening the deployed Tasks page. `20260927000000_create_tasks.sql` adds the base table and create/move functions; `20260928000000_student_task_planner.sql` adds planned dates, estimates, private ordered checklist steps, and trusted checklist operations.

## Auth and onboarding

The app uses Google OAuth with PKCE and restores a saved session on startup. It checks the account with Supabase Auth and the database's `cali_is_eligible_user` function before allowing onboarding or `/dashboard`. Onboarding saves a unique lowercase username, a listed or custom program, and year level 1–5 through `cali_complete_onboarding`. This trusted database function reads the Google name and avatar from `auth.identities`; browser clients cannot write those fields. Returning profiles are refreshed through `cali_refresh_google_profile`.

Run the migrations against the linked project before testing Auth. Migration `20260924010000_auth_onboarding.sql` adds the eligibility policies, onboarding functions, and a `cali_before_user_created` hook function. The linked project has **Before User Created** enabled and points it to `public.cali_before_user_created`; check **Supabase Dashboard → Authentication → Hooks** if configuring another project. The database policies also reject ineligible accounts that already exist.

For local OAuth, open the Vite URL as `http://localhost:5173`. The linked Supabase project's current Auth Site URL and allowed redirect URL use that origin. For deployment, add the deployed origin to **Authentication → URL Configuration → Redirect URLs** and set the Site URL appropriately. Keep the Google provider enabled in **Authentication → Providers**. A live OAuth test requires an actual verified `@rtu.edu.ph` Google account; test new onboarding, returning session, sign out, and rejection of a non-RTU account.

For a phone on the same Wi-Fi as the development PC, start Vite with `npm run dev` and open `http://192.168.100.15:5173` on the phone. Vite listens on the LAN, and that exact URL is in the linked project's Auth redirect allowlist. If the PC's Wi-Fi address changes, update the allowlist entry in `supabase/config.toml` and the linked project's Auth URL Configuration. `localhost` on a phone means the phone itself and will not reach the PC. For regular mobile use, deploy to an HTTPS origin and allow that origin in Supabase.

The initial program options are a short subset of [RTU's published undergraduate offerings](https://www.rtu.edu.ph/college/). Students can enter any other program as text.

The reusable CALI logo assets are `src/assets/cali-wordmark.svg` and `src/assets/cali-wordmark-white.svg`. Both have transparent backgrounds and are used through the shared wordmark component.

## Project layout

- src/: React application
- public/: static assets and future web app assets
- api/: reserved for later Vercel Node API endpoints
- server/: reserved for later server-only business logic
- supabase/migrations/: database migrations
- cali.md: current project decisions and plan

Auth, onboarding, manual weekly schedule management, local schedule scanning, and student task planning are implemented. Closed-tab class reminders and the remaining application modules described in cali.md remain planned work.

## Vercel deployment

The repository is configured as a Vite project with `dist` as its build output. `vercel.json` preserves the service-worker and manifest headers and rewrites application routes such as `/tasks` to `index.html`. The linked Vercel project is `jadeee/cali`.

The Vercel project is connected to `https://github.com/jdcnnn/cali.git`. Pushes to `main` create production deployments and pushes to other branches create previews. Check recent deployments with `npx vercel ls cali`; `npx vercel --prod` remains available for an intentional manual production deployment.

Before deployment, run `npm test`, `npm run lint`, and `npm run build`. Apply all migrations to the target Supabase project and configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel for the required environments. Add the deployed origin to the Supabase Auth redirect URLs. Never expose `SUPABASE_DB_PASSWORD`, a service-role key, or other server credentials as Vite environment variables.

All repository migrations through `20260928000000_student_task_planner.sql` are already applied to the currently linked Cali Supabase project, and the linked schema passes `supabase db lint`. A different Supabase project still needs the complete migration sequence.

## Progressive web app

Cali is installable from supported desktop and mobile browsers. Signed-in students can find installation guidance under Profile. On iPhone and iPad, open Cali in Safari and use Share → Add to Home Screen.

The current PWA is intentionally online-only. Its service worker provides the root-scoped foundation needed for future class-reminder notifications and a navigation-only connection-unavailable page. It does not cache the app, Supabase data, or OCR files for offline use. Navigations bypass HTTP caches, service-worker updates bypass the browser cache, and the app checks for a worker update when it starts so deployed versions are adopted without requiring a PWA reinstall.

Returning students keep their Supabase session. Public-page calls to action open the dashboard directly when a completed signed-in session is present instead of starting Google OAuth again.

Cali provides styled pages for unknown routes, authentication failures, denied access, and unexpected application errors. While an open page is offline, a status notice explains that loading and saving require internet access and briefly confirms when Cali reconnects. The service worker provides the same connection-unavailable explanation for failed page navigations after it has been installed.

Schedule deletion is subject-based: choosing Delete subject from a meeting card or an Unscheduled subject removes that subject and all of its weekly meetings through the database cascade. It does not leave a second copy in Unscheduled. Subjects intentionally imported without a real meeting time may remain unscheduled until they are scheduled or deleted.
