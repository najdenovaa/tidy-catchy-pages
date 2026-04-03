
CREATE TABLE public.fleet_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_number integer NOT NULL UNIQUE,
  is_online boolean NOT NULL DEFAULT false,
  brigade text DEFAULT '',
  operation text DEFAULT '',
  field_name text DEFAULT '',
  well_number text DEFAULT '',
  customer text DEFAULT '',
  signal_type text DEFAULT 'gprs',
  pressure numeric DEFAULT 0,
  rate numeric DEFAULT 0,
  density numeric DEFAULT 0,
  volume numeric DEFAULT 0,
  temperature numeric DEFAULT 0,
  tank1_capacity numeric DEFAULT 6,
  tank1_level numeric DEFAULT 0,
  tank2_capacity numeric DEFAULT 2,
  tank2_level numeric DEFAULT 0,
  engine1_rpm integer DEFAULT 0,
  engine2_rpm integer DEFAULT 0,
  casing_diameter text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fleet_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage fleet configs"
ON public.fleet_configs FOR ALL
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Anyone can read fleet configs"
ON public.fleet_configs FOR SELECT
TO authenticated
USING (true);

CREATE TRIGGER update_fleet_configs_updated_at
BEFORE UPDATE ON public.fleet_configs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Seed initial fleet data
INSERT INTO public.fleet_configs (fleet_number, is_online, brigade, operation, field_name, well_number, customer, signal_type, pressure, rate, density, volume, temperature, tank1_level, tank2_level, engine1_rpm, engine2_rpm, casing_diameter)
VALUES
  (1, false, '', '', '', '', '', 'gprs', 0, 0, 0, 0, 0, 0, 0, 0, 0, ''),
  (2, false, '', '', '', '', '', 'gprs', 0, 0, 0, 0, 0, 0, 0, 0, 0, ''),
  (3, false, '', '', '', '', '', 'gprs', 0, 0, 0, 0, 0, 0, 0, 0, 0, ''),
  (5, true, 'Портнова А.В.', 'Цементирование ЭК 146мм', 'Ореховое', '21', 'ООО «Зарубежнефть Добыча Самара»', 'gprs', 6.5, 11.59, 1.20, 1.75, 22.6, 4.23, 1.32, 900, 1523, '146');
