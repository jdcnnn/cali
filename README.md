# Cali

CALI is a web-based academic workspace for Rizal Technological University students. The repository is one React, Vite, and TypeScript npm project. Vercel Node endpoints live in `api/`, with shared server-only validation and generation logic in `server/`.

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

Scanner startup uses one Cali-owned module worker with PaddleOCR initialized inside it. Opening the scanner begins a deduplicated preload while file selection remains available; image preparation then runs concurrently with any remaining initialization. The initialized worker is reused for later scans, released after five idle minutes, and recreated cleanly after cancellation or failure. Vite resolves ONNX Runtime to its standard SIMD WASM entry instead of the larger JSEP runtime. The active PP-OCRv5 model archives and SIMD runtime live under `/ocr/v1/`. The unversioned model URLs are compatibility rewrites to those canonical files, so Vercel does not store a second model copy; the older `/ocr/runtime/` JSEP files remain only for already-open legacy deployments. The current models, thresholds, resolution, preprocessing, and deterministic parser remain unchanged. Setup, preparation, prediction, and total timings remain internal diagnostics and are not displayed to students.

Scanner limits are 12 MB per image and 20 megapixels. Images are reduced to a maximum 2048-pixel edge for processing. There is no scan count, daily quota, subscription, or API usage limit. Manual entry remains available when local scanning is unsupported or a form cannot be recognized.

