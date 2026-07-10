
## Задача
Настроить автоматический деплой фронтенда на хостинг Beget через GitHub Actions при каждом push в `main`, а также добавить `.htaccess` для корректной работы React Router (SPA fallback) на Apache-хостинге Beget.

## Файлы, которые будут созданы

### 1. `.github/workflows/deploy-beget.yml`
Workflow с одним job `deploy`, триггер `push` в ветку `main` + `workflow_dispatch` (ручной запуск).

Шаги:
1. `actions/checkout@v4`
2. `actions/setup-node@v4` с `node-version: 20` и `cache: 'npm'`
3. `npm ci`
4. `npm run build` с env:
   - `VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}`
   - `VITE_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.VITE_SUPABASE_PUBLISHABLE_KEY }}`
   - (по желанию можно добавить `VITE_SUPABASE_PROJECT_ID`, если пригодится — уточню ниже)
5. `SamKirkland/FTP-Deploy-Action@v4.3.5` с параметрами:
   - `server: ${{ secrets.FTP_SERVER }}`
   - `username: ${{ secrets.FTP_USERNAME }}`
   - `password: ${{ secrets.FTP_PASSWORD }}`
   - `local-dir: ./dist/`
   - `server-dir: deallsoft.ru/public_html/`
   - `dangerous-clean-slate: false` (по умолчанию, явно укажем для ясности)
   - без `exclude`-исключений сверх дефолтных → файлы на сервере, которых нет в `dist`, не трогаются

### 2. `public/.htaccess`
Точно тот контент, который вы прислали. Vite автоматически копирует всё из `public/` в `dist/` при сборке, отдельная конфигурация не нужна.

## Секреты GitHub, которые вы должны добавить сами
В `Settings → Secrets and variables → Actions` репозитория:
- `VITE_SUPABASE_URL` = `https://bqidvaqvtxoptcfehooe.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY` = ваш anon-ключ (он публичный, но пусть будет в secrets)
- `FTP_SERVER` — обычно `deallsoft.ru` или FTP-хост Beget из панели
- `FTP_USERNAME` — FTP-логин Beget
- `FTP_PASSWORD` — FTP-пароль

Я эти значения добавить в GitHub не могу — добавляете вы вручную.

## Что НЕ буду делать
- Не трогаю `dangerous-clean-slate` → останется `false`, файлы на сервере (favicon, robots.txt, загруженные вручную) сохранятся.
- Не буду сам делать `git add/commit/push` — состояние git управляется Lovable-платформой, изменения синхронизируются в подключённый репозиторий автоматически, как только вы подтвердите план и я применю изменения.

## Уточняющий вопрос
Добавить в build-шаг также `VITE_SUPABASE_PROJECT_ID` (используется в вашем `.env`)? Если этот id где-то читается в рантайме — стоит, иначе можно опустить. Скажите — или просто «применяй как есть», и я оставлю только два ключа, которые вы указали.
