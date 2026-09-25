# Schedule parser plan

Status: proposed implementation plan, 2026-09-25. Product boundaries in `cali.md` remain confirmed; choices marked **Proposed** below should be validated with real RTU forms. Confirmed intake: desktop offers image upload; mobile offers camera capture and image upload.

## Goal and boundaries

A student photographs or uploads a registration-form image, reviews a proposed weekly schedule, corrects it, and explicitly replaces their current schedule. The image stays in the browser and is discarded when the flow ends. Only schedule-relevant OCR text goes to the API. No parser response writes to the database.

The stored shape is `schedule_subjects` with zero or more `schedule_meetings` per subject. A printed `N/A` meeting becomes an unscheduled subject. Each day of a multi-day class becomes a separate meeting using RTU codes `M T W H F S U` (`H` is Thursday).

## Student flow

1. **Choose source:** From Schedules, open Import registration form. On desktop, offer image upload (including a screenshot or scanned image). On mobile, offer separate Take photo and Upload image actions. Show the selected image and allow replacement. Start with one image per import; verify whether real forms require multiple images before release.
2. **Read locally:** Validate image type, byte size, and decoded dimensions. Crop to the subject table in the browser before OCR; offer an adjustable crop for photos where its bounds are unclear. Render a bounded-resolution copy with rotation controls. Run one Tesseract.js English worker, show progress, and release the worker on completion/cancel. Keep the original image and OCR result in memory only.
3. **Parse:** Send bounded OCR text with row/column positions from the cropped schedule table to an authenticated Node API endpoint. Do not send the image, student name, student number, or unrelated form sections. The server calls OpenRouter with a fixed schema and parsing instructions.
4. **Review:** Show editable subjects and their meetings, including unscheduled subjects. Flag missing/invalid fields, ambiguous day or time text, duplicate-looking rows, and possible conflicts. Let the student add/remove subjects or meetings and correct every field. The student can compare against the local image while reviewing.
5. **Confirm:** Show the number of subjects and meetings that will replace the current schedule. Require an explicit Replace schedule action, especially when a schedule already exists. Validate all required fields again and perform one database transaction. On failure, keep the current schedule and the draft visible for retry.

OCR failure, empty text, API timeout, malformed model output, and unavailable provider all lead to a manual review draft or a clear retry path. The import flow never silently saves a partial schedule.

## Draft contract

```ts
type ParsedSchedule = {
  subjects: Array<{
    clientId: string
    subjectCode: string | null
    title: string | null
    units: number | null
    blockSection: string | null
    meetings: Array<{
      clientId: string
      dayCode: 'M' | 'T' | 'W' | 'H' | 'F' | 'S' | 'U' | null
      startsAt: string | null // HH:mm, 24-hour local time
      endsAt: string | null
      room: string | null
    }>
  }>
  issues: Array<{ path: string; message: string; sourceText?: string }>
}
```

`clientId` is a temporary UI key, never a database ID. The model should return nullable fields instead of guessing. The API assigns IDs, normalizes whitespace and times, checks the response against an explicit allowlist, and generates issues. Model-supplied confidence scores are not a save criterion. Keep short source snippets for review in memory only; do not log full OCR text or model prompts.

**Proposed parsing rules:** Interpret headings and table columns before rows; group rows by subject code, title, units, and block. A continuation line with blank subject columns and a populated schedule belongs to the preceding subject. Split multi-day codes into meeting records and preserve distinct rooms/times. `N/A` in the **Schedule** column means no timed meeting; `N/A` in the **Classroom** column means an otherwise valid meeting has a null room. Treat unreadable day/time values as review issues. Never invent required fields or merge similar codes such as a lecture and its `L` laboratory.

## Findings from the first RTU sample

The supplied registration/assessment form has one schedule table with columns for Subject Code, Subject Description, Unit(s), Section Code, Schedule, and Classroom. Its table ends above the fee and assessment panels. The top of the document contains personal details, so browser cropping must happen before any OCR text is sent to the API. The image is used only to refine this plan and is not copied into the repository.

