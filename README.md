# CALI

CALI is a web-based academic workspace for Rizal Technological University students. The current repository is one React, Vite, and TypeScript npm project. The planned Node API will live in api/, with server-only logic in server/.

For the product scope, confirmed decisions, and development sequence, read cali.md.

## Local development

Use a compatible Node.js version, then run:

~~~powershell
npm install
npm run dev
~~~

The project also has npm run build and npm run lint scripts.

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

Auth, onboarding, and manual weekly schedules are implemented. Class reminders and the other application modules described in cali.md are planned work.
