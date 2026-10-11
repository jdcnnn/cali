# CALI — Project Context and Architecture Plan

**Document status:** Living product and implementation record
**Last updated:** 2026-09-26
**Purpose:** Record product decisions, implemented behavior, architecture, and the remaining development sequence.

## Decision status

- **Confirmed:** Stated by the project team in this planning discussion.
- **Proposed:** Recommended for planning, pending team approval.
- **Open:** A choice or requirement still to be settled.

This document incorporates the supplied `project.md` as background context. Where the planning discussion changes that context, the newer decision is recorded here. Package names and hosting choices are proposals until the technology stack is finalized.

## 1. Product overview

**CALI (Class Ally)** is a web-based academic workspace for Rizal Technological University (RTU) students. It brings together schedules, tasks, study tools, learning progress, and community reviewer sharing.

CALI is a student-owned workspace. It is outside the scope of an official learning management, enrollment, grading, attendance, payment, student information, or faculty management system. Direct integration with RTU's databases is not part of the current plan.

### MVP capabilities

1. Institutional sign-in, onboarding, and student profiles
2. Home dashboard with schedule previews, upcoming tasks, and quick actions
3. Schedule intake, management, and class reminders
4. Task management
5. Manual and AI-assisted study sets: reviewers, flashcards, and quizzes
6. Learning analytics based on study activity
7. Community reviewer sharing

The exact boundary and acceptance criteria for each capability will be defined one module at a time.

## 2. Confirmed student journey

1. The student signs in through the existing Supabase Auth and Google OAuth setup. CALI does not manage passwords.
2. Only a Google account with a verified email at `@rtu.edu.ph` is eligible. An example institutional address is `2024-200362@rtu.edu.ph`.
3. CALI obtains the student's email, full name, and avatar URL from Google through Supabase Auth when available. Email remains in Supabase Auth. Full name and avatar URL are stored in `students` for display but are read-only to student clients; the trusted database onboarding and refresh functions populate them from the Google identity.
4. On first sign-in, the student completes onboarding by choosing a unique username, program, and year level. Usernames are 3–30 lowercase letters, numbers, or underscores and are unique regardless of case. Year levels are 1–5.
5. Program selection supports both a list of known programs and an option to enter a program that is not listed. Both save as a single program text value; the RTU program list is not yet complete.
6. Students can later edit their username, program, and year level from Profile.
7. After onboarding, the student reaches the CALI home dashboard. Returning onboarded students go directly to the application.

**Current navigation order:** Dashboard → Schedules → Tasks → Calendar → Study → Community → Profile. Study contains Reviewers, Flashcards, and Quizzes.

### Decisions still needed for this journey

- How to handle missing Google profile name or avatar data.
- Whether CALI reserves specific usernames.
- The initial list of known RTU programs and how it will be maintained.

## 3. Dashboard direction

**Current dashboard:** Below the greeting card, a compact schedule panel highlights classes whose saved day and time include the current local time, then shows up to three upcoming weekly meetings in start-time order. The Tasks panel shows up to three incomplete tasks, prioritizing overdue work and then the nearest deadlines, and links directly to task creation. Quick actions link to Schedules, Profile, and Study.

## 4. Schedule direction

### Weekly schedule

**Confirmed weekly model:** Each student has one current repeating weekly schedule. CALI does not retain previous schedules or require schedule start/end dates. Students can add, edit, or delete individual subjects and meetings manually.

**Confirmed manual schedule interaction:** The Schedules page shows Monday through Sunday cards. Each day card has a plus control for adding a meeting on that fixed day; the form does not offer a day selector. The form title names the selected day. Fields appear in the order subject code and units, subject title, start and end times, room, then block/section. The styled time picker has scrollable Hour, Minute, and Period columns, and the form calculates a subtle duration below the time pickers. Saved meetings can be opened to view their details. Each saved meeting has a three-dot menu with edit and delete actions. Leaving an edited meeting with unsaved changes requires a styled discard confirmation. Deleting from any meeting card removes its subject and, through the database cascade, all meetings belonging to that subject; the confirmation states how many meetings will be removed. Deletion never leaves that subject in the Unscheduled section. Subjects imported with no real meeting time remain visible in Unscheduled subjects and can be selected when adding a meeting from a day card or deleted directly from the Unscheduled section with confirmation.

### Schedule scanning