- The form has 11 subjects and 11 timed meetings: one subject has a second meeting on a continuation line, and another subject has `N/A` for its schedule and room.
- The continued meeting has `N/A` as its classroom while still having a valid day and time. This must produce a meeting with `room: null`.
- The watermark crosses several rows, making flattened OCR text likely to mix neighboring columns. Keep OCR geometry and reconstruct rows before the LLM call; show uncertain rows for correction.
- Several subject codes differ only by an `L` suffix. Matching or deduplication must use the full code and the row context.
- The printed total is 24 units. Treat that as an optional consistency warning when OCR captures it, never as a value to distribute across subjects.

## API and persistence

- `POST /api/schedule/parse`: Require a valid Supabase access token and eligible onboarded user. Accept only bounded JSON OCR input, enforce request and per-user rate limits, and call OpenRouter with a server-only key. Use structured JSON output on a compatible, pinned model, then validate the returned shape and field limits in application code. Return a draft and issues; never write schedule rows. Keep a short timeout and a controlled retry for transient provider errors.
- `replace_weekly_schedule` database RPC: Accept the final subject/meeting payload, derive the owner from `auth.uid()`, check eligibility and all field/array limits, then delete the caller's old subjects and insert the new subjects and meetings in one PostgreSQL transaction. Restrict `EXECUTE` to authenticated users and set a safe `search_path`. Reject an empty replacement unless the user explicitly chose to clear the schedule.
- **Proposed concurrency guard:** Record a per-student schedule revision that changes with manual and imported edits. Include the revision seen when review opened; the RPC rejects replacement if it changed, so a second tab cannot erase recent edits without a fresh review. Implement and test this alongside the RPC.

The parser endpoint must not accept `user_id` as authority. The save RPC must not trust model output or client validation. Existing table checks remain the final database constraints. Keep OpenRouter and any privileged database credentials outside `VITE_` variables.

## Validation and evaluation

- Match the existing database: nonblank code (1–40), title (1–200), block (1–80), units 0–30 with one decimal, day in `M T W H F S U`, end after start, and optional room (1–120, not `N/A`). Reject excessive subject/meeting counts and duplicate exact meetings; surface overlapping meetings for review rather than silently dropping them.
- Build a small, consented set of representative RTU forms with personal details removed. Include clear photos, skewed/low-light photos, continuation rows, Thursday `H`, different room formats, `N/A` in both Schedule and Classroom, and ambiguous OCR. Keep these fixtures out of the repository unless fully de-identified.
- Compare at least two pinned structured-output models on exact subject and meeting extraction, missed fields, invented fields, latency, and cost. Choose the model from this evaluation; keep a model override server-side.
- Test the end-to-end flow on desktop and representative lower-end Android and iOS devices. Verify OCR memory/time, rotation, cancellation, keyboard editing, provider failure, rejected save, and that the old schedule survives any failed replacement.

## Improving accuracy over time

Start with a labeled evaluation set: for each consented, de-identified form, record the correct subjects and meetings separately from the image and OCR result. Keep a held-out subset for measuring changes. Track missed subjects, wrong field values, invented meetings, and the number of student corrections, rather than relying on a single OCR confidence number.

Improve in this order: table crop and image quality; OCR settings and row/column reconstruction; deterministic RTU rules for continuation lines and `N/A`; prompt examples and structured output; model choice. Re-run the same evaluation set after each change. This adapts the *pipeline* to RTU forms without training a new model.

Fine-tuning is a later option only if the evaluation set shows a persistent recognition or parsing error after these changes and enough labeled examples exist. Tesseract model training would need line images and exact transcriptions; LLM fine-tuning would need OCR inputs paired with corrected structured schedules and a provider/model that supports it. Neither is justified by one sample. Student corrections stay private to that import unless the student separately opts in to contribute de-identified examples; the default retention policy remains no stored form image or OCR text.

## Implementation order

1. Shared draft types, normalization and validation, and review editor built from the existing schedule fields.
2. Browser image intake and Tesseract OCR with an inspectable OCR-text fallback.
3. Authenticated parse API and OpenRouter structured response validation.
4. Transactional replacement RPC and concurrency guard.
5. Real-form evaluation, mobile tuning, and release acceptance checks.

## Decisions needed before implementation

1. Obtain representative, de-identified RTU registration-form images and confirm whether one image covers a complete form.
2. Decide whether a student may intentionally replace a schedule with zero subjects. Default recommendation: allow only through a separate, explicit Clear schedule action.
3. Set initial image/OCR text limits after measuring representative forms and mobile devices.
