-- Archive inserts go directly through PostgREST, so capture the gateway IP there.
CREATE FUNCTION deallsoft_private.capture_calculation_ip()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  client_ip text := headers->>'cf-connecting-ip';
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  BEGIN
    NEW.ip_address := host(nullif(btrim(client_ip), '')::inet);
  EXCEPTION WHEN invalid_text_representation THEN
    NEW.ip_address := NULL;
  END;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION deallsoft_private.capture_calculation_ip() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER deallsoft_calculation_ip
BEFORE INSERT ON public.calculation_logs
FOR EACH ROW EXECUTE FUNCTION deallsoft_private.capture_calculation_ip();
