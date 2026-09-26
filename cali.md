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

**Navigation order:** Dashboard → Schedules → Tasks → Study → Community → Profile. Study contains Reviewers, Flashcards, and Quizzes.

### Decisions still needed for this journey

- How to handle missing Google profile name or avatar data.
- Whether CALI reserves specific usernames.
- The initial list of known RTU programs and how it will be maintained.

## 3. Dashboard direction

**Current dashboard:** Below the greeting card, a compact schedule panel highlights classes whose saved day and time include the current local time, then shows up to three upcoming weekly meetings in start-time order. A Tasks panel states that task tracking is not yet available. Quick actions link to Schedules, Profile, and Study. Live task content awaits the Tasks module.

## 4. Schedule direction

### Weekly schedule

**Confirmed weekly model:** Each student has one current repeating weekly schedule. CALI does not retain previous schedules or require schedule start/end dates. Students can add, edit, or delete individual subjects and meetings manually.

**Confirmed manual schedule interaction:** The Schedules page shows Monday through Sunday cards. Each day card has a plus control for adding a meeting on that fixed day; the form does not offer a day selector. The form title names the selected day. Fields appear in the order subject code and units, subject title, start and end times, room, then block/section. The styled time picker has scrollable Hour, Minute, and Period columns, and the form calculates a subtle duration below the time pickers. Saved meetings can be opened to view their details. Each saved meeting has a three-dot menu with edit and delete actions. Leaving an edited meeting with unsaved changes requires a styled discard confirmation. Deleting from any meeting card removes its subject and, through the database cascade, all meetings belonging to that subject; the confirmation states how many meetings will be removed. Deletion never leaves that subject in the Unscheduled section. Subjects imported with no real meeting time remain visible in Unscheduled subjects and can be selected when adding a meeting from a day card.

### Schedule scanning

**Implemented local import:** Students can scan a JPG, PNG, or WebP image of an RTU registration/assessment form. PaddleOCR.js and locally hosted PP-OCRv5 models run in the browser; the image is not uploaded or stored, and the flow has no paid OCR service, generative AI, scan quota, or subscription dependency. The scanner extracts only schedule data: subject code, title, units, block section, meetings, and rooms. Semester and term text are ignored.

The three-step flow covers image selection, editable review, and saving. It summarizes extracted subjects, meetings, and units; highlights details that should be checked; blocks saving when required fields are missing or invalid; and links each missing-detail instruction directly to its field. Students can correct extracted values, add meetings, and remove subjects or meetings with confirmation. A subject marked `N/A` remains unscheduled instead of receiving a fictitious meeting.

The scanner accepts images up to 12 MB and 20 megapixels and reduces the longest image edge to 2048 pixels before recognition. Accuracy still depends on a readable, complete, reasonably straight form, so manual review is required and manual schedule management remains available.

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

**Confirmed:** Class reminders belong to Schedules. They must appear as device notifications even when CALI's tab is closed, including on the lock screen when the device and operating system permit notifications. In-app alerts alone do not meet this requirement.

**Proposed architecture:** Each student opts in to Web Push on each device. CALI stores each push subscription securely. One cron-job.org job calls an authenticated backend endpoint each minute; the backend finds due class meetings, sends Web Push, and records delivery attempts to prevent duplicates. A service worker receives the push and displays the notification. The scheduler only triggers the endpoint and receives a short status response; student schedules and push subscriptions are never sent to cron-job.org. Reminder timing, destination when tapped, and handling of edited or canceled meetings still need definition.

**Agreed cross-platform direction:** CALI remains a responsive website and will also be installable as a Home Screen web app on iOS and Android. On iPhone and iPad, students who want closed-tab lock-screen reminders must add CALI to the Home Screen and grant notification permission. Core features remain accessible in the browser without installation. The app must explain the iOS Home Screen step clearly.

**Implemented PWA foundation (2026-09-26):** Cali is installable with a manifest, platform icons, Profile installation guidance, and a root-scoped service worker. The app remains online-only: the service worker provides only a self-contained message when a navigation fails without internet and does not cache application, Supabase, or OCR resources. Future class reminders will add push and notification-click handling to this worker.

**Implemented connection and error states (2026-09-26):** Cali shows styled pages for unknown routes, authentication failures, access denial, and unexpected application errors. An open page reports loss of connectivity and briefly confirms when Cali is back online. These messages do not imply offline feature support; schedule, account, OCR, and other data operations still require a connection.

