# Безопасность аккаунтов и внешних сессий

Статус: локальный MVP, 20 сентября 2026 года. Документ разделяет уже реализованные меры и целевую production-модель; пункты с пометкой «до публичного запуска» пока не являются свойствами приложения.

Cookies и bearer tokens подключённых сайтов фактически дают доступ к чужому аккаунту. Для Manga Hub это самые чувствительные данные после ключа шифрования. Их защита проектируется до первого реального адаптера.

## Два разных вида сессий

1. **Сессия Manga Hub** подтверждает, какой пользователь работает с нашим API.
2. **Сессия источника** позволяет worker читать личную библиотеку MangaLib, ReManga и других площадок.

Они не смешиваются. Browser cookie Manga Hub никогда не используется при запросе к источнику, а cookie источника никогда не отправляется в браузер пользователя или API response.

## Авторизация Manga Hub

Better Auth хранит пользователей и серверные сессии в PostgreSQL. Настройки MVP:

- email/password с кастомным Argon2id hasher;
- Argon2id использует зафиксированные параметры (`64 MiB`, `t=3`, `p=4`); перед production их нужно откалибровать на целевой машине;
- host-only cookie с `Secure`, `HttpOnly`, `SameSite=Lax` в production;
- точный `baseURL` и allowlist trusted origins;
- database session без долгоживущего JWT в localStorage;
- отзыв остальных сессий после смены/сброса пароля;

До публичного запуска добавляются rate limit для sign-up/sign-in/reset/source connect, подтверждение email и рабочий reset flow с почтовым transport.

В UI не показываются причины, по которым можно определить существование чужого email.

## Получение сессии источника

Предпочтение способов подключения:

1. официальный OAuth/API, если он появится;
2. интерактивная изолированная браузерная сессия;
3. provider-specific одноразовый credential flow только для источника без browser challenge.

Логин и пароль источника не сохраняются. В основном сценарии они вводятся внутри временного Chromium context. Auth worker не включает tracing, video, HAR и запись console/network bodies. После успешной проверки извлекается минимальный session bundle, браузерный профиль уничтожается, а временное хранилище располагается в `tmpfs` в production.

Целевой remote browser gateway для серверного запуска (в локальном MVP вместо него открывается отдельное окно Chromium):

- выдаёт одноразовый подписанный URL с TTL 10–15 минут;
- связывает попытку с текущим `user_id` и `connection_id`;
- разрешает один активный browser context на попытку;
- запрещает `file:`, загрузки, clipboard, DevTools и произвольную навигацию;
- ограничивает DNS/egress allowlist доменами и CDN конкретного adapter-а;
- не передаёт cookies через JavaScript страницы Manga Hub;
- уничтожает context при успехе, отмене, timeout или разрыве соединения.

Наличие CAPTCHA или 2FA переводит попытку в `awaiting_user`; автоматического обхода нет.

## Формат session bundle

До шифрования worker создаёт версионированный JSON:

```json
{
  "formatVersion": 1,
  "cookies": [],
  "origins": [],
  "accessToken": "...",
  "userAgent": "...",
  "createdAt": "...",
  "knownExpiresAt": "..."
}
```

Локальный MVP сохраняет allowlisted cookies и отдельно найденный bearer token. `localStorage`, IndexedDB и sessionStorage в bundle не копируются; поле `origins` остаётся пустым. Session bundle не пишется в debug output, fixtures, traces или файловый кэш.

## Envelope encryption

Для каждого `source_connection` генерируется отдельный случайный 256-bit data encryption key (DEK).

1. Session bundle шифруется DEK через AES-256-GCM.
2. DEK заворачивается key encryption key (KEK) тем же AEAD.
3. PostgreSQL получает ciphertext, два уникальных nonce, wrapped DEK, версии формата/KEK и timestamps.
4. Associated data связывает ciphertext с `user_id`, `source_connection_id`, `source code` и версией формата.

Новый 12-byte nonce создаётся CSPRNG для каждой операции. Криптографические примитивы предоставляет `node:crypto`; authentication tag хранится вместе с ciphertext. Собственная реализация AES не пишется.

Пример полей `source_secrets`:

```text
source_connection_id
format_version
cipher
ciphertext
payload_nonce
wrapped_dek
wrap_nonce
key_provider
kek_version
created_at
updated_at
```

Незашифрованными остаются только сведения, нужные для интерфейса и планировщика: источник, внешний ID/display name аккаунта, connection status и known expiry. Значения cookie/token там отсутствуют.

## Где хранится KEK

KEK не хранится:

- в PostgreSQL или её backup;
- в git и `.env.example`;
- в Docker image/Compose YAML;
- в job payload или логах.

Локально `MANGA_HUB_KEK_FILE` указывает на исключённый из git файл `.local/secrets/credential-kek-v1` с режимом `0600`; каталоги `.local` и `secrets` имеют режим `0700`. В целевой Ubuntu-конфигурации исходный файл принадлежит root, имеет режим `0400`, а в контейнер монтируется read-only и доступен только UID worker-процесса через Docker secret. Compose secret упрощает доставку файла, но не считается самостоятельным vault.