**Implemented local import:** Students can scan a JPG, PNG, or WebP image of an RTU registration/assessment form. PaddleOCR.js, a background browser worker, and locally hosted PP-OCRv5 models run on the device in both the regular web app and installed PWA; the image is not uploaded or stored, and the flow has no paid OCR service, generative AI, scan quota, or subscription dependency. The scanner extracts only schedule data: subject code, title, units, block section, meetings, and rooms. Semester and term text are ignored.

The three-step flow covers image selection, editable review, and saving. It summarizes extracted subjects, meetings, and units; prominently explains that OCR may be inaccurate and every detail should be compared with the form; uses subtle yellow and red emphasis for details that need attention; blocks saving when required fields are missing or invalid; and links each missing-detail instruction directly to its field. Students can correct extracted values, add meetings, and remove subjects or meetings with confirmation. A subject marked `N/A` remains unscheduled instead of receiving a fictitious meeting. Saving opens a final replacement confirmation on desktop and mobile.

Scanning is cancellable from the close and Cancel controls. If recognition is active, a stop-scanning confirmation appears above the still-visible live scanner; keeping the scan resumes the progress view, while stopping discards the image and unfinished result. Runtime failures use nontechnical recovery messages, including a reload action when an old deployed JavaScript chunk is stale. Technical details are limited to the developer console.

The scanner accepts images up to 12 MB and 20 megapixels and reduces the longest image edge to 2048 pixels before recognition. Accuracy still depends on a readable, complete, reasonably straight form, so manual review is required and manual schedule management remains available.

**Implemented startup optimization (2026-10-02):** Opening the scanner preloads one deduplicated Cali-owned module worker while preserving file selection. Image preparation overlaps any remaining PaddleOCR initialization, and the initialized worker is reused across scans before a five-minute idle release. Cancellation or failure terminates it so retry starts from a healthy state. Vite resolves ONNX Runtime to the standard SIMD WASM-only entry; the existing PP-OCRv5 models, thresholds, 2048-pixel processing limit, and deterministic parser are unchanged. Stage timing is retained for diagnostics but is not exposed in the student interface.

**Canonical deployed assets (2026-10-03):** The scanner worker loads both PP-OCRv5 archives from `/ocr/v1/models/` and the standard threaded SIMD ONNX Runtime module and WASM binary from `/ocr/v1/runtime/`. Byte-identical copies of the two model archives under `/ocr/models/` were removed, and Vercel rewrites legacy model URLs to the canonical versioned files. The older `/ocr/runtime/` JSEP module and binary remain because they serve already-open legacy JavaScript and are not duplicates of the active WASM-only runtime. The service worker caches only requested `/ocr/v1/` assets. This reduces the production output by about 12.1 MiB without changing model contents, worker paths, preprocessing, recognition settings, parsing, or scanner behavior.

### Schedule fields

Each class meeting has:

| Field | Requirement |
| --- | --- |
| Subject code | Required |
| Subject title | Required |
| Units | Required |
| Day code | Required for a scheduled meeting |
| Start and end time | Required for a scheduled meeting |
| Room | Optional |
| Block section | Required |

RTU day codes are **M, T, W, H, F, S, U**, where **H means Thursday**. A subject meeting on multiple days should have one meeting record per day. A subject marked `N/A` should not create a fictitious timed meeting.

**Implemented initial tables (migrations `20260924003019_students_and_weekly_schedules.sql` and `20260924003933_add_google_profile_fields_to_students.sql`):** `students` has one row per Supabase Auth user and stores username, program, year level, read-only Google full name and avatar URL, and timestamps. Email remains in Supabase Auth. Full name and avatar are nullable if Google does not provide them; trusted database onboarding and refresh functions populate them from the Google identity. `schedule_subjects` belongs to a student and stores subject code, title, units, block section, and timestamps. `schedule_meetings` belongs to a subject and stores one RTU day code, start time, end time, optional room, and timestamps. There is no separate schedules table because the student has only one current weekly pattern. Deleting a subject deletes its meetings.

