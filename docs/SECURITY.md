# Безопасность аккаунтов и внешних сессий

Статус: проект для первого MVP, 20 сентября 2026 года.

Cookies и bearer tokens подключённых сайтов фактически дают доступ к чужому аккаунту. Для Manga Hub это самые чувствительные данные после ключа шифрования. Их защита проектируется до первого реального адаптера.

## Два разных вида сессий

1. **Сессия Manga Hub** подтверждает, какой пользователь работает с нашим API.
2. **Сессия источника** позволяет worker читать личную библиотеку MangaLib, ReManga и других площадок.

Они не смешиваются. Browser cookie Manga Hub никогда не используется при запросе к источнику, а cookie источника никогда не отправляется в браузер пользователя или API response.

## Авторизация Manga Hub

Better Auth хранит пользователей и серверные сессии в PostgreSQL. Настройки MVP:

- email/password с кастомным Argon2id hasher;
- параметры Argon2id калибруются на production-машине и не понижаются молча;
- host-only cookie с `Secure`, `HttpOnly`, `SameSite=Lax` в production;
- точный `baseURL` и allowlist trusted origins;
- database session без долгоживущего JWT в localStorage;
- rate limit для sign-up, sign-in, reset и source connect;
- отзыв остальных сессий после смены/сброса пароля;
- email verification и reset flow обязательны до открытия регистрации наружу.

В UI не показываются причины, по которым можно определить существование чужого email.

## Получение сессии источника

Предпочтение способов подключения:

1. официальный OAuth/API, если он появится;
2. интерактивная изолированная браузерная сессия;
3. provider-specific одноразовый credential flow только для источника без browser challenge.

Логин и пароль источника не сохраняются. В основном сценарии они вводятся внутри временного Chromium context. Auth worker не включает tracing, video, HAR и запись console/network bodies. После успешной проверки извлекается минимальный session bundle, браузерный профиль уничтожается, а временное хранилище располагается в `tmpfs` в production.

Remote browser gateway:

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
  "sessionStorage": [],
  "userAgent": "...",
  "createdAt": "...",
  "knownExpiresAt": "..."
}
```

Сохраняются только origins из allowlist адаптера. Не относящиеся к авторизации localStorage/IndexedDB/sessionStorage значения отбрасываются; sessionStorage адаптер извлекает явно только там, где он действительно нужен. Session bundle не пишется в debug output, fixtures, traces или файловый кэш.

## Envelope encryption

Для каждого `source_connection` генерируется отдельный случайный 256-bit data encryption key (DEK).

1. Session bundle шифруется DEK через XChaCha20-Poly1305.
2. DEK заворачивается key encryption key (KEK) тем же AEAD.
3. PostgreSQL получает ciphertext, два уникальных nonce, wrapped DEK, версии формата/KEK и timestamps.
4. Associated data связывает ciphertext с `user_id`, `source_connection_id`, `source code` и версией формата.

Новый 24-byte nonce создаётся CSPRNG для каждой операции. Криптографические примитивы предоставляет libsodium; собственная реализация алгоритма не пишется.

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

Локально `MANGA_HUB_KEK_FILE` указывает на файл вне репозитория с правами только владельца. На Ubuntu исходный файл принадлежит root, имеет режим `0400`, а в контейнер монтируется read-only и доступен только UID worker-процесса через Docker secret. Compose secret упрощает доставку файла, но не считается самостоятельным vault.

Резервная копия KEK хранится отдельно от дампов PostgreSQL. Потеря всех копий KEK означает намеренную невозможность восстановить внешние сессии; библиотека останется, но аккаунты придётся подключать заново.

Только роли `sync_worker` и `auth_worker` могут читать `source_secrets`. Роль `web_api` видит метаданные подключения, но не ciphertext и не получает KEK.

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

Глобальный redaction удаляет значения заголовков и полей:

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

Audit log фиксирует вход в Manga Hub, создание/удаление подключения, повторную авторизацию, расшифрование для sync, ротацию ключей и административные действия. Он не содержит сам секрет.

## Сетевая изоляция

- PostgreSQL и workers не публикуют порты наружу.
- Наружу открыт только reverse proxy на 80/443; HTTP перенаправляется на HTTPS.
- Адаптер определяет точный allowlist origins; пользователь не передаёт URL для server-side fetch.
- Redirect на другой host удаляет cookies/Authorization и обычно завершает запрос.
- Запрещены loopback, private, link-local, metadata IP и неожиданные DNS rebinding результаты.
- Ответы имеют timeout и максимальный размер; parser не исполняет полученный HTML/JS вне изолированного Chromium.
- Browser worker и обычный sync worker работают без root, Docker socket и лишних Linux capabilities.

## Контроль доступа к данным

Любой запрос к библиотеке и подключению scoped по `user_id`. Repository API не предоставляет вариант `findById(id)` для пользовательских ресурсов без обязательного user ID. Проверяются IDOR-сценарии: чтение, изменение, удаление, sync, reauth и просмотр журнала чужого подключения.

Для production рассматривается PostgreSQL RLS как второй рубеж. Даже с RLS проверка авторизации в приложении остаётся обязательной.

## Удаление подключения и аккаунта

При удалении подключения:

1. отменяются будущие jobs и активная auth attempt;
2. при наличии безопасного endpoint предпринимается попытка отозвать provider session;
3. удаляются wrapped DEK и ciphertext;
4. исходные записи библиотеки либо удаляются, либо остаются по явному выбору пользователя;
5. создаётся audit event без секретных полей.

Удаление профиля запускает тот же процесс для всех подключений, затем удаляет пользовательские данные по документированной retention policy.

## Резервные копии

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