**Delivery limit:** A notification cannot be guaranteed if the student denies permission, the device is offline, or operating-system settings suppress alerts.

**Open:** Since schedules have no end date, define how students pause or stop repeating reminders when classes end.

## 5. Study direction

Students can create study content manually or generate it from materials they supply. To generate a reviewer, flashcard set, or quiz, the student can provide a PDF, `.docx`, or notes/text directly in that creation flow. A student can also generate flashcards or a quiz from an existing reviewer. AI-generated structures and extracted text require validation before storage.

**Confirmed study-set ownership:** Source content belongs to the study set created from it. CALI does not present or persist an independent study-material library. Extracted text may be retained within the owning study set to support reuse; an existing reviewer is an explicit source for creating flashcards and quizzes. The original uploaded file is still discarded after processing.

**Confirmed editing and deletion:** Students can edit and delete their own reviewers, flashcard sets, and quizzes. Editing one changes only that set. Deleting one removes only that set's stored content and associated source data. Flashcard sets and quizzes generated from a reviewer remain independent; later edits or deletion of the reviewer do not change them.

**Confirmed file policy:** CALI discards every uploaded study file after processing. Study PDFs and `.docx` files may be placed in private Supabase Storage only as temporary processing inputs and must be deleted after extraction or on processing failure. A cleanup mechanism must remove abandoned temporary uploads.

Generative AI use is currently planned only for study workflows. Schedule scanning uses local PaddleOCR text detection and deterministic RTU table parsing; it does not send forms to an OCR service or use an LLM. No generative AI use is planned for schedules, task management, reminders, analytics calculations, authentication, or database operations.

## 6. Technology stack

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
| File storage | Private Supabase Storage for temporary study-file processing | Confirmed; all uploaded files are discarded after processing |
| Study-set source content | Private extracted text retained with its owning reviewer, flashcard set, or quiz | Confirmed; no independent material library |
| Study document text extraction | PDF.js (`pdfjs-dist`) for PDF and Mammoth (`mammoth`) for `.docx` | Confirmed; deployment compatibility to test |
| AI provider | OpenRouter | Confirmed; exact models to choose after evaluation |
| Cross-platform delivery | Responsive website that is also installable as a Home Screen web app | Confirmed direction for iOS and Android |
| Class reminders | Closed-tab, lock-screen notifications | Confirmed requirement; iOS needs Home Screen installation and permission |
| Notification delivery | Web Push, service worker, and backend sender | Confirmed architecture |
| Reminder trigger | cron-job.org | Confirmed for the scheduled backend trigger |
| Hosting | Vercel for the frontend and native Node.js API functions | Confirmed; processing limits to verify with representative files |
| Validation library | No Zod for the MVP | Confirmed |

### Supporting tools not yet finalized

| Layer | Candidate | Decision still needed |
| --- | --- | --- |
| Test tooling | Vitest and React Testing Library | Confirm when the test plan is defined |
| Web Push sender package | To select | Compare with the confirmed Web Push architecture |

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
| Server runtime | `@supabase/supabase-js`, `pdfjs-dist`, `mammoth` |
| Server development | `tsx`, `@types/node` |
| Tests, when relevant | `vitest`, `@testing-library/react`, `@testing-library/dom`, `jsdom` |

The backend can call OpenRouter with Node's built-in `fetch`; an OpenRouter SDK is not required for the current plan. A Web Push sending package will be selected before implementing class reminders. cron-job.org is an external scheduling service, not an npm dependency. Charting and end-to-end test dependencies will be chosen when their respective requirements are defined. Fredoka and Inter are font assets rather than required npm packages.

**Validation approach:** Since Zod is excluded, each endpoint and processing step needs explicit, focused checks. Database constraints provide an additional line of validation. AI output must be treated as untrusted, even if a provider returns structured JSON.

### Deployment considerations