The database enforces lowercase 3–30-character unique usernames, nonblank program/code/title/block values, year levels 1–5, decimal units from 0 to 30, valid RTU day codes, and start time before end time. Eligible students can read their own rows, create a profile through the onboarding function, edit CALI-managed profile details, and create, edit, or delete their own subjects and meetings. Anonymous clients have no table access. Google full name and avatar, ownership IDs, and timestamps are not student-editable. Migration `20260924010000_auth_onboarding.sql` adds verified RTU Google identity checks to student-owned tables and a trusted profile sync. Migration `20260925010000_replace_own_schedule.sql` adds `replace_own_schedule`, which validates a complete reviewed import and replaces the signed-in student's subjects and meetings in one transaction.

### Class reminders

**Implemented and verified (2026-10-02):** Independent reminders are available on class meetings, tasks, and events. The deployed stack uses native Web Push, private Supabase persistence, the `send-reminders` Edge Function, and an enabled cron-job.org job running every minute in Asia/Manila. Real delivery has been verified on desktop and an installed Android PWA.

**Confirmed:** Class reminders belong to Schedules. They must appear as device notifications even when CALI's tab is closed, including on the lock screen when the device and operating system permit notifications. In-app alerts alone do not meet this requirement.

**Confirmed reminder timing:** Class, task, and event reminder controls use the preset choices **30 minutes**, **1 hour**, **3 hours**, and **5 hours**, followed by **Custom**. Custom timing provides separate hours and minutes inputs and must resolve to a non-zero lead time. The notification configuration UI and delivered notification must use Cali's visual style while remaining compatible with each operating system's native notification presentation.

**Confirmed free technology baseline:** The browser uses the native Push API, Notifications API, and existing root service worker; no notification SDK is added to the client. Supabase Postgres stores reminder settings, per-device push subscriptions, and idempotent delivery attempts behind RLS and focused RPCs. A TypeScript Supabase Edge Function running on the Deno-compatible Edge Runtime sends standards-based Web Push with the pinned `web-push@3.6.7` npm package and VAPID. One cron-job.org job calls the Edge Function once per minute to process a bounded batch. Secrets are split between a public VAPID key exposed to the Vite client and the private VAPID key plus cron authentication secret stored only in Supabase Edge Function secrets; cron-job.org sends the cron secret in a request header and receives only a minimal status response. Vercel continues to host only the React/Vite PWA and does not run reminder cron jobs or notification-sending functions.

Each student opts in separately on each device. The scheduler finds due class meetings, tasks, and events, the Edge Function sends the encrypted pushes, and the database records attempts with unique idempotency keys so late or repeated scheduler runs cannot duplicate a notification. The service worker displays the notification and handles notification clicks. The notification body and item-specific action deep-link to the exact schedule meeting, task, or calendar event. Edits rebuild pending queue work; deletion and task completion cancel it. No OneSignal, Firebase application SDK, SMS/email provider, paid queue, or Apple Developer account is required.

Saving a reminder on an unsubscribed device directly invokes the native browser notification permission flow. Declining permission or a Push registration failure does not discard the saved reminder. Profile provides per-device Enable/Disable controls plus organized setup, platform banner, and troubleshooting instructions for Android, Windows, and macOS. Notifications use high urgency, persistent interaction, a Cali icon, and an Android-compatible monochrome badge, while the browser and operating system remain responsible for background delivery and banner presentation.

**Agreed cross-platform direction:** CALI remains a responsive website and will also be installable as a Home Screen web app on iOS and Android. On iPhone and iPad, students who want closed-tab lock-screen reminders must add CALI to the Home Screen and grant notification permission. Core features remain accessible in the browser without installation. The app must explain the iOS Home Screen step clearly.

**Implemented PWA and Push foundation (updated 2026-10-02):** Cali is installable with a manifest, platform icons, Profile installation guidance, and a root-scoped service worker. The worker displays branded Push notifications and handles desktop/browser and installed-PWA notification clicks. The app remains online-only: the service worker provides a self-contained message when a navigation fails without internet and cache-first stores only requested immutable files under the versioned OCR model/runtime path. It does not cache application files, Supabase data, registration images, OCR results, or notification payloads. Navigation requests use `no-store`, registration bypasses the browser cache when checking the service-worker script, and the app requests an update at startup. Deployments therefore do not require reinstalling the PWA.

**Implemented connection and error states (2026-09-26):** Cali shows styled pages for unknown routes, authentication failures, access denial, and unexpected application errors. An open page reports loss of connectivity and briefly confirms when Cali is back online. These messages do not imply offline feature support; schedule, account, OCR, and other data operations still require a connection.