Apply all Supabase migrations before testing. `20260925010000_replace_own_schedule.sql` adds the authenticated atomic replacement function used by the scanner.

Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_VAPID_PUBLIC_KEY` in your local `.env`. The publishable and VAPID public keys are safe browser values. Never put a service role key, VAPID private key, or cron secret in a `VITE_` variable or commit `.env`.

## Task module

The Tasks page is a focused responsive student planner with Today, Upcoming, and Completed views. Its unified task form keeps title, subject, due date, optional due time, importance, steps, and notes together without a separate planning section. Today separates overdue work, today’s plan, and suggested next work; Upcoming groups approaching deadlines; Completed keeps finished tasks accessible for review, reopening, editing, or deletion.

The planner follows the same solid surface, spacing, typography, and responsive system as Schedules in light and dark themes. Desktop uses compact grouped task rows, while mobile stacks them into one readable column. Task previews show the next step without changing progress. Selecting a task opens its structured overview, where each step has an explicit Mark done or Undo action. Editing, deletion, step progress, and final completion remain separate deliberate actions, and marking the full task done always requires confirmation. Date-based planning is available in the independent Calendar module.

Task creation, completion transitions, and checklist changes use authenticated database functions. Row-level security keeps tasks and checklist steps private to their owner, and linked subjects must belong to the same student. Deleting a schedule subject keeps its tasks and changes their subject to General. Existing status and ordering fields remain in the data model for compatibility even though the Kanban board is no longer shown.

The dashboard uses the same planner ranking and shows the next unfinished checklist step when one exists. It prioritizes overdue work, today’s work, and then the nearest deadlines. Date-only tasks remain due through the end of their local calendar day; a supplied due time makes the deadline precise.

Apply both task migrations before opening the deployed Tasks page. `20260927000000_create_tasks.sql` adds the base table and create/move functions; `20260928000000_student_task_planner.sql` adds the student-planner fields and private checklist operations. The application no longer reads or writes effort estimates; the deployed legacy column remains unused to avoid destructive data removal.

## Calendar module

Calendar is an independent workspace module at `/calendar`, placed directly after Tasks in the sidebar. It follows the same centered workspace width, spacing, and surface treatment as the other Cali modules. It combines repeating class meetings and open task deadlines in a focused monthly view while keeping the two event types visually distinct.

The month grid avoids repeating class names across every week. Each date uses recognizable academic-cap, checklist, and event icons to indicate class meetings, deadlines, and events, while a readable selected-day panel holds the actual details and preview actions. A bottom-right create menu opens the existing class and task forms with the selected date or weekday prefilled, or opens an Event form directly in Calendar.

Events are separate private records with a title, date, optional start and end time, optional location, notes, and a named color. Schedules save one color per subject and Events save one color per event. Both use the same ten Cali presets—Ocean, Sky, Teal, Mint, Fern, Sunflower, Tangerine, Coral, Rose, and Violet—with theme-specific values that remain clear in light and dark mode. Apply `20261001000000_calendar_events_and_colors.sql` before using these controls.

Events can be opened from the selected-day panel or a notification deep link, then edited or deleted with confirmation. Tasks and class meetings similarly open their exact Tasks or Schedules destination from a notification.

## Study module

Study implements private reviewers, flashcard sets, and quizzes. Students may build flashcards and quizzes from scratch or keep an existing reviewer visible while authoring. The reference can be changed later with **Use other reviewers**; the database derives its display title from the selected owned reviewer. Flashcards and quizzes do not call AI. Reviewer generation accepts up to ten photographed notebook pages or one digital PDF, creates a temporary editable AI draft, and saves it permanently only after explicit confirmation.

The three libraries share compact, responsive preview cards with consistent subject/date placement. Flashcard and quiz cards keep equal dimensions despite differing title or content length. Reviewer previews have no decorative top color bar, and flashcard/quiz previews omit the redundant “From subject” label. Detail pages use restrained hierarchy and responsive one- or two-column layouts; edit and delete actions live in the same three-dot pattern used by reviewers.

Flashcards use Front and Back fields, resumable sequential or shuffled sessions, and mastery after two consecutive successful recalls. Set details show real card counts and saved mastery progress without an invented percentage. The completion summary reports **Remembered** and **Still learning** counts. Starting another session preserves mastery; retrying an unfinished session requires confirmation because its current responses are replaced.

Quizzes support multiple-choice and true/false questions with an optional explanation. Only complete questions enter a quiz attempt. Saving a quiz with incomplete draft questions shows a warning that identifies the missing requirement for each affected question. Choice deletion and question-type changes are immediate editor actions; changing type resets that question's choices and correct answer. Deleting a question, discarding unsaved work, restarting an attempt, and deleting a quiz remain confirmed actions.

In the editor, the selected correct answer has a clear active style and an explicit **Remove selection** action. During an attempt, each submitted answer is evaluated immediately: the selected option and feedback panel use high-contrast semantic states, and the correct answer and optional explanation are shown. The same Correct and Incorrect treatment carries into result counts and per-question review. A student can skip an item; skipped items return after the last untouched question and must be answered before completion. Question and choice shuffling are applied to the immutable attempt snapshot and covered by focused tests. Results show Correct, Incorrect, and Total questions as counts rather than a percentage, followed by per-question Correct, Incorrect, or Skipped review labels. The overview keeps completed attempts as immutable history. Restarting marks the unfinished attempt abandoned before creating a new one, while deleting a quiz cascades to all its attempts.

Reviewer changes autosave after 1.2 seconds, and Done saves before closing the editor. If a save fails, Save now offers an explicit retry; leaving with unsaved work also offers Save and leave. All of those controls converge on one save function. A single in-flight promise prevents overlapping RPC calls, successful saves advance the editor's current revision, and later edits remain dirty for the next save. The `cali_update_own_reviewer` RPC rejects a stale expected revision with application error code `P0001`; it does not use retryable transaction code `40001`, and the client does not automatically retry conflicts.

Apply the Study migrations from `20261003000000_study_reviewers.sql` through `20261008093705_enhanced_academic_reviewers.sql` before using Study. Together they add private reviewer, flashcard, quiz, progress, attempt, generation-request, and short-lived draft storage; owner-only policies; atomic revision-checked saves; monthly AI quotas; reference-reviewer switching; and account-deletion coverage.

Major actions and status dialogs across Study, Tasks, Calendar, Schedules, Schedule Scanner, sign-out, and account deletion use the shared Cali confirmation treatment. It provides branded confirmation/default, warning, loading, success, error, and blue information states with non-broken inline SVG icons. Dialog copy stays specific to the action and does not add unsupported details.

## Reminders and Web Push

Classes, tasks, and calendar events each keep an independent optional reminder. The presets are 30 minutes, 1 hour, 3 hours, and 5 hours; Custom accepts a non-zero lead time from 1 minute through 7 days. Tasks and events need a specific time before a reminder can be selected. Editing an item rebuilds its pending reminder, while deleting an item or completing a task cancels pending work.

When a student saves an item with a reminder on a device that is not subscribed, Cali directly invokes the browser's native notification permission flow. The reminder still saves if permission or Push registration is unavailable. Profile contains the device-level Enable/Disable Notifications control and expandable banner instructions for Android, Windows, and macOS. Permission and subscription are per device; disabling or signing out on one device does not affect another device.

Notifications use Cali's icon, monochrome Android badge, high urgency, persistent interaction, and one item-specific action. Selecting the notification body or its action opens the exact class meeting, task, or event in Cali on desktop and in the installed Android PWA. The browser and operating system control background delivery and banner presentation. On Android, allow notifications for the browser or installed Cali app and enable Pop on screen, Floating notifications, or the equivalent banner option when available. On Windows, enable notification banners for Cali or the browser. On macOS, allow notifications and choose Banners or Alerts. Closed-app delivery still depends on permission, connectivity, browser push support, and operating-system settings.

If the browser reports a Push service registration failure, Cali refreshes the service-worker registration and retries once. A repeated failure is reported as browser Push connectivity guidance rather than a raw DOM error, and it never blocks the schedule item from saving. Reopen Cali and the browser, then try another network if registration still fails. Profile contains the organized setup, platform banner, and troubleshooting guidance.

The free delivery stack is native Web Push plus the root service worker, Supabase Postgres and Edge Functions, pinned `web-push@3.6.7`, and cron-job.org. `20261002010000_push_reminders.sql` adds reminder fields, private subscriptions, an indexed queue, delivery records, RLS, and queue functions. The deployed `send-reminders` Edge Function atomically claims at most 50 due reminders, accepts delivery up to 15 minutes late, retries transient failures up to three times, disables expired subscriptions, and prevents duplicate delivery per device. All reminder calculations use Asia/Manila.

### Reminder service configuration

Frontend environments require `VITE_VAPID_PUBLIC_KEY`. Set these Supabase Edge Function secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (the configured `mailto:` contact), and `CALI_CRON_SECRET`. Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to its deployed function; neither belongs in the browser environment.

The enabled cron-job.org job uses:

- URL: `<VITE_SUPABASE_URL>/functions/v1/send-reminders`
- Method: `POST`
- Schedule: every minute
- Time zone: `Asia/Manila`
- Header: `X-Cali-Cron-Secret: <CALI_CRON_SECRET>`
- Body: empty or `{}` with `Content-Type: application/json`

Keep the cron secret and VAPID private key out of Git, Vercel client variables, logs, and screenshots. A healthy invocation returns only aggregate counts such as `claimed`, `sent`, `missed`, and `retrying`; it does not return student records or notification content.

## Auth and onboarding

The app uses Google OAuth with PKCE and restores a saved session on startup. It checks the account with Supabase Auth and the database's `cali_is_eligible_user` function before allowing onboarding or `/dashboard`. Onboarding saves a unique lowercase username, a listed or custom program, and year level 1–5 through `cali_complete_onboarding`. This trusted database function reads the Google name and avatar from `auth.identities`; browser clients cannot write those fields. Returning profiles are refreshed through `cali_refresh_google_profile`.

Run the migrations against the linked project before testing Auth. Migration `20260924010000_auth_onboarding.sql` adds the eligibility policies, onboarding functions, and a `cali_before_user_created` hook function. The linked project has **Before User Created** enabled and points it to `public.cali_before_user_created`; check **Supabase Dashboard → Authentication → Hooks** if configuring another project. The database policies also reject ineligible accounts that already exist.

For local OAuth, open the Vite URL as `http://localhost:5173` and allow `http://localhost:5173/**` in **Supabase Dashboard → Authentication → URL Configuration → Redirect URLs**. Keep the Site URL set to the production origin, `https://cali-class-ally.vercel.app`, and keep the Google provider enabled. A live OAuth test requires an actual verified `@rtu.edu.ph` Google account; test new onboarding, returning session, sign out, and rejection of a non-RTU account.

