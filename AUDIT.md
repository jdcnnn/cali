# Cali system audit

Historical audit findings are recorded below. See [reinforcement verification](docs/reinforcement-verification.md) for the fixes, applied backend versions, validation, and remaining acceptance checks.

Audited on 2026-10-14. Repository baseline: `6515b62a7883ac56f4e32dc71490ba6d70094d19` (2026-10-14 09:21 +0800). Connected Supabase project: `uhkggsebnmhqjjzxxlvi`. Scope: repository plus read-only live inspection; security and correctness first.

## Assessment

Ten actionable implementation/operational findings: **1 High, 9 Medium**. No Critical vulnerability was confirmed. The highest priority is restricting the destinations and duration of server-side Web Push requests. Shared reviewer validation and suspended-account enforcement also need correction.

These ratings describe application impact, not dependency advisory CVSS scores. “Confirmed” means source/live metadata or an isolated local reproduction establishes the defect; it does not mean exploitation was performed against production. No live mutating RPC, AI generation, reminder dispatch, account change, or migration was run. Application source was not changed.

| ID | Severity | Finding | Evidence |
| --- | --- | --- | --- |
| F01 | High | User-controlled push endpoints reach privileged server-side HTTPS dispatch without destination or duration restrictions | Live function/constraints, deployed worker, pinned upstream source |
| F02 | Medium | Malformed shared reviewers crash the reader and can disrupt moderation previews | Local renderer reproduction and live constraint evaluation |
| F03 | Medium | Suspended/ineligible users can still modify existing quiz attempts through privileged RPCs | Live RPC grants, definitions, and trigger inspection |
| F04 | Medium | Community pushes remain stuck after a worker crash or post-claim failure | Live claim function and worker control flow |
| F05 | Medium | Expired class reminders lose subsequent weekly occurrences | Live claim function and recurrence control flow |
| F06 | Medium | Failed planned-date update after task creation leads to duplicate tasks on retry | Isolated reproduction of actual save handler |
| F07 | Medium | Calendar refresh failure after a successful insert leads to duplicate events | Isolated reproduction of actual save handler |
| F08 | Medium | Task planning uses the time captured when the page mounted | Source inspection |
| F09 | Medium | Live migrations and reminder deployment are not reproducible from the committed baseline | Git status, live migration history, deployed source |
| F10 | Medium | Administrative overlays announce modality without containing keyboard focus | Source inspection; browser acceptance pending |

## Findings

### F01 — Unrestricted push dispatch destinations and duration