**Delivery limit:** A notification cannot be guaranteed if the student denies permission, the device is offline, or operating-system settings suppress alerts.

**Open:** Since schedules have no end date, define how students pause or stop repeating reminders when classes end.

## 5. Task direction

**Implemented student planner (updated 2026-10-02):** Tasks open to a focused Today view that separates overdue work, work due or planned today, and suggested next work when today is empty. Upcoming groups future deadlines, while Completed keeps finished work accessible for review and reopening. The Kanban Board and embedded task Calendar were removed so Tasks remains focused on list-based planning; date-based planning is available in the separate Calendar module. Mobile uses compact vertical planner rows.

The unified task form keeps title, subject, due date, optional due time, importance, steps, and notes in one clear flow without a separate planning section. The first unfinished step appears as read-only context in task previews. Students update step progress from the task overview through explicit Mark done and Undo actions; completing a first step starts the task, while final task completion remains separate and confirmed. Date-only work remains due through the end of the local calendar day. Subject and importance filters are available.

Selecting a task opens a structured overview without entering edit mode. Step updates use labeled Mark done and Undo controls inside that overview, while full-task completion uses a separate Mark done action and always asks for confirmation. Unfinished steps are called out before the task leaves the active lists. Completed work remains available in the Completed view and can be reopened.

Task creation, movement, and checklist changes use trusted database functions. `tasks` and `task_steps` rows are private to their owner through row-level security, and a linked subject must belong to that owner. Deleting a subject sets the link to null without deleting the task; deleting a task cascades to its steps. Moving into Done records `completed_at`; reopening clears it. The dashboard shows the next three actionable incomplete tasks and their next unfinished step when available.

Migration `20260927000000_create_tasks.sql` adds the base table and atomic create/move functions. Migration `20260928000000_student_task_planner.sql` adds student-planner fields, private ordered checklist steps, and trusted checklist operations. The application no longer reads or writes effort estimates; the legacy database column remains unused to avoid destructive data removal. Task reminders are implemented by the shared reminder system. Attachments, recurrence, search, custom columns, task types, grading, and automatic schedule-slot planning remain outside this focused module.

## 6. Study direction

**Implemented Study workspace (updated 2026-10-06):** Study provides private reviewer, flashcard, and quiz libraries. Reviewers support create, search, subject filtering, reading, duplication, editing, and confirmed deletion. A reviewer may be linked to one of the student's schedule subjects. Its Tiptap editor supports headings, inline formatting, text color and highlighting, lists and checklists, tables, columns, alignment, undo/redo, page colors, focus mode, and optional browser spellcheck.

Reviewer edits autosave after 1.2 seconds, Done saves before closing, a failed save exposes Save now, and leaving with unsaved work offers Save and leave. These controls use the same callback. Only one `cali_update_own_reviewer` request can be in flight: concurrent triggers receive the existing promise. Each successful response updates `revision.current`; edits made while that request is running stay dirty and are saved next. Stale revisions raise `P0001`, not the retryable Postgres transaction code `40001`, and the client does not retry a conflict automatically.

Flashcards are manually authored with Front and Back fields. Sets support sequential or shuffled study, persisted progress, resuming, and mastery after two consecutive successful recalls. Their overview presents actual card and mastery counts, while the completion view reports Remembered and Still learning counts instead of a percentage. Starting a new completed-session review preserves mastery; replacing unfinished session responses requires confirmation.

Quizzes support multiple-choice and true/false questions, a selected correct answer, and an optional explanation. Choice deletion, clearing the editor's correct-answer selection, and changing question type are immediate editor actions. A type change resets that question's choices and correct answer. Major actions—question deletion, discarding unsaved work, attempt restart, and quiz deletion—require confirmation. Save can retain incomplete questions as drafts, but the confirmation identifies every missing requirement and only complete questions enter an attempt.

Quiz attempts show feedback after each answered item, including Correct or Incorrect status, the correct answer, and the authored explanation when present. Skip item moves an unanswered question behind untouched questions and returns skipped items after the final untouched question; an attempt cannot finish until those items are answered. Question and choice shuffling operate on the saved attempt snapshot so resumes and historical reviews keep the same order. Completed attempts are immutable and appear as score counts and recent history. Restarting marks an unfinished attempt abandoned before creating another; deleting the quiz cascades to its attempts.

