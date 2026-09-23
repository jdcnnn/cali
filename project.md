# CALI --- Project Context

## 1. Project Overview

**Project Name:** CALI (Class Ally)\
**Project Type:** Web-based student academic workspace\
**Target Users:** Rizal Technological University (RTU) students

CALI is a student-centered academic workspace that helps RTU students
organize class schedules, manage academic tasks, create study sets,
receive class reminders, and review learning progress.

CALI is **not** an LMS, CMS, SIS, enrollment system, grading system,
attendance system, or faculty management system.

------------------------------------------------------------------------

## 2. Core MVP Features

1.  Schedule parsing and organization
2.  Class reminders
3.  Task management
4.  Study-set creation
    -   Manual creation
    -   LLM-assisted creation
5.  Learning analytics
6.  User profiles
7.  Community reviewer sharing

Do not introduce major features outside this scope unless explicitly
requested.

------------------------------------------------------------------------

## 3. AI / LLM Scope

LLM functionality is limited to **study workflows**.

The LLM generates: - Reviewers - Flashcards - Interactive quizzes

Generation must be based on **student-provided learning materials**.

Supported study materials include: - PDF documents - Microsoft Word
documents (`.docx`) - Student-provided notes/text

Manual study-set creation must remain available without AI.

Do **not** use the LLM for general academic planning, schedules, task
management, notifications, learning analytics calculations,
authentication, or database operations.

------------------------------------------------------------------------

## 4. Technology Stack

### Frontend

-   React
-   Vite
-   TypeScript
-   Tailwind CSS

### Backend

-   Native Node.js
-   TypeScript
-   **Do not use Express, Fastify, NestJS, or another backend framework
    unless explicitly requested.**

### Database

-   Supabase / PostgreSQL

### Authentication

-   Supabase Auth
-   Google OAuth
-   Institutional Google sign-in; no application-managed passwords

### LLM

-   OpenRouter
-   Prefer free models because the project is designed around a
    no-credit-card development stack.

### OCR

-   Tesseract.js

### Hosting

-   Vercel

The project should stay within free-tier services and dependencies where
possible.

------------------------------------------------------------------------

## 5. Repository Structure

``` text
cali/
├── frontend/
│   ├── package.json
│   ├── package-lock.json
│   ├── tsconfig.json
│   └── src/
├── backend/
│   ├── package.json
│   ├── package-lock.json
│   ├── tsconfig.json
│   └── src/
├── .gitignore
├── projectcontext.md
└── README.md
```

Frontend and backend have separate `package.json` files.

Always commit `package-lock.json`.

Never commit `node_modules`.

------------------------------------------------------------------------

## 6. Study Material Processing

Expected flow:

``` text
Student uploads learning material
        ↓
Frontend
        ↓
Backend
        ↓
Document text extraction
        ↓
Text preprocessing
        ↓
OpenRouter
        ↓
Structured study content
        ↓
Backend validation
        ↓
Supabase
        ↓
Study Set
```

`.docx` files require Word document text extraction.

`.pdf` files require PDF text extraction.

Plain notes/text can be processed directly.

Do not expose the OpenRouter API key to the frontend.

Uploaded files are untrusted input. Validate file type, MIME type where
available, file size, processing results, and extracted text.

------------------------------------------------------------------------

## 7. Schedule Parsing

CALI can parse an RTU registration form/schedule.

Pipeline:

``` text
Registration Form
        ↓
OCR (Tesseract.js)
        ↓
Raw extracted text
        ↓
Node.js preprocessing
        ↓
OpenRouter
        ↓
Structured schedule JSON
        ↓
Validation
        ↓
Student confirmation
        ↓
Supabase
```

Tesseract.js performs OCR; it is not a complete PDF parser. PDF
preprocessing or appropriate PDF handling may be required before OCR.

Never insert raw LLM output directly into the database.

------------------------------------------------------------------------

## 8. RTU Schedule Day Codes

