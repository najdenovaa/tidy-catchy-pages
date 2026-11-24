-- A fresh project needs explicit Data API grants as well as row-level policies.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.user_roles, public.profiles, public.fields, public.well_pads, public.wells,
  public.saved_calculations, public.chat_sessions, public.chat_messages, public.analysis_jobs,
  public.user_credits, public.payments, public.followup_questions, public.fleet_configs
TO authenticated;

GRANT SELECT ON public.visit_logs, public.calculation_logs, public.analysis_logs TO authenticated;
GRANT DELETE ON public.calculation_logs TO authenticated;
GRANT SELECT ON public.fleet_configs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.user_roles, public.profiles, public.fields, public.well_pads, public.wells,
  public.saved_calculations, public.chat_sessions, public.chat_messages, public.analysis_jobs,
  public.user_credits, public.payments, public.followup_questions, public.fleet_configs,
  public.visit_logs, public.calculation_logs, public.analysis_logs
TO service_role;

-- Public activity is recorded by the edge function. Clients cannot write the journals directly.
REVOKE INSERT ON public.visit_logs, public.calculation_logs, public.analysis_logs FROM anon, authenticated;

CREATE TABLE public.site_clicks (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  target text NOT NULL CHECK (target IN ('iceberg', 'sts', 'pdf_editor', 'ios_app', 'android_app')),
  clicked_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  ip_address inet
);
CREATE INDEX site_clicks_recent_idx ON public.site_clicks (clicked_at DESC, id DESC);
ALTER TABLE public.site_clicks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.site_clicks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.site_clicks TO service_role;

CREATE FUNCTION public.site_click_report(p_offset integer)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'totals', (
      SELECT jsonb_build_object(
        'all', count(*),
        'iceberg', count(*) FILTER (WHERE target = 'iceberg'),
        'sts', count(*) FILTER (WHERE target = 'sts'),
        'pdf_editor', count(*) FILTER (WHERE target = 'pdf_editor'),
        'ios_app', count(*) FILTER (WHERE target = 'ios_app'),
        'android_app', count(*) FILTER (WHERE target = 'android_app')
      )
      FROM public.site_clicks
    ),
    'clicks', (
      SELECT coalesce(jsonb_agg(to_jsonb(page) ORDER BY clicked_at DESC, id DESC), '[]'::jsonb)
      FROM (
        SELECT id, target, clicked_at, host(ip_address) AS ip_address
        FROM public.site_clicks
        ORDER BY clicked_at DESC, id DESC
        LIMIT 50 OFFSET greatest(p_offset, 0)
      ) AS page
    )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.site_click_report(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.site_click_report(integer) TO service_role;

-- An operator adds the first admin's email here. Only a confirmed email identity
-- can claim the matching invitation, and each invitation can be claimed once.
CREATE SCHEMA deallsoft_private;
REVOKE ALL ON SCHEMA deallsoft_private FROM PUBLIC, anon, authenticated;
CREATE TABLE deallsoft_private.initial_admin (
  email text PRIMARY KEY CHECK (email = lower(email)),
  claimed_by uuid
);

CREATE FUNCTION deallsoft_private.activate_initial_admin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL AND NEW.email IS NOT NULL THEN
    UPDATE deallsoft_private.initial_admin
    SET claimed_by = NEW.id
    WHERE email = lower(NEW.email) AND claimed_by IS NULL;

    IF FOUND THEN
      INSERT INTO public.user_roles (user_id, role)
      VALUES (NEW.id, 'admin')
      ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION deallsoft_private.activate_initial_admin() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER deallsoft_initial_admin
AFTER INSERT OR UPDATE OF email, email_confirmed_at ON auth.users
FOR EACH ROW EXECUTE FUNCTION deallsoft_private.activate_initial_admin();
