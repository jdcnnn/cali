-- Cover active foreign-key joins and account deletion. Preserve all existing indexes.
set local lock_timeout = '5s';
create index if not exists account_enforcement_cases_closed_by_audit_idx on public.account_enforcement_cases(closed_by);
create index if not exists account_enforcement_cases_suspended_by_audit_idx on public.account_enforcement_cases(suspended_by);
create index if not exists admin_audit_log_actor_id_audit_idx on public.admin_audit_log(actor_id);
create index if not exists cali_system_settings_updated_by_audit_idx on public.cali_system_settings(updated_by);
create index if not exists community_notification_deliveries_subscription_id_audit_idx on public.community_notification_deliveries(subscription_id);
create index if not exists community_notifications_actor_id_audit_idx on public.community_notifications(actor_id);
create index if not exists community_notifications_reviewer_id_audit_idx on public.community_notifications(reviewer_id);
create index if not exists community_reports_profile_user_id_audit_idx on public.community_reports(profile_user_id);
create index if not exists community_reports_resolved_by_audit_idx on public.community_reports(resolved_by);
create index if not exists community_reports_reviewer_id_audit_idx on public.community_reports(reviewer_id);
create index if not exists flashcard_sets_source_reviewer_id_audit_idx on public.flashcard_sets(source_reviewer_id);
create index if not exists quiz_attempts_user_id_audit_idx on public.quiz_attempts(user_id);
create index if not exists quizzes_source_reviewer_id_audit_idx on public.quizzes(source_reviewer_id);
create index if not exists reminder_deliveries_subscription_id_audit_idx on public.reminder_deliveries(subscription_id);
create index if not exists reminder_queue_user_id_audit_idx on public.reminder_queue(user_id);
create index if not exists reviewer_access_grants_grantee_id_audit_idx on public.reviewer_access_grants(grantee_id);
create index if not exists reviewer_access_grants_request_id_audit_idx on public.reviewer_access_grants(request_id);
create index if not exists reviewer_contributors_contributor_user_id_audit_idx on public.reviewer_contributors(contributor_user_id);
create index if not exists reviewer_generation_requests_saved_reviewer_id_audit_idx on public.reviewer_generation_requests(saved_reviewer_id);
create index if not exists reviewer_usage_daily_user_id_audit_idx on public.reviewer_usage_daily(user_id);
create index if not exists reviewer_votes_user_id_audit_idx on public.reviewer_votes(user_id);
create index if not exists reviewers_original_author_id_audit_idx on public.reviewers(original_author_id);
create index if not exists reviewers_parent_reviewer_id_audit_idx on public.reviewers(parent_reviewer_id);
create index if not exists students_suspended_by_audit_idx on public.students(suspended_by);