Use these exact codes:

  Code   Day
  ------ -----------
  M      Monday
  T      Tuesday
  W      Wednesday
  H      Thursday
  F      Friday
  S      Saturday
  U      Sunday

Do not replace `H` with `Th`.

For a subject with multiple meeting days, use one schedule row per
meeting day.

Do not create fake schedule rows for subjects with `N/A` schedules.

------------------------------------------------------------------------

## 9. Frontend Design System

### Fonts

**Fredoka** is the display/brand font: - CALI - Class Ally - Major
display headings - Prominent page titles

**DM Sans** is the UI/body font: - Navigation - Buttons - Labels -
Forms - Descriptions - Body text

Tailwind aliases:

``` text
font-display → Fredoka
font-sans    → DM Sans
```

### Brand Colors

``` text
Primary Blue: #1E90FF
Action Blue:  #0758B8
Deep Ink:     #172B42
Slate:        #526579
Pale Blue:    #EAF4FF
Canvas:       #F6FAFE
Border:       #D7E5F3
White:        #FFFFFF
```

CALI uses a light interface.

Avoid excessive gradients, glassmorphism, unnecessary animation,
AI-generated-looking illustrations, and overly decorative UI.

------------------------------------------------------------------------

## 10. Database Principles

Supabase/PostgreSQL is the persistent data source.

Use UUID primary keys where appropriate.

Use stable IDs for relationships rather than email or username.

The institutional email must be unique.

Public username is separate from institutional email.

### Students

``` text
students
├── student_id UUID PK
├── email VARCHAR UNIQUE NOT NULL
├── full_name VARCHAR NOT NULL
├── username VARCHAR UNIQUE NOT NULL
├── avatar_url VARCHAR NULL
├── program VARCHAR NOT NULL
├── year_level SMALLINT NOT NULL
├── created_at TIMESTAMP DEFAULT now()
├── updated_at TIMESTAMP
├── last_login_at TIMESTAMP NULL
└── is_active BOOLEAN DEFAULT true
```

### Schedules

``` text
schedules
├── schedule_id UUID PK
├── student_id UUID FK NOT NULL
├── subject_code VARCHAR(20) NOT NULL
├── subject_title VARCHAR(150) NOT NULL
├── units DECIMAL(3,1) NOT NULL
├── block_section VARCHAR(30) NOT NULL
├── day_code CHAR(1) NOT NULL
├── start_time TIME NOT NULL
├── end_time TIME NOT NULL
├── room VARCHAR(50) NULL
├── created_at TIMESTAMP DEFAULT now()
└── updated_at TIMESTAMP DEFAULT now()
```

`day_code` must be one of `M`, `T`, `W`, `H`, `F`, `S`, `U`.

------------------------------------------------------------------------

## 11. Planned Database Domains

Potential domains include:

-   Students/profile
-   Schedules/classes
-   Tasks
-   Study sets
-   Reviewers
-   Flashcards
-   Quizzes
-   Questions/options
-   Learning materials
-   Study activity
-   Quiz attempts/results
-   AI generation records
-   Community reviewer sharing
-   Notifications/reminders

Do not create every possible table immediately. Design tables based on
actual requirements and implemented relationships.

------------------------------------------------------------------------

## 12. Security

Never: - Commit `.env` - Expose `OPENROUTER_API_KEY` - Expose
`SUPABASE_SERVICE_ROLE_KEY` - Trust raw LLM output - Insert unvalidated
generated JSON - Trust client-provided authorization - Allow access to
another student's private records

Always validate: - Authentication - Authorization - File types - File
sizes - Ownership - LLM output structure - Database input

Use DOMPurify when rendering untrusted HTML where applicable.

------------------------------------------------------------------------

## 13. Environment Variables

Use:

``` text
.env
.env.example
```

Expected backend variables:

``` text
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
OPENROUTER_API_KEY=
```

Never commit actual secret values.

------------------------------------------------------------------------

## 14. Architecture Boundary

