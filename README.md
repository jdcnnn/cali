# Cali

CALI is a web-based academic workspace for Rizal Technological University students. The current repository is one React, Vite, and TypeScript npm project. The planned Node API will live in api/, with server-only logic in server/.

For the product scope, confirmed decisions, and development sequence, read cali.md.

## Local development

Use a compatible Node.js version, then run:

~~~powershell
npm install
npm run dev
~~~

The project also has npm run build and npm run lint scripts.

## Schedule module

The schedule management and intake flow is implemented. Students can create subjects and meetings manually, edit saved details, remove individual meetings, and keep subjects without meeting times in the Unscheduled section. Destructive actions and unsaved edits use confirmation dialogs.

Students can also import a schedule from an RTU registration/assessment form. The scanner accepts JPG, PNG, and WebP images and runs entirely in the browser with the Apache-licensed PaddleOCR.js SDK and locally hosted PP-OCRv5 models. Images are not uploaded or stored, and no paid OCR service or generative AI is used. Semester and term text are ignored.

The import flow extracts subjects, units, block sections, meetings, and rooms into an editable review. Missing details prevent saving and link directly to the affected field. Students can correct results, add or remove meetings, and confirm removals before saving. The reviewed import replaces the current schedule atomically through `replace_own_schedule`, so a failed replacement does not leave a partial schedule.

Scanner limits are 12 MB per image and 20 megapixels. Images are reduced to a maximum 2048-pixel edge for processing. There is no scan count, daily quota, subscription, or API usage limit. Manual entry remains available when local scanning is unsupported or a form cannot be recognized.

Apply all Supabase migrations before testing. `20260925010000_replace_own_schedule.sql` adds the authenticated atomic replacement function used by the scanner.

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in your local `.env`. The anon key is the public browser key. Never put a service role key in a `VITE_` variable or commit `.env`.

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

Auth, onboarding, manual weekly schedule management, and local schedule scanning are implemented. Closed-tab class reminders and the other application modules described in cali.md remain planned work.

## Progressive web app

Cali is installable from supported desktop and mobile browsers. Signed-in students can find installation guidance under Profile. On iPhone and iPad, open Cali in Safari and use Share → Add to Home Screen.

The current PWA is intentionally online-only. Its service worker provides the root-scoped foundation needed for future class-reminder notifications and a navigation-only connection-unavailable page. It does not cache the app, Supabase data, or OCR files for offline use.

Returning students keep their Supabase session. Public-page calls to action open the dashboard directly when a completed signed-in session is present instead of starting Google OAuth again.