For remote or phone testing without a Vercel deployment, run Vite on port 5173 and expose it through the reserved ngrok origin `https://afternoon-shame-petite.ngrok-free.dev`. The linked Supabase project must allow `https://afternoon-shame-petite.ngrok-free.dev/**` as a redirect URL; otherwise Google sign-in returns to production. Start the tunnel with `ngrok http --url=afternoon-shame-petite.ngrok-free.dev 5173`. Incognito is useful when a saved production session masks the local OAuth flow. The tunneled frontend uses the Supabase project configured in `.env`, so testing can change live project data.

Account deletion is permanent and transactional. `20261002020000_harden_account_deletion.sql` established the deletion contract, `20261003000000_study_reviewers.sql` extended it to reviewer data and reserved reviewer AI request/draft tables, and `20261005000000_flashcards_and_quizzes.sql` extended it to flashcard sets, quizzes, and quiz attempts. The transaction also removes reminder deliveries and queue entries, push subscriptions, task steps and tasks, calendar events, schedule meetings and subjects, the student profile, and the `auth.users` record. Existing foreign-key cascades remain as a second safeguard, including Supabase-managed identity and session cleanup. After the transaction succeeds, the client removes its Web Push subscription, local Auth session, and Cali theme preference. The current app does not persist student uploads in Supabase Storage; schedule scan images and OCR results stay on-device and are never stored. Any future user-owned table or Storage bucket must be added to this deletion contract before release.

