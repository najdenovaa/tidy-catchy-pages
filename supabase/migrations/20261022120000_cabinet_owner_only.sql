-- Кабинет: каждый пользователь видит только свои месторождения, кусты, скважины и расчёты.
-- Удаляем все существующие политики этих таблиц (в т.ч. добавленные вручную «для всех
-- авторизованных») и создаём заново: владелец — полный доступ, администратор — только чтение.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname, tablename FROM pg_policies
           WHERE schemaname = 'public' AND tablename IN ('fields', 'well_pads', 'wells', 'saved_calculations')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

ALTER TABLE public.fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.well_pads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wells ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_calculations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own fields" ON public.fields FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins view all fields" ON public.fields FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Users manage own pads" ON public.well_pads FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins view all pads" ON public.well_pads FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Users manage own wells" ON public.wells FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins view all wells" ON public.wells FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Users manage own calcs" ON public.saved_calculations FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins view all calcs" ON public.saved_calculations FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));