- Vercel Node functions are the confirmed backend deployment shape, not a continuously running server.
- Large study-material uploads should avoid passing through a function request body. Private Supabase Storage with controlled access is the temporary transfer path; files are deleted after processing.
- Backend document processing needs a deployment trial with real PDF and `.docx` files.
- cron-job.org is the preferred external trigger for closed-tab class reminders. It supports up to one request per minute, custom request headers, and failure monitoring. Its documented request timeout is 30 seconds, and it does not guarantee exact punctuality. Backend processing must be authenticated, bounded, idempotent, and able to handle late or repeated triggers. The endpoint must not return student data in its response. Sources: [cron-job.org FAQ](https://cron-job.org/en/faq/) and [service terms](https://cron-job.org/en/tos/).

## 7. Data and authorization principles

- Supabase Auth provides the stable user identity. Student-owned data should relate to that identity through stable IDs, not through email or username.
- Institutional email and public username are separate attributes. Both must be unique under their chosen normalization rules.
- Students can access and change their own private profiles, schedules, tasks, and study data. Temporary uploads must be private to their owners. Community content needs separate visibility and moderation rules.
- The backend must verify the authenticated user and ownership before privileged operations. Database row-level security and Storage policies should enforce the same boundaries.
- The Supabase service role key and OpenRouter API key are server-side secrets. Neither belongs in frontend code or committed files.
- Study-material uploads require type, size, and processing-result checks. Every uploaded file must be deleted after processing or failure, with cleanup for abandoned temporary files.

### Initial data domains, not a complete schema

Student profile, schedule meetings and their class reminders, push subscriptions, tasks, reviewers, flashcard sets, quizzes, source content owned by those study sets, study activity, and community shares. Original uploaded files and standalone study-material records are not persistent domains. Tables and relationships will be designed when the corresponding module requirements are settled rather than created all at once.

## 8. Design direction

The confirmed font pairing uses **Fredoka** for CALI branding and major headings, and **DM Sans** for navigation, forms, buttons, and body text. Proposed brand colors are primary blue `#1E90FF`, action blue `#0758B8`, deep ink `#172B42`, slate `#526579`, pale blue `#EAF4FF`, canvas `#F6FAFE`, border `#D7E5F3`, and white `#FFFFFF`.

The design should prioritize readable academic information and quick access to work. Final component and page specifications remain to be planned.

## 9. Development status and sequence

| Phase | Status | Scope |
| --- | --- | --- |
| 1. Product foundation | **Complete** | Single React and Vite project, routing, responsive workspace shell, themes, shared visual system, policy pages, documentation conventions, and Vercel SPA configuration. |
| 2. Identity and onboarding | **Complete** | Google OAuth, verified RTU account eligibility, session restoration, onboarding, profile editing, authorization policies, and confirmed account deletion. |
| 3. Dashboard foundation | **Complete** | Personalized dashboard, current and upcoming class summaries, schedule-aware empty states, quick actions, and module availability panels. Live task data begins with the Tasks phase. |
| 4. Schedule management and intake | **Complete** | Manual subjects and meetings, weekly and unscheduled views, editing and deletion confirmations, local RTU form scanning, editable validation, direct links to missing fields, and atomic schedule replacement. |
| 5. Class reminders | **Planned** | Push subscriptions, Web Push delivery, reminder timing, idempotency, service worker behavior, and pause controls. |
| 6. Tasks | **Planned** | Task fields, due dates, status, and optional class links. |
| 7. Study | **Planned** | Manual creation followed by PDF, `.docx`, or text generation of reviewers, flashcards, and quizzes; flashcards and quizzes can also use an existing reviewer. |
| 8. Learning analytics | **Planned** | Progress measures derived from study activity and quiz attempts. |
| 9. Community | **Planned** | Publishing, discovery, attribution, visibility, and moderation for shared reviewers. |
| 10. Release review | **Planned** | Key journey, authorization, data handling, accessibility, performance, and deployment verification. |

Each remaining phase should receive its own user flow, data contract, validation rules, failure states, and acceptance criteria before development begins. Completed phases remain subject to release-level accessibility, performance, and deployment verification.

## 10. Open architecture decisions

1. Select an OpenRouter model or model-selection policy after testing study material examples.
2. Specify reminder lead times, late-delivery tolerance, backend batching, and the iOS Home Screen and notification-permission flow.
3. Select a Web Push sender package and finalize the test tooling.
4. Decide whether any code from the previously mentioned GitHub project should be brought into the new standalone project. The current planning workspace is separate from the requested project folder.

## 11. Documentation process

This file is the living project overview. As modules are planned, add detailed requirements and architecture documents that link back to the decisions here. Record each decision with its status, rationale, and date. Do not treat older attached context as an instruction to change code or architecture when it conflicts with the team's newer decisions.
