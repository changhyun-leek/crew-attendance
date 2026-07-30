begin;

alter table public.account_security_events
  drop constraint if exists account_security_events_event_type_check;

alter table public.account_security_events
  add constraint account_security_events_event_type_check
  check (event_type in ('first_pin_setup_succeeded', 'first_pin_setup_failed', 'pin_changed', 'pin_reset', 'master_key_login'));

commit;