The initial program options are a short subset of [RTU's published undergraduate offerings](https://www.rtu.edu.ph/college/). Students can enter any other program as text.

The reusable CALI logo assets are `src/assets/cali-wordmark.svg` and `src/assets/cali-wordmark-white.svg`. Both have transparent backgrounds and are used through the shared wordmark component.

The web and installed-app icon uses the exact graduation-cap structure from Cali's wordmark, with a white inner lining and a restrained light-blue top highlight. Edit `public/icons/cali-mark.svg`, then run `npm run icons` to regenerate the regular, maskable, Apple, and favicon assets. All variants share the same master geometry. The generator also writes a size/mask review sheet to `dist/icon-preview/`; run it after a build if you need the previews, since Vite clears `dist`. When changing artwork, bump the icon URL version in the HTML and manifest. Existing installed apps may refresh their icons on the browser or operating system's own schedule.

## Project layout

- src/: React application
- public/: PWA manifest/icons, service worker, and versioned local OCR assets
- api/: authenticated Vercel Node endpoints
- server/: server-only validation, prompting, and reviewer conversion logic
- supabase/migrations/: database migrations
- cali.md: current project decisions and plan

Auth, onboarding, manual weekly schedule management, local schedule scanning, student task planning, the independent Calendar, closed-tab reminders, AI-assisted and manually authored reviewers, flashcards, and quizzes are implemented. The remaining application modules are described in cali.md.

## Vercel deployment

The repository is configured as a Vite project with `dist` as its build output. `vercel.json` forces the full type-checked `npm run build`, enables Fluid Compute, gives reviewer generation a 120-second function limit, preserves the service-worker, manifest, and immutable `/ocr/v1/` headers, rewrites legacy `/ocr/models/*` requests to the canonical `/ocr/v1/models/*` files, and rewrites application routes such as `/tasks` to `index.html`. The linked Vercel project is `jadeee/cali`.

The Vercel project is connected to `https://github.com/jdcnnn/cali.git`. Pushes to `main` create production deployments and pushes to other branches create previews. Check recent deployments with `npx vercel ls cali`; `npx vercel --prod` remains available for an intentional manual production deployment.

Production intentionally remains Cali's live testing and iteration environment. The local ngrok workflow above is only an additional way to inspect progress between pushes and does not change that deployment workflow.

Before deployment, run `npm test`, `npm run lint`, and `npm run build`. The production build now fails when a required client or reviewer-generation variable is missing and scans `dist` to prevent server secrets from entering the browser bundle. Apply all migrations to the target Supabase project and configure `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_VAPID_PUBLIC_KEY`, `OPENROUTER_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in Vercel Production. The `send-reminders` Edge Function requires `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, and `CALI_CRON_SECRET`; cron-job.org calls it once per minute with `X-Cali-Cron-Secret`. Add the deployed origin to the Supabase Auth redirect URLs. Never expose `SUPABASE_DB_PASSWORD`, a service-role key, the VAPID private key, or the cron secret as Vite environment variables.

All repository migrations through `20261008093705_enhanced_academic_reviewers.sql` are already applied to the currently linked Cali Supabase project. A different Supabase project still needs the complete migration sequence.

## Progressive web app

Cali is installable from supported desktop and mobile browsers. Signed-in students can find installation guidance under Profile. On iPhone and iPad, open Cali in Safari and use Share → Add to Home Screen.

The current PWA remains online-only. Its root-scoped service worker displays Web Push reminders, opens their exact class/task/event destination when clicked, and provides a navigation-only connection-unavailable page. It cache-first stores only immutable, versioned OCR model/runtime files after they are requested; it does not cache the app, Supabase data, registration images, OCR results, or notification payloads. Navigations bypass HTTP caches, service-worker updates bypass the browser cache, and the app checks for a worker update when it starts so deployed versions are adopted without requiring a PWA reinstall.

Returning students keep their Supabase session. Public-page calls to action open the dashboard directly when a completed signed-in session is present instead of starting Google OAuth again.

Cali provides styled pages for unknown routes, authentication failures, denied access, and unexpected application errors. While an open page is offline, a status notice explains that loading and saving require internet access and briefly confirms when Cali reconnects. The service worker provides the same connection-unavailable explanation for failed page navigations after it has been installed.

Schedule deletion is subject-based: choosing Delete subject from a meeting card or an Unscheduled subject removes that subject and all of its weekly meetings through the database cascade. It does not leave a second copy in Unscheduled. Subjects intentionally imported without a real meeting time may remain unscheduled until they are scheduled or deleted.

## AI reviewer generation

Cali generates an editable study reviewer from either handwritten-note photos or one digital PDF. There is no pasted-text intake path. The guided intake has three steps: Add material, Check text, and Customize. Students correct the extracted text, then choose reviewer length with one optional style-instructions field. The selected length sets the coverage boundary while instructions refine presentation. Desktop intake is capped at 600 pixels wide; mobile dialogs keep 24-pixel side gutters and scroll longer content inside.

### Input limits

| Input | Enforced limit |
| --- | --- |
| Handwritten notes | 1–10 page images per generation |
| Image types | JPG, PNG, or WebP |
| Image size | Up to 12 MB per image |
| Image resolution | Up to 20 megapixels; reduced locally to a maximum 2,048-pixel edge for OCR |
| PDF | One digital, text-based PDF per generation |
| PDF size | Up to 20 MB |
| PDF pages | No fixed page count; the extracted-text limit still applies |
| Extracted source | Up to 100,000 characters, including whitespace and page labels |

There is no separate word limit. In typical English notes, 100,000 characters is approximately 15,000–20,000 words, depending on formatting and word length.

Notebook pages are scanned sequentially in the order shown in the selector. Students can add, remove, and reorder photos before extraction. Clear, straight, evenly lit, in-focus page images are required for useful handwritten OCR. Scanned/image-only, password-protected, damaged, and textless PDFs are rejected; use the handwritten-notes path for photographed pages.

Photo OCR and PDF text extraction run in the browser. Original images and PDF files are never uploaded. The student-reviewed text and generation preferences are sent to the authenticated endpoint. Source text is not stored in Supabase. Account-scoped browser recovery keeps text, preferences, and a pending request ID for up to 24 hours; sign-out, account deletion, and deliberate discard clear it.

### Generated reviewer and usage limits

- **Quick** targets 3–6 sections, up to 2 blocks per section, and up to 6 list items.
- **Balanced** targets 4–10 sections, up to 3 blocks per section, and up to 7 list items.
- **In depth** targets 6–14 sections, up to 3 blocks per section, and up to 8 list items.
- Section, block, list-item, paragraph (below 120 words), and total output-size limits are validated before accepting a draft. Short sources may produce fewer sections.
- Output may contain source-grounded summaries, definitions, comparisons, explanations, examples, memory aids, paragraphs, bullets, and numbered lists. It must match the source's dominant language and use only the submitted source material.
- Each verified RTU student may complete 10 reviewer generations per calendar month. Failed attempts do not count, saved or discarded successful generations do count, and only one request may process at a time.
- A generated result is a private, revision-checked draft. It expires after 24 hours unless the student explicitly saves it to `reviewers`; saving or discarding removes the temporary draft.

Source text and preferences pass a contextual academic-content check before generation; output is checked again before creating a draft. Flagged sources are blocked automatically and failed checks do not consume quota. Gratuitous profanity, explicit sexual entertainment, targeted harassment, hate, actionable abuse, nonacademic requests, and policy overrides are blocked. Neutral academic discussion of sensitive subjects remains allowed. Unavailable or malformed policy decisions stop generation; model moderation can still make mistakes.

The default free models are `nvidia/nemotron-3-super-120b-a12b:free`, then `apodex/apodex-1.1-mini:free`. Reasoning is disabled. The primary uses strict JSON schema; fallback uses JSON-object output and Cali validates the full schema and quality locally. Requests use bounded attempt deadlines within the endpoint's 110-second budget. Optional server-only `CALI_REVIEWER_MODELS` accepts two to four distinct `:free` model IDs; no OpenRouter Auto or paid model is used.

Server environments require `OPENROUTER_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. These names belong in the local `.env` and the corresponding Vercel environments; server secrets must never use a `VITE_` prefix. Before deployment, apply the latest Supabase migration and run `npm run verify:study-ai` to verify configured models with actual generated output and contextual academic-policy fixtures. A release should also exercise a real selectable-text PDF and pass `npm test`, `npm run lint`, and `npm run build`.