Study previews use equal compact dimensions for flashcards and quizzes, consistent subject/date placement, clamped content, and no redundant “From subject” label. Reviewer previews no longer use colored top bars. Flashcard and quiz detail/editor pages use responsive desktop and mobile structures with reduced card/button scale, clear content hierarchy, and reviewer-style three-dot Edit/Delete actions. Reference-reviewer panels include **Use other reviewers**, allowing the source reviewer to change without inventing or copying extra metadata.

Migration `20261003000000_study_reviewers.sql` adds private reviewer storage and revision-checked operations. `20261005000000_flashcards_and_quizzes.sql` adds compact private flashcard and quiz documents, resumable activity, immutable completed quiz attempts, owner RLS, and account-deletion coverage. The `20261006000000`–`20261006050000` migrations add atomic manual saves, content-only revisions, repaired two-recall mastery semantics, safe table-specific trigger branches, and owned reference-reviewer switching. Migration `20261007000000_reliable_ai_reviewers.sql` adds idempotent generation requests, successful-only monthly quotas, private revision-checked drafts, expiration, promotion, discard, and account-deletion coverage. Migration `20261008093705_enhanced_academic_reviewers.sql` adds request fingerprints, stale processing recovery, expected-revision promotion, and idempotent saved-reviewer recovery.

AI generation creates reviewer drafts from one to ten notebook-page photos or one digital, text-based PDF. There is no pasted-text intake path. Notebook OCR and PDF text extraction happen in the browser; reviewed text and optional presentation instructions are sent through the authenticated generation endpoint. The intake guides students through Add material, Check text, and Customize; customization focuses on reviewer length with one optional instructions field. Flashcards and quizzes remain manually authored from scratch or with an existing reviewer shown as a reference; they never make a separate AI request.

**Implemented reviewer-generation limits:** Note photos must be JPG, PNG, or WebP, no larger than 12 MB or 20 megapixels each. They are reduced locally to a maximum 2,048-pixel edge for OCR and scanned sequentially in the order selected by the student. A batch may contain at most ten pages. PDF input is limited to one digital PDF of at most 20 MB; it has no fixed page-count limit, but password-protected, damaged, textless, scanned, and image-only PDFs are rejected. The combined extracted source for either path may contain at most 100,000 characters. There is no separate word-count limit; the character limit is roughly 15,000–20,000 typical English words.

**Implemented reviewer output:** Quick targets 3–6 sections with essential points, Balanced targets 4–10 sections with brief explanations, and In depth targets 6–14 sections with more context. Paragraphs must remain below 120 words; section, block, list-item, and total-size limits are validated before accepting output. Short sources may produce fewer sections. Output can use paragraphs, bullets, and numbered lists for source-grounded summaries, definitions, comparisons, explanations, examples, and memory aids. It matches the dominant source language, treats source content as untrusted data rather than instructions, and uses only the submitted source. Optional style instructions refine presentation without exceeding the selected length limits. Contextual academic checks run on input and output; flagged sources are automatically blocked, and unavailable checks stop generation without consuming quota. Neutral academic discussion of sensitive subjects remains allowed.

**Implemented usage limits:** A verified RTU student can complete ten reviewer generations per calendar month, with only one active generation at a time. Failed attempts do not consume quota; successful drafts count even when later saved or discarded. A generated result remains a private revision-checked draft for up to 24 hours, can be resumed and edited, and enters the permanent `reviewers` table only after explicit Save reviewer confirmation.

**Confirmed study-set ownership:** CALI does not present or persist an independent study-material library. Reviewers, flashcard sets, and quizzes are independent private records. Extracted generation source text is kept in account-scoped browser recovery for up to 24 hours, cleared on sign-out, account deletion, or deliberate discard; it is never stored in the generation-request or draft tables. An existing reviewer is an explicit source for creating flashcards and quizzes. Original notebook photos and PDFs stay on the device.

**Confirmed editing and deletion:** Students can edit and delete their own reviewers, flashcard sets, and quizzes. Editing one changes only that set. Deleting one removes only that set's stored content and associated source data. Flashcard sets and quizzes generated from a reviewer remain independent; later edits or deletion of the reviewer do not change them.

**Confirmed file policy:** CALI does not upload notebook photos or PDFs. Browser-based OCR and PDF.js extract text on the student's device. Scanned/image-only PDFs require the notebook-photo path; OCR for PDFs and `.docx` import are outside the current scope.

