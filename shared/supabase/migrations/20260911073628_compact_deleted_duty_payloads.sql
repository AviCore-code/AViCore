-- Retain tombstones for offline clients, without retaining replaced FDT payloads.
-- No existing rows are changed here: the maintenance step requires a verified backup.
CREATE OR REPLACE FUNCTION public.compact_deleted_duty_payload()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  -- A stale offline push must not resurrect a deletion or overwrite newer data.
  IF TG_OP = 'UPDATE' AND OLD.deleted_at IS NOT NULL
     AND NEW.modified_at <= OLD.modified_at THEN
    NEW := OLD;
  END IF;
  IF NEW.deleted_at IS NOT NULL THEN
    NEW.entry_json := '{}'::jsonb;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.compact_deleted_duty_payload() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER compact_deleted_duty_payload
BEFORE INSERT OR UPDATE ON public."Admin_pilot_duty_entries"
FOR EACH ROW EXECUTE FUNCTION public.compact_deleted_duty_payload();