Preferred flow:

``` text
React
  ↓
Frontend service
  ↓
Backend endpoint
  ↓
Business logic
  ↓
Supabase / OpenRouter / document processor
```

Do not call OpenRouter directly from React.

Keep business logic out of UI components where practical.

------------------------------------------------------------------------

## 15. Agile Development

CALI follows:

``` text
Plan
  ↓
Develop
  ↓
Test
  ↓
Review
  ↓
Release OR Refine
```

Testing happens throughout development, not only at the end.

------------------------------------------------------------------------

## 16. Git Workflow

`main` is the stable branch.

Use feature branches:

``` bash
git checkout -b feature/study-set-upload
```

Commit focused changes:

``` bash
git add .
git commit -m "feat: add study set upload"
git push -u origin feature/study-set-upload
```

Open a Pull Request targeting `main`.

Do not directly push feature work to `main` unless explicitly agreed by
the team.

Preferred commit prefixes:

``` text
feat:
fix:
refactor:
docs:
style:
test:
chore:
```

------------------------------------------------------------------------

## 17. Coding Rules for AI Assistants

Before modifying code: 1. Inspect the existing project structure. 2.
Read relevant files. 3. Follow existing conventions. 4. Reuse existing
components and utilities where appropriate. 5. Avoid replacing working
code unnecessarily.

When implementing: 1. Keep changes scoped. 2. Do not rewrite unrelated
files. 3. Do not introduce unnecessary dependencies. 4. Preserve
TypeScript typing. 5. Validate external input. 6. Handle errors. 7.
Respect authentication and authorization. 8. Keep secrets server-side.
9. Run relevant checks after changes.

Do not silently introduce: - Express - Fastify - NestJS - Prisma -
MongoDB - Firebase - another LLM provider - another frontend framework

unless explicitly requested.

If the user explicitly changes an architectural decision, follow the
current instruction and update this context when appropriate.

------------------------------------------------------------------------

## 18. Scope Boundaries

CALI does not currently include:

-   Enrollment
-   Tuition/payment management
-   Official grading
-   Official attendance
-   Faculty management
-   Student records management
-   Direct RTU database integration
-   Replacement of RTU's official LMS

Do not add these features unless the project scope is explicitly
changed.

------------------------------------------------------------------------

## 19. Current Status

The initial Vite + React + TypeScript setup has been completed and
pushed to GitHub.

Team members clone the repository and run:

``` bash
npm install
npm run dev
```

The frontend currently uses the CALI brand system with Fredoka for
display text and DM Sans for UI/body text.

Next development sequence:

1.  Finish Tailwind configuration
2.  Establish frontend structure
3.  Create reusable layout/navigation
4.  Configure Supabase client
5.  Initialize backend
6.  Configure backend TypeScript/Node.js
7.  Establish frontend/backend communication
8.  Configure authentication
9.  Implement database schema
10. Implement schedule management
11. Implement task management
12. Implement study-set workflow
13. Implement document processing
14. Integrate OpenRouter
15. Implement OCR schedule parsing
16. Implement learning analytics
17. Implement community sharing
18. Test and refine

Do not implement the entire system at once.

------------------------------------------------------------------------

## 20. Definition of Done

A feature is generally complete when:

-   The intended user flow works.
-   TypeScript checks pass.
-   Relevant lint checks pass.
-   Errors are handled.
-   Authentication/authorization is respected.
-   External input is validated.
-   No secrets are exposed.
-   Existing architecture is followed.
-   Existing functionality is not unnecessarily broken.
-   The change is ready for Pull Request review.

------------------------------------------------------------------------

## 21. Final Principle

Build CALI as a **real student academic workspace**, not an AI showcase.

AI should solve specific study-related problems where it provides value.

The core system integrates:

``` text
Academic Planning
       +
Task Management
       +
Study Tools
       +
Learning Analytics
       +
Student Community
```

with LLM assistance specifically applied to student-provided learning
materials.