Generative AI is used only to create reviewer drafts in Study. Schedule scanning uses local PaddleOCR text detection and deterministic RTU table parsing; it does not send forms to an OCR service or use an LLM. Schedules, task management, reminders, analytics calculations, authentication, and database operations do not use generative AI.

## 7. Technology stack

### Confirmed choices

| Layer | Choice | Status |
| --- | --- | --- |
| Frontend framework | React | Confirmed |
| Frontend language and build | TypeScript and Vite | Confirmed |
| Frontend styling | Tailwind CSS | Confirmed |
| Routing | React Router | Confirmed |
| Authentication | Supabase Auth with Google OAuth | Confirmed; provider setup already exists |
| Institutional eligibility | Verified `@rtu.edu.ph` email | Confirmed |
| Backend | Native Node.js with TypeScript; no backend framework | Confirmed |
| Project layout | One project root with one `package.json` and one `package-lock.json` | Confirmed; React and Node API share the project |
| Database | Supabase PostgreSQL | Confirmed |
| Schedule scanning | Browser-only PaddleOCR.js with locally hosted PP-OCRv5 models and deterministic RTU parsing | Implemented |
| Manual reviewers | Private Supabase rows, revision-checked RPCs, and a Tiptap rich-text editor | Implemented |
| File storage | No server storage for notebook photos or PDFs | Implemented; originals stay on-device |
| Study-set source content | Independent private reviewer, flashcard-set, and quiz records | Implemented; no material library or persisted generation source |
| Study document text extraction | PDF.js (`pdfjs-dist`) for digital PDFs and PaddleOCR.js for notebook photos | Implemented and deployed |
| AI provider | OpenRouter with two explicitly configured free models | Implemented and live-catalog verified |
| Cross-platform delivery | Responsive website that is also installable as a Home Screen web app | Confirmed direction for iOS and Android |
| Class, task, and event reminders | Closed-tab, lock-screen notifications | Implemented; iOS needs Home Screen installation and permission |
| Notification delivery | Web Push, service worker, and backend sender | Implemented and device-verified |
| Reminder trigger | cron-job.org | Implemented; enabled once per minute in Asia/Manila |
| Hosting | Vercel for the frontend and native Node.js API functions | Implemented; authenticated production generation still requires a release smoke test |
| Validation library | No Zod for the MVP | Confirmed |

### Supporting tools

| Layer | Choice | Status |
| --- | --- | --- |
| Unit test tooling | Vitest | Implemented for focused logic tests; broader component and end-to-end coverage remains open |
| Component test tooling | React Testing Library | Candidate; not currently installed |
| Web Push sender package | `web-push@3.6.7` | Implemented in the Supabase Edge Function |

### Single-project folder structure

```text
cali/
├── api/                 # Vercel Node.js function entry points
├── server/              # Server-only business logic and integrations
├── src/                 # React application
├── public/              # Web app manifest, icons, service worker assets
├── supabase/
│   └── migrations/      # Database schema changes
├── .env                  # Local environment; ignored by Git
├── .gitignore
├── cali.md               # Living project documentation
├── README.md
├── index.html
├── package.json          # One npm project
├── package-lock.json
├── tsconfig.json
└── vite.config.ts
```

`api/` and `server/` are folders inside the same npm project, not separate backend projects. Server-only secrets and service-role operations stay out of `src/`, which is bundled for the browser. Additional TypeScript configuration files may be added if the Vite template or API build needs them.

### Package inventory

Implemented packages are recorded in the root `package.json` and `package-lock.json`. Packages for planned modules remain candidates until that module begins.

| Package group | Candidate packages |
| --- | --- |
| Browser runtime | `react`, `react-dom`, `react-router`, `@supabase/supabase-js` |
| Build and styles | `typescript`, `vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite`, `@types/react`, `@types/react-dom` |
| Browser schedule OCR | `@paddleocr/paddleocr-js` with locally hosted PP-OCRv5 models |
| Manual reviewer editor | Tiptap extensions and `dompurify` |
| Study document intake | `pdfjs-dist` for local digital-PDF extraction and `@paddleocr/paddleocr-js` for local notebook-photo OCR; `.docx` intake is not implemented |
| Browser reminders | Native Push API, Notifications API, and the existing service worker |
| Reminder persistence | Supabase Postgres, RLS, constraints, and focused RPCs |
| Reminder sender | Supabase Edge Function (TypeScript/Deno) with pinned `web-push@3.6.7` |
| Reminder scheduler | cron-job.org authenticated request, once per minute |
| Server runtime | Node.js built-in `fetch` and `@supabase/supabase-js` |
| Server development | TypeScript and `@types/node` |
| Tests | `vitest`; focused tests cover task, OCR, note ordering, PDF extraction, reviewer, study-set, and server-generation behavior |

