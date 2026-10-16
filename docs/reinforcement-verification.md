# Audit reinforcement verification

Implemented 2026-10-14 against baseline `6515b62a7883ac56f4e32dc71490ba6d70094d19`.

## Applied backend changes

The user approved the production migrations and matching reminder deployment. Supabase migration history now includes:

- `20261014073723_audit_security_and_atomic_tasks.sql`: eligibility guards for existing quiz attempts; structural reviewer validation on new/changed documents; supported push-host/key validation; device limits and restricted direct subscription writes; an atomic task/details/checklist save with stable task identity.
- `20261014074032_audit_reminder_recovery.sql`: expiring notification leases, retry exhaustion, claim tokens, recurring class reconciliation, and lease indexes.
- `20261014074037_audit_foreign_key_indexes.sql`: 24 covering indexes for active-table foreign keys. No existing indexes were removed.

`send-reminders` **version 8** is active. Its source matches the local worker and `pushSafety.ts`. It retains the existing cron-secret authentication and public invocation contract. Dispatch validates destinations again, rejects redirects, cancels timed-out HTTP requests, processes four queue records concurrently, bounds database calls and total invocation time, checks update errors, and matches claim tokens before completing records. The claim size is 10 per queue per invocation; excess work remains queued for subsequent cron runs.

Four observed automatic cron calls after deployment returned `204` with no due work. This confirms startup/empty-queue behavior, not delivery to a real browser. No notification or AI request was manually dispatched.

The live performance advisor now reports **zero uncovered foreign keys in active tables**. Two warnings remain in `plaza_v1_archive`; archived indexes were deliberately left unchanged. New indexes naturally appear in unused-index advisories before workload reaches them.

## Frontend and repository changes

- Tasks use a live clock refreshed every 30 seconds and when returning to the app. Saves call the new atomic RPC and reuse a stable UUID across retries.
- Calendar creation uses one stable UUID and owner-scoped upsert; refresh failure no longer reclassifies a committed save/delete as a mutation failure.
- Community, Study, reference notes, and moderation contain malformed reviewer documents and restrict rendered links.
- Administrative action/profile/enforcement/content overlays use native modal dialogs, including busy-state cancellation and focus restoration. Existing surfaces and confirmation wording remain.
- Push registration readiness is bounded; optional cleanup cannot indefinitely block sign-out.
- Deployment gates reject server-secret names under `VITE_` and scan VAPID/cron secrets as well as the original server secrets.
- The unused DOMPurify dependency and its unused types were removed. All remaining locked versions and cross-platform package metadata were preserved.
- Applied migration filenames match their actual Supabase versions. The already-applied Plaza migrations are preserved unchanged in the working tree; include them with this change when committing the release.

**The frontend changes are local and build-verified. They have not been pushed to Git or deployed to Vercel.** The existing deployed frontend remains compatible with the backend because its RPC signatures were preserved. All patches and migration files remain available for review; no commit was created.

## Historical verification

The results below record the earlier audit. On 2026-10-16 the automated test files, SQL regression fixture, and test runner were removed to simplify the repository. Use lint, build, and manual feature checks for current changes.

- **141 tests passed across 22 files**, including existing tests plus document safety, push transport/concurrency, clock rollover, modal lifecycle, and secret-boundary regression tests.
- Strict browser/server TypeScript and a separate strict worker check against the Supabase/Web Push runtime interfaces.
- Lint, production build, deployment environment validation, client-secret scanning, and performance budgets. Initial output: **165.2 KiB JavaScript gzip**, **25.7 KiB CSS gzip**.
- Read-only database validator fixtures accept normal documents/provider endpoints and reject null children, invalid marks, unsafe links, private hosts, userinfo, and misleading host suffixes.
- Transaction-only synthetic database fixtures verify atomic task creation, duplicate retry prevention, rollback of invalid edits/creates, malformed reviewer rejection, and suspension guards. Fixtures were rolled back; a follow-up check found **zero leftover fixture accounts**.
- Role/grant checks confirm the task RPC denies anonymous execution, queue claim RPCs deny authenticated execution, direct subscription insertion is revoked, and every public table retains RLS.

The former database regression script used a transaction ending in `ROLLBACK` and synthetic records; it was removed with the other test files.

## Remaining acceptance and deliberate deferrals

- Authenticated desktop/mobile journeys, real push delivery, OCR device behavior, and actual native-dialog Tab/Shift-Tab/screen-reader behavior still require browser acceptance. jsdom lifecycle tests simulate the native dialog methods; they do not prove browser focus containment.
- Automatic approval review blocked scanning private generated drafts for compatibility. Synthetic/generated document fixtures were used instead. The new trigger validates only new or changed content and leaves existing drafts untouched.
- A full online dependency audit and Vite patch update remain pending because registry network access is unavailable and the patched version is not cached. Offline npm's “0 vulnerabilities” message is not evidence of current online advisory coverage. The known Vite advisory concerns a non-Windows development-server scenario; keep the development server private until the tested patch update is available.
- Broad pagination, stricter CSP/JavaScript-eval changes, and automatic account-status refresh are deferred to separately validated changes. They can affect loading, OCR, or unsaved editor sessions; they were not required to repair the ten confirmed findings.
- No stored reviewer content, existing student profile, or archive data was rewritten or purged. Existing constraints, RLS ownership boundaries, AI quotas, OAuth, cron schedule, and Manila reminder times were preserved.
