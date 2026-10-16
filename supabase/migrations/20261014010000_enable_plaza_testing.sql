-- Enable the user's authorized localhost test against the actual Cali project.
-- This boolean change is reversible with cali_plaza_set_enabled(false) from an
-- authenticated administrator, or a later migration setting it back to false.
-- No core student/reviewer records or Realtime project settings are changed.
update public.cali_system_settings
set plaza_enabled=true, updated_at=now(), updated_by=null
where singleton;