**Locations:** [push subscription RPC](supabase/migrations/20261002010000_push_reminders.sql#L59), [worker dispatch](supabase/functions/send-reminders/index.ts#L196), and deployed `send-reminders` version 7.

An eligible account can submit `p_endpoint`, `p_p256dh`, and `p_auth` through `cali_save_own_push_subscription`, or insert/update its own subscription directly. The live endpoint constraint and RPC validate length only; there is no approved-host, protocol, port, or private-address restriction. An attacker can supply valid encryption keys and an arbitrary HTTPS destination. When their reminder becomes due, the service-role worker passes that endpoint to `webpush.sendNotification`.

Both the local and deployed worker send sequentially and supply no request timeout or overall dispatch deadline. The pinned [web-push 3.6.7 implementation](https://raw.githubusercontent.com/web-push-libs/web-push/v3.6.7/src/web-push-lib.js) derives the HTTPS hostname/port/path from the supplied endpoint and only installs a timeout when explicitly configured. No subscription-count cap was found either.

**Impact:** confirmed server-side request forgery input path and attacker-controlled outbound requests; a slow destination can also delay delivery for unrelated users in the same claimed batch. Internal-network reachability, response exfiltration, and a deployed denial of service were not tested or established. The service-role key is not sent to the push destination.

**Correction:** enforce a maintained allowlist of supported push-service hosts with HTTPS/default-port rules at subscription storage and immediately before dispatch. Reject userinfo, private/IP destinations, and misleading hostname suffixes. Restrict direct writes so callers cannot bypass that validation. Validate key formats, cap active subscriptions per account, set short socket timeouts plus an overall deadline, and use bounded concurrency that isolates a slow recipient. Preserve compatibility with supported Chromium, Firefox, and Safari push endpoints.

**Regression:** accept supported provider fixtures; reject an arbitrary external host, loopback/private addresses, custom ports, and hostname suffix tricks through every write path. With mocked transport, make one send hang and verify the batch still terminates and other users are processed.

### F02 — Shared reviewer documents are trusted without structural validation

**Locations:** [database constraint](supabase/migrations/20261003000000_study_reviewers.sql#L15), [Community renderer](src/components/CommunityPage.tsx#L230), [moderation renderer](src/components/AdminModerationPanel.tsx#L92), and `cali_create_own_reviewer` / `cali_update_own_reviewer`.

The live constraint checks only that `content` is an object of at most 1 MB. The authoring RPCs do not validate the document tree. `{"type":"doc","content":[null]}` passes that constraint and the detail RPC's top-level array-length calculation. A user can submit it directly and share the reviewer.

An isolated React server-rendering check using the actual extracted Community functions produced:

```text
valid document: <div class="community-document"><p>Safe</p></div>
null child: Cannot read properties of null (reading 'content')
object children: node.content?.map is not a function
```

**Impact:** a visitor opening the malformed public reviewer reaches the application error boundary. Moderation uses equivalent unchecked traversal; malformed content can impede inspection too. This is a stored availability defect, not a demonstrated XSS. Whether the deployed frontend matches this renderer could not be verified.

**Correction:** validate the allowed document schema at database write boundaries, including arrays, non-null nodes, marks/attributes, URLs, nesting depth, and total node count. Add defensive renderer checks and a local error boundary so a bad document does not remove the workspace or moderation controls. Review existing stored documents before enforcing a stricter constraint.

**Regression:** null children, object-valued children, invalid marks, excessive nesting, unsupported nodes, and unsafe links must fail writes or render a bounded fallback. Moderators must retain the ability to hide/report a corrupt reviewer.

### F03 — Quiz RPCs bypass account eligibility enforcement

**Locations:** [save/complete/abandon RPCs](supabase/migrations/20261011180000_learning_focused_quizzes.sql#L83) and [quiz attempt trigger](supabase/migrations/20261005000000_flashcards_and_quizzes.sql#L132).

Live `cali_save_quiz_attempt`, `cali_complete_quiz_attempt`, and `cali_abandon_quiz_attempt` are `SECURITY DEFINER`, executable by `authenticated`, and check ownership without calling `cali_is_eligible_user`. The write trigger checks ownership but also omits eligibility. Their elevated execution bypasses the restrictive eligibility policy on `quiz_attempts`.

**Trigger/impact:** a student starts an attempt, is suspended or becomes ineligible after personal login is disabled, and uses their still-valid token to invoke an existing-attempt RPC directly. They can continue updating their own attempt and receive its returned row despite blocked workspace access. Cross-account access was not found. No suspended account was impersonated or modified during this audit.

**Correction:** require centralized eligibility in all three RPCs before selecting or changing an attempt. Keep account deletion and other intentionally permitted recovery operations separate from normal workspace writes.

**Regression:** active eligible owner succeeds; another owner, anonymous caller, suspended owner, and newly ineligible personal account fail without changing the attempt.

### F04 — Community push claims have no crash recovery

**Locations:** [effective claim definition](supabase/migrations/20261009060000_admin_dashboard_and_login_policy.sql#L351) and `send-reminders`.

The live `cali_claim_community_notifications` selects only `pending` rows and changes them to `processing`. It never reclaims old `push_claimed_at` values. After claiming, a subscription/delivery database error, worker termination, or an ignored terminal-update error can leave notifications in `processing`. Subsequent invocations will not pick them up. The worker's outer catch returns 500 without releasing the claims.

**Impact:** affected pushes are permanently skipped; the in-app notification remains. The live snapshot had **zero stale processing claims**, so this is a verified failure path rather than a current incident.

**Correction:** add a bounded lease/reclaim mechanism, retry limits, and claim identity checks on completion. Check all state-update errors. Preserve recorded per-subscription deliveries when retrying.

**Regression:** terminate after claim and fail a database read/update after claim; a later invocation must reclaim or terminally classify the notification without resending recorded deliveries.

### F05 — Class reminder recurrence stops when an occurrence expires

**Locations:** [claim function](supabase/migrations/20261002010000_push_reminders.sql#L221) and [next-occurrence call](supabase/functions/send-reminders/index.ts#L238).

The live claimer marks pending reminders older than 15 minutes `missed` and excludes them from the returned batch. The next weekly class occurrence is queued only at the end of the worker's normal per-reminder path. The expiration branch therefore never creates the successor. An exhausted claim that is reset to pending but already has three attempts also cannot be selected again.

**Trigger/impact:** cron or delivery is unavailable past the grace window, then resumes. That class can stop receiving weekly reminders until an edit rebuilds its queue. The live snapshot had **zero missed class reminders without a successor**; no current student outage is claimed.

**Correction:** advance recurring classes on every terminal outcome, including expiration and exhausted retries, using an idempotent transaction. Reconcile enabled meetings without a future reminder and define restoration behavior after suspension.

**Regression:** outage longer than 15 minutes, three interrupted claims, missed delivery, and account restoration must retain exactly one future occurrence. Tasks/events must remain non-recurring.

### F06 — Task creation can succeed while the editor still retries creation

**Location:** [task save handler](src/components/TasksPage.tsx#L350).

Creation commits through `cali_create_own_task`; a second request writes `planned_date`. `savedTask` and the editor's `taskId` are assigned only after that second request succeeds. If it fails, the recovery branch has no saved identity and a retry creates another task. The isolated actual-handler check confirmed two persisted tasks after two attempts, with `editor.taskId` still null.

Existing-task details and checklist replacement also commit separately, so a checklist failure can leave a partial edit.

**Correction:** save details, planned date, and checklist in one authenticated transaction with a stable client request ID. As an immediate containment, retain the returned task ID before any follow-up request and retry against that identity.

**Regression:** fail each request after creation, lose a response after commit, and retry. There must be one task and either a complete save or an accurate recoverable partial-save state.

### F07 — Calendar refresh failures are reported as save failures

**Location:** [event save handler](src/components/CalendarPage.tsx#L103).

The handler commits an insert, awaits `onSaved` (the parent's data reload), and closes only after reload succeeds. A reload failure enters the save-error catch, leaving the new-event form open. Retrying inserts again. An isolated actual-handler check confirmed two persisted events after a simulated refresh failure and retry. The delete path similarly treats a post-delete refresh failure as a deletion failure.

**Correction:** distinguish mutation success from reload success. Retain the saved ID/row, close or change the editor to edit mode after commit, and show refresh recovery separately. Use a stable creation identity for lost-response retries.

**Regression:** successful insert followed by failed reload must show a saved state and never insert twice. Successful deletion followed by failed reload must not present the event as still deletable.

### F08 — Tasks keep a frozen planning clock

**Location:** [captured time](src/components/TasksPage.tsx#L246) and memoized planner groups at lines 323–324.

`const [now] = useState(() => new Date())` never updates. Passing a due time or midnight while leaving Tasks open does not update overdue, Today, or Upcoming calculations. Later data edits still use the original time. “Plan today” separately uses the real current date, creating inconsistent behavior after midnight.

**Correction:** update a shared clock at least once per minute and on tab visibility/focus restoration, with cleanup on unmount. Recompute the planning date from that clock.

**Regression:** fake time across a precise deadline and midnight without remounting; return from a sleeping/background tab and verify all groups and “Plan today” agree.

### F09 — Committed state does not reproduce the deployed backend

**Evidence:** live migration history contains all **53** local migration versions through `20261014020000`. The last three Plaza files are untracked at the audited Git baseline. The rollback script says it is optional and outside the forward directory, but it is actually inside that directory and has been applied. The live database contains `plaza_v1_archive`, not active public Plaza tables.

The deployed reminder worker is **version 7**, with 249 lines. Local source has 294 lines and includes batched subscription/delivery reads and an explicit suspended-user check that are absent from version 7. The documentation describes those local improvements as implemented.

**Impact:** a fresh checkout cannot reproduce the applied migration history; operational expectations about the worker differ from its actual behavior. Ordinary suspension already disables subscriptions in the database, so this drift alone does not prove delivery to suspended users.

**Correction:** preserve and commit the exact already-applied migration files in version order, clarify that rollback is historical, and update release documentation. Do not remove/retimestamp/reapply an applied migration. Deploy the reviewed worker through the normal release process and record its source hash/version. Verify the frontend deployment revision separately.

**Regression:** rebuild an isolated database from the committed history and compare schema/grants/functions to the linked project. Compare deployed Edge Function source hashes at release.

### F10 — Admin overlays lack modal focus containment

**Locations:** [action confirmation](src/components/AdminDashboard.tsx#L300), [profile preview](src/components/AdminDashboard.tsx#L855), and [moderation preview](src/components/AdminModerationPanel.tsx#L126).

These use ordinary div/section overlays with `aria-modal="true"`. The action dialog sets initial focus and handles Escape, but there is no Tab/Shift-Tab trap or inert background for these overlays; previews also omit equivalent initial-focus handling. Native modal dialogs elsewhere in the app already provide a stronger implementation pattern.

**Impact:** keyboard users can leave the advertised modal and reach background controls; assistive technology receives inconsistent modality. This implementation omission is confirmed, while the full browser/screen-reader behavior remains untested. The [W3C modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) requires contained tab order and an inert background.

**Correction:** use native `dialog.showModal()` or one tested shared modal primitive, including initial focus, focus restoration, Escape behavior, and busy-state handling.

**Regression:** repeatedly Tab/Shift-Tab through each overlay; focus must remain contained, background actions must be unavailable, and closing must restore focus to the trigger. Check stacked confirmations and a short mobile viewport.

## Improvement opportunities and conditional risks

These are distinct from the ten findings; no production exploit is claimed for them.

| Priority | Opportunity | Recommendation |
| --- | --- | --- |
| High | Authorization coverage | Add isolated database role tests for anonymous, owner, another student, suspended student, and admin. Existing JS tests do not establish live RLS/RPC authorization behavior. Cover sharing revocation, restricted previews, privileged RPCs, and account deletion. |
| Medium | Failure/retry coverage | Add worker tests for claims, cancellation, timeouts, exhausted retries, partial batch failure, and push/database ambiguity. A push accepted before delivery-record failure can still be resent; define the at-least-once behavior explicitly. |
| Medium | Query growth | Live advisors report 26 uncovered foreign keys, including 24 in public tables and 2 in archived Plaza tables. Prioritize account deletion and subscription/grant/notification cleanup paths; measure before indexing everything. Review [Supabase's foreign-key guidance](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys). Seven unused-index alerts are not sufficient reason to remove indexes after a short observation window. |
| Medium | Client data loading | Tasks, Calendar, and reviewer libraries load entire result sets. Add server pagination/date ranges before the configured API row cap causes silent omissions; avoid fetching every full reviewer body for library cards. Validate the hosted API cap rather than assuming local `max_rows = 1000` matches it. |
| Medium | Push readiness | `getPushStatus` and sign-out cleanup await `navigator.serviceWorker.ready` indefinitely. If registration fails, push-capable browsers can leave those operations pending. Use a bounded readiness check and make sign-out independent of optional push cleanup. |
| Medium | Live account-status refresh | AuthProvider ignores token refreshes and repeated sign-in events for an already-validated user. Recheck eligibility on suitable lifecycle events so an open workspace promptly reflects suspension/login-policy changes. Database enforcement remains the authority. |
| Low | Dependency advisories | Lockfile Vite **8.3.0** is in the affected range of [GHSA-rq7h-c2jc-7f22](https://github.com/vitejs/vite/security/advisories/GHSA-rq7h-c2jc-7f22); the advisory's scenario requires a non-Windows dev host and matching imported paths. Current Windows exposure was not established. Update to at least **8.3.3** and avoid publicly exposing development servers. |
| Low | Unused DOMPurify dependency | Locked DOMPurify **3.4.16** falls within [GHSA-cg2g-xh64-v4q7](https://github.com/cure53/DOMPurify/security/advisories/GHSA-cg2g-xh64-v4q7) and [GHSA-mrv2-3pqr-j5jr](https://github.com/cure53/DOMPurify/security/advisories/GHSA-mrv2-3pqr-j5jr). Advisory metadata identifies **3.4.17** as patched. No application import or required vulnerable configuration was found. Remove the unused dependency, or update it if retained; do not label these as active Cali XSS findings. |
| Low | CSP restrictions | Repository `vercel.json` permits JavaScript `unsafe-eval` and arbitrary HTTPS/WebSocket connections. Validate whether OCR needs JavaScript evaluation beyond `wasm-unsafe-eval`, then tighten directives with a report-only trial covering OCR, OAuth, Supabase, and fonts. The emitted production headers were not accessible in this audit. |
| Low | Secret scanning completeness | The bundle gate checks only current service-role, OpenRouter, and database-password values. Add VAPID private/cron secrets and prevent server-secret names under `VITE_`. Current tracked files and built output contained none of the locally configured secret values checked. This was not a full Git-history secret scan. |
| Low | Archive retention and documentation | Plaza rollback removes the cleanup function/job while preserving archived chat. Define an intentional archive retention policy; user-linked rows still have account-deletion cascades. Update README/HANDOFF release results and migration status instead of relying on historical statements. |

## Validation results

The shell tool failed to initialize. Equivalent checks were successfully run through direct Node child processes, without changing application source.

| Check | Result |
| --- | --- |
| Vitest | **113 passed across 17 files**; provider warnings were expected mocked failure-path output |
| Oxlint | **0 warnings, 0 errors** across 94 files |
| `tsc -b` | Passed, including browser/server project references |
| Deployment-variable gate | Passed; secret values were not printed |
| Vite production build | Passed; emitted size/externalized OpenCV Node-module warnings remain runtime/device follow-ups |
| Client bundle secret/performance gate | Passed; initial JS **165.1 KiB gzip**, CSS **25.7 KiB gzip** |
| Current-secret scan of Git-tracked files | No configured service-role/OpenRouter/database-password value matches; `.env` is untracked/ignored |
| Isolated malformed reviewer rendering | Valid control rendered; null/object children threw the errors recorded in F02 |
| Isolated task save failure | Failed follow-up update left no editor task ID; retry created a second mocked task |
| Isolated event save failure | Failed reload kept creation form open; retry created a second mocked event |
| Live metadata | 28 public tables all have RLS; inspected policies, policy composition, table/column grants, function definitions, triggers, and constraints |
| Live migration inventory | 53 versions match local filenames; three applied versions are untracked in Git |
| Deployed reminder function | Version 7 retrieved and compared with local source; differs as recorded in F09 |
| Narrow live log sample | Aggregate source counts inspected for 07:00–07:15 UTC; inspection ended before the full window elapsed, so counts are a partial snapshot, not a usage trend |
| `npm audit --json` | **Unavailable:** registry advisory request failed; direct registry fetch returned network `EACCES`. Targeted primary-source advisory review is not a complete transitive-dependency audit |
| Deployed frontend/headers | **Unavailable:** web fetch and host HTTP request failed; browser inventory had no available surfaces. This does not establish that the site is down |

Supabase security advisors reported 17 tables with RLS and no policies, two mutable-search-path functions, five anonymous-executable definer functions, 63 authenticated-executable definer functions, and disabled leaked-password protection. These require interpretation:

- Server-owned/archived tables with RLS and no client policy intentionally deny client access. Both anonymous and authenticated roles lack archive-schema usage and table grants.
- Eligibility policies are **restrictive**, composed with owner policies; they are not an ownership-bypassing permissive OR.
- The reviewed admin RPCs check administrator status internally. Server generation/claim functions deny execute to anonymous/authenticated roles. Trigger-returning functions are not ordinary callable workspace RPCs.
- Client writes to `students` are limited to username, program, year level, and bio; administrative identity/status columns are not client-writable.
- The two mutable-search-path functions are invoker/legacy helpers, and anonymous/authenticated roles cannot create public-schema objects. Pin their search paths or remove obsolete helpers as hardening, without claiming a demonstrated privilege escalation. See [Supabase guidance](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable).
- Disabled leaked-password protection is less relevant to the application's Google-only eligibility path; verify hosted authentication configuration before changing it. See [Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Additional inspected safeguards include PKCE and restored-token validation, transaction-based schedule replacement/account deletion, generation fingerprint/idempotency checks and quota locking, private draft ownership, locked preview content, reviewer revision checks, bounded local OCR inputs, and versioned OCR-only service-worker caching. These positive checks are source/metadata findings, not an end-to-end release certification.

## Remediation order and outstanding verification

1. **Contain server-side abuse:** F01 destination validation/deadlines; F02 document validation/fallbacks; F03 eligibility guards. Add the associated negative tests in an isolated database/worker harness.
2. **Repair persistence/recovery:** F04–F07 queue leases, recurring advancement, atomic/idempotent task creation, and separation of calendar commits from refreshes.
3. **Finish release behavior:** F08 planning clock, F09 reproducible backend releases, and F10 admin focus management.
4. **Broaden acceptance:** complete authenticated desktop/mobile flows, browser role separation, sharing revocation, deletion, real OCR/PDF/PWA checks, notification delivery, and screen-reader/contrast/reduced-motion review using dedicated disposable test accounts/data.
5. **Verify external dependencies and deployment:** rerun a full npm advisory audit with network access; inspect deployed headers/frontend revision and hosted OAuth/provider configuration. The live AI provider check was deliberately not invoked under read-only scope.

No fixes were applied. Existing untracked Plaza migrations were left untouched. Build/cache artifacts and isolated temporary reproduction modules were generated for validation; `AUDIT.md` is the audit deliverable.