Резервная копия KEK хранится отдельно от дампов PostgreSQL. Потеря всех копий KEK означает намеренную невозможность восстановить внешние сессии; библиотека останется, но аккаунты придётся подключать заново.

Локальный MVP использует одну роль PostgreSQL. До публичного запуска роли разделяются: только `sync_worker` и `auth_worker` смогут читать `source_secrets`, а `web_api` будет видеть метаданные подключения без ciphertext и KEK.

## Ротация

Плановая замена KEK не перешифровывает каждый session bundle:

1. создать `KEK v2` и сделать её активной для новых secrets;
2. worker временно получает `v1` и `v2`;
3. фоновая задача расшифровывает только DEK старым KEK и заворачивает новым;
4. строка атомарно получает новый `wrapped_dek`, nonce и `kek_version`;
5. после проверки всех строк и истечения срока старых backup `v1` выводится из эксплуатации.

Задание rewrap идемпотентно. При подозрении на компрометацию worker/DEK выполняется полное перешифрование новым DEK и отзыв сессии у источника, если источник это позволяет.

Интерфейс key wrapper задаётся заранее:

```ts
interface KeyWrapper {
  wrap(dek: Uint8Array, context: KeyContext): Promise<WrappedKey>;
  unwrap(key: WrappedKey, context: KeyContext): Promise<Uint8Array>;
}
```

Первая реализация читает локальный KEK file. Позже её можно заменить на Vault Transit либо AWS/GCP/Azure KMS без изменения ciphertext пользовательских сессий; постепенно меняется только wrapped DEK.

## Логи, ошибки и диагностика

Код MVP не логирует session bundle и полные request/response bodies внешних сайтов. До публичного запуска добавляется глобальный redaction значений заголовков и полей:

```text
Cookie
Set-Cookie
Authorization
Proxy-Authorization
password
token
secret
storageState
```

Не логируются полные request/response bodies внешних сайтов. Для диагностики parser-а разрешены только allowlisted структурные поля, размер ответа, content type и hash обезличенного fixture. Ошибка пользователю содержит код и безопасное описание; сырые HTML/JSON отсутствуют.

До публичного запуска audit log должен фиксировать вход в Manga Hub, создание/удаление подключения, повторную авторизацию, расшифрование для sync, ротацию ключей и административные действия. Сам секрет в события не входит.

## Сетевая изоляция

Сейчас адаптер определяет точный allowlist origins, пользователь не передаёт URL для server-side fetch, redirect запрещён, а JSON-ответ ограничен двумя мегабайтами. До публичного запуска добавляются отдельный request timeout и проверка результатов DNS.

В целевой Ubuntu-среде PostgreSQL и workers не публикуют порты наружу, reverse proxy принимает 80/443 с перенаправлением на HTTPS, а browser/sync workers работают без root, Docker socket и лишних Linux capabilities.

## Контроль доступа к данным

Любой запрос к библиотеке и подключению scoped по `user_id`. Repository API не предоставляет вариант `findById(id)` для пользовательских ресурсов без обязательного user ID. Проверяются IDOR-сценарии: чтение, изменение, удаление, sync, reauth и просмотр журнала чужого подключения.

Для production рассматривается PostgreSQL RLS как второй рубеж. Даже с RLS проверка авторизации в приложении остаётся обязательной.

## Удаление подключения и аккаунта — до публичного запуска

При удалении подключения:

1. отменяются будущие jobs и активная auth attempt;
2. при наличии безопасного endpoint предпринимается попытка отозвать provider session;
3. удаляются wrapped DEK и ciphertext;
4. исходные записи библиотеки либо удаляются, либо остаются по явному выбору пользователя;
5. создаётся audit event без секретных полей.

Удаление профиля запускает тот же процесс для всех подключений, затем удаляет пользовательские данные по документированной retention policy.

## Резервные копии — до публичного запуска

- дампы PostgreSQL шифруются;
- KEK backup хранится отдельно;
- срок хранения старых KEK не короче срока хранения совместимых дампов;
- восстановление проверяется до публичного запуска и после изменения схемы secrets;
- восстановленная staging-среда не получает сетевой доступ к реальным источникам, пока secrets не заменены или не отозваны.

## Остаточный риск

Шифрование защищает украденный дамп БД, но не полностью захваченный worker: работающий процесс с доступом к KEK обязан расшифровывать сессии для sync. Поэтому обновления, изоляция процесса, минимальная DB-роль, egress allowlist и отсутствие Docker socket так же важны, как алгоритм шифрования.

## Источники рекомендаций

- [OWASP: Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP: Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP: Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [OWASP: Cryptographic Storage](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
- [Playwright: authentication state is sensitive](https://playwright.dev/docs/auth)
- [Docker Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/)
