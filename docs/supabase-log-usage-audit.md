# Supabase log usage audit

Audit date: 2026-10-10

This audit covers repository-visible sources of Supabase log ingestion and log-query usage. It does not claim that usage has decreased; that must be confirmed from the Supabase usage trend after deployment.

## Findings

### Application requests that create automatic Supabase logs

Supabase automatically records API gateway, Auth, Realtime, PostgREST, and Edge Function activity. Cali does not need to call `console.log` for those events to exist.

The Study module is the densest interactive request path found in the repository:

- Opening the reviewer library reads reviewers, subjects, and the latest generated draft.
- Reviewer Realtime events previously repeated all three reads even though only reviewers changed.
- Recovery of an already-processing AI request previously polled every 2.5 seconds for up to 135 seconds, allowing about 54 status requests.
- Generated drafts previously autosaved 1.2 seconds after each pause in editing.
- Reviewer generation performs required Auth, eligibility, profile, idempotency reservation, and completion or failure operations. These controls are retained because they protect access, quotas, and duplicate generation.

The `send-reminders` Supabase Edge Function is a separate continuous source. The documented once-per-minute cron schedule produces 1,440 invocations per day and two queue-claim RPCs per invocation even when there is no work. Supabase records invocation and gateway metadata automatically. When work exists, the worker also previously loaded subscriptions and delivery records once per queue item.

### Explicit application logging

- The Supabase Edge Function emits one compact structured error only when an invocation fails. It does not log notification bodies, subscriptions, credentials, or student records.
- Reviewer-provider warnings run in the Vercel function, not a Supabase Edge Function. They contain stage/model/error categories, not source material or credentials.
- Browser console errors do not contribute to Supabase log ingestion.
- No unbounded retry loop or verbose success logging was found.

### Log queries

No repository code calls the Supabase Logs API, Management API log endpoint, or performs a log search. Supabase Logs Query usage measures log data scanned by Studio, CLI, Management API, or other log readers; it is not the size of normal database query results. The reported 101 GB therefore cannot be attributed to a Cali application query from this repository.

### Configuration

No migration or checked-in configuration changes PostgreSQL `log_statement`, `log_min_duration_statement`, connection logging, or audit logging. Do not change those settings until the dominant log source and current values are verified in the hosted project.

## Implemented reductions

- AI recovery polling now backs off from 2.5 seconds to 5 seconds and then 10 seconds. The 135-second recovery window remains, while the maximum status checks fall from about 54 to about 19.
- Generated-draft autosave now waits 4 seconds after editing stops. Explicit close/save actions still persist immediately, and the unsaved-change navigation warning remains.
- Reviewer Realtime events now refresh only reviewers: one request instead of reloading reviewers, subjects, and generated drafts.
- The reminder worker now loads active subscriptions once for all claimed users and delivery records once per queue type. It no longer repeats those reads for every claimed item.
- The reminder worker's external 500 response is generic; the bounded structured server log retains the actionable failure category without returning internal database or provider messages.

## Manual dashboard checks

Use a short time range first. Re-running broad log searches is itself what consumes Logs Query allowance.

1. In the organization Usage page, select the Cali project rather than the all-projects view and confirm the billing period behind the 2.45 GB / 101 GB figures.
2. In Logs Explorer, inspect a representative 15- to 60-minute window and group or filter by `source`. Compare `edge_logs`, `function_edge_logs`, `function_logs`, `realtime_logs`, `auth_logs`, `postgres_logs`, and `postgrest_logs`.
3. If `edge_logs` dominates, filter by request path and status. Compare Study table/RPC routes with other high-frequency routes. Look specifically for repeated `reviewer_generation_requests`, `generated_reviewer_drafts`, `reviewers`, and reviewer RPC calls.
4. If `function_edge_logs` dominates, open **Functions > send-reminders > Invocations** and compare invocation count with the expected once-per-minute schedule. In **Logs**, check whether a repeated `reminder_dispatch_failed` error is multiplying volume.
5. If `realtime_logs` dominates, check connection and reconnection frequency. Normal reviewer subscriptions should be long-lived, not reconnecting continuously.
6. If `postgres_logs` dominates, run these read-only checks in the SQL editor:

   ```sql
   show log_statement;
   show log_min_duration_statement;
   show log_connections;
   show log_disconnections;
   ```

   If `log_statement` is `all` and Cali has no requirement for a full raw statement trail, the recommended value is `none`; use `mod` only if retaining data-changing statements is an explicit operational requirement. Do not disable error or security logs. Apply hosted custom Postgres configuration only after the source breakdown confirms PostgreSQL statements are material.
7. Check whether any teammate, automation, CLI process, or external monitoring tool repeatedly refreshes/query-polls Logs Explorer. Stop scheduled log polling; use narrow ad-hoc queries or a Log Drain for a continuous feed.
8. After deployment, compare daily ingestion and query trends for at least two comparable days. Do not infer success from the cumulative monthly meter or a single quiet interval.

## Optional operational change, not applied

If `send-reminders` invocations are a leading source and most runs return 204, changing the external cron from every minute to every two minutes would halve its invocation and empty-claim baseline. The tradeoff is up to roughly one additional minute of reminder latency. Keep the current schedule unless that tradeoff is accepted after reviewing the source breakdown.