The backend can call OpenRouter with Node's built-in `fetch`; an OpenRouter SDK is not required for the current plan. Reminder delivery uses `web-push@3.6.7` only inside its Supabase Edge Function, not in the browser bundle. Charting and end-to-end test dependencies will be chosen when their respective requirements are defined. Fredoka and Inter are font assets rather than required npm packages.

**Validation approach:** Since Zod is excluded, each endpoint and processing step needs explicit, focused checks. Database constraints provide an additional line of validation. AI output must be treated as untrusted, even if a provider returns structured JSON.

### Deployment considerations

- Vercel Node functions are the confirmed backend deployment shape, not a continuously running server.
- Notebook photos and PDFs stay in the browser and are never sent through the function request body or Supabase Storage. The endpoint receives at most 100,000 characters of reviewed extracted text.
- A deployment release must exercise both a real selectable-text PDF and clear notebook photos, then generate, edit, save, and discard with an authenticated eligible account. OCR for scanned PDFs and `.docx` intake remain outside scope.
- cron-job.org is the confirmed reminder trigger. It calls the reminder Edge Function once per minute with a dedicated authentication header and receives only a minimal status response; student records, reminder details, and push subscriptions are never returned to it. Processing must be bounded, idempotent, and able to handle late or repeated runs. One invocation processes the complete due batch rather than scheduling one invocation per student or reminder. cron-job.org is free and supports execution up to once per minute. Source: [cron-job.org FAQ](https://cron-job.org/en/faq/).

## 8. Data and authorization principles

- Supabase Auth provides the stable user identity. Student-owned data should relate to that identity through stable IDs, not through email or username.
- Institutional email and public username are separate attributes. Both must be unique under their chosen normalization rules.
- Students can access and change their own private profiles, schedules, tasks, and study data. Reviewer-generation source files are not uploaded; generated drafts are temporary private rows protected by owner-only access. Community content needs separate visibility and moderation rules.
- The backend must verify the authenticated user and ownership before privileged operations. Database row-level security and Storage policies should enforce the same boundaries.
- The Supabase service role key and OpenRouter API key are server-side secrets. Neither belongs in frontend code or committed files.
- Browser-selected study files require type, size, resolution, and extraction-result checks. Originals stay on-device and are released after local processing; Supabase stores only the generated draft output, never the extracted source text.
- Account deletion is an atomic privacy boundary. Migration `20261002020000_harden_account_deletion.sql` established explicit deletion of the current user's reminder deliveries/queue, Push subscriptions, task steps/tasks, calendar events, schedule meetings/subjects, profile, and Supabase Auth account. Migration `20261003000000_study_reviewers.sql` adds reviewers and reserved reviewer AI request/draft records; `20261005000000_flashcards_and_quizzes.sql` adds quiz attempts, quizzes, and flashcard sets. Foreign-key cascades remain as defense in depth. The client then removes the local Push subscription, Auth session, and theme preference. Future user-owned tables and Storage buckets must be added to this deletion contract before release.

### Initial data domains, not a complete schema

Student profiles, schedule meetings and their class reminders, push subscriptions, tasks, reviewers, Community shares and access grants, reports and notifications, flashcard sets, quizzes, flashcard progress, and quiz attempts are implemented domains. Original uploaded files and standalone study-material records are not persistent domains.

## 9. Design direction

The confirmed font pairing uses **Fredoka** for CALI branding and major headings, and **DM Sans** for navigation, forms, buttons, and body text. Proposed brand colors are primary blue `#1E90FF`, action blue `#0758B8`, deep ink `#172B42`, slate `#526579`, pale blue `#EAF4FF`, canvas `#F6FAFE`, border `#D7E5F3`, and white `#FFFFFF`.

The design prioritizes readable academic information and quick access to work. Study uses compact equal-size previews, restrained borders, deliberate whitespace, responsive one- and two-column layouts, and count-based progress summaries rather than decorative or unsupported analytics. Major actions across the application share Cali-branded confirmation/default, warning, loading, success, error, and blue information states. Their inline SVG icons inherit the intended state color, copy stays scoped to the action, and minor reversible editor actions do not create unnecessary confirmation friction. Final release-level component and accessibility review remains planned.

## 10. Development status and sequence

| Phase | Status | Scope |
| --- | --- | --- |
| 1. Product foundation | **Complete** | Single React and Vite project, routing, responsive workspace shell, themes, shared visual system, policy pages, documentation conventions, and Vercel SPA configuration. |
| 2. Identity and onboarding | **Complete** | Google OAuth, verified RTU account eligibility, session restoration, onboarding, profile editing, authorization policies, and transactional deletion of all current account data. |
| 3. Dashboard foundation | **Complete** | Personalized dashboard, current and upcoming class summaries, next actionable tasks, schedule-aware empty states, quick actions, and module panels. |
| 4. Schedule management and intake | **Complete** | Manual subjects and meetings, weekly and unscheduled views, confirmed deletion from both views, local web/PWA RTU form scanning, cancellable recognition, responsive editable validation, direct links to missing fields, and confirmed atomic schedule replacement. |
| 5. Class, task, and event reminders | **Complete** | Per-item presets/custom lead times, native browser permission, device subscriptions, Web Push delivery, enabled cron scheduling, retries/idempotency, service-worker display/deep links, banner instructions, and device-level enable/disable controls. |
| 6. Tasks | **Complete** | Focused responsive Today, Upcoming, and Completed planning, guided checklist steps, planned work dates, secure ownership policies, and dashboard integration. |
| 7. Calendar | **Complete** | Independent Cali-branded monthly calendar for class meetings, task deadlines, and Events, with a responsive selected-day detail panel, preview modals, selected-date creation, notification targeting, Event editing/deletion, a three-way create menu, and ten theme-aware named colors. Weekly browsing remains in Schedules. |
| 8. Study | **Complete** | Private reviewers, notebook-photo OCR, digital-PDF extraction, AI-assisted reviewer drafts, flashcards, quizzes, mastery, and attempt history are implemented. OCR for scanned PDFs, `.docx` import, and AI-generated flashcards/quizzes are outside this phase. |
| 9. Learning analytics | **Planned** | Progress measures derived from study activity and quiz attempts. |
| 10. Community and administration | **Implemented locally; deployment verification pending** | Reviewer publishing/discovery, attribution, voting/use signals, view/edit requests and grants, copies, realtime/paginated notifications, reviewer-only reports and moderation, responsive admin Overview/Users/Moderation/System areas, public-profile inspection, suspension controls, report signals, sign-in policy, and audit history. |
| 11. Release review | **Planned** | Key journey, authorization, data handling, accessibility, performance, and deployment verification. |

### Next implementation sequence

1. Apply and verify the Community/admin migrations from `20261009010000_cali_community.sql` through `20261010104500_access_status_support_identity.sql`, then deploy the matching frontend.
2. Perform authenticated desktop/mobile acceptance testing of reviewer publishing, access grants, notifications, report review, user inspection, suspension/restoration, audit pagination, and the support-ticket draft.
3. Add end-to-end authorization tests for student/admin routes and privileged RPCs. Report totals remain signals only; automatic suspension requires a separately approved threshold, appeal path, false-positive policy, and human-review safeguard.
4. Complete release accessibility, keyboard, focus, contrast, reduced-motion, performance, and device-matrix review.
5. Specify Learning analytics around actionable saved study activity and quiz outcomes, without decorative or unsupported analytics.

Each remaining phase should receive its own user flow, data contract, validation rules, failure states, and acceptance criteria before development begins. Completed phases remain subject to release-level accessibility, performance, and deployment verification.

## 11. Open architecture decisions

1. Finalize broader component and end-to-end test tooling.
2. Decide whether any code from the previously mentioned GitHub project should be brought into the new standalone project. The current planning workspace is separate from the requested project folder.

## 12. Documentation process

This file is the living project overview. As modules are planned, add detailed requirements and architecture documents that link back to the decisions here. Record each decision with its status, rationale, and date. Do not treat older attached context as an instruction to change code or architecture when it conflicts with the team's newer decisions.
