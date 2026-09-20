"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { authClient } from "@/server/auth/client";

type AuthMode = "sign-in" | "sign-up";

const copy = {
  "sign-in": {
    title: "С возвращением",
    subtitle: "Войди, чтобы открыть общую библиотеку и проверить синхронизацию.",
    submit: "Войти",
    pending: "Входим…",
    switchText: "Ещё нет профиля?",
    switchLabel: "Создать",
    switchHref: "/sign-up",
  },
  "sign-up": {
    title: "Создай профиль",
    subtitle: "Один профиль свяжет библиотеки на разных манга-сервисах.",
    submit: "Создать профиль",
    pending: "Создаём…",
    switchText: "Профиль уже есть?",
    switchLabel: "Войти",
    switchHref: "/sign-in",
  },
} as const;

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const content = copy[mode];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");

    try {
      const result =
        mode === "sign-up"
          ? await authClient.signUp.email({
              name: String(form.get("name") ?? "").trim(),
              email,
              password,
            })
          : await authClient.signIn.email({ email, password, rememberMe: true });

      if (result.error) {
        setError(
          result.error.status === 429
            ? "Слишком много попыток. Подожди минуту и попробуй снова."
            : mode === "sign-in"
              ? "Не удалось войти. Проверь почту и пароль."
              : "Не удалось создать профиль. Проверь данные или попробуй войти.",
        );
        return;
      }

      router.replace("/library");
      router.refresh();
    } catch {
      setError("Сервис авторизации временно недоступен. Попробуй ещё раз.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth-card">
      <div className="auth-heading">
        <p className="eyebrow">Личный Manga Hub</p>
        <h1>{content.title}</h1>
        <p>{content.subtitle}</p>
      </div>

      <form className="auth-form" onSubmit={handleSubmit}>
        {mode === "sign-up" ? (
          <label>
            <span>Имя</span>
            <input
              autoComplete="name"
              minLength={2}
              maxLength={80}
              name="name"
              placeholder="Как к тебе обращаться"
              required
              type="text"
            />
          </label>
        ) : null}

        <label>
          <span>Почта</span>
          <input
            autoCapitalize="none"
            autoComplete="email"
            inputMode="email"
            maxLength={254}
            name="email"
            placeholder="you@example.com"
            required
            type="email"
          />
        </label>

        <label>
          <span>Пароль</span>
          <input
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            minLength={10}
            maxLength={128}
            name="password"
            placeholder="Не короче 10 символов"
            required
            type="password"
          />
        </label>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <button className="button button-primary button-wide" disabled={pending} type="submit">
          {pending ? content.pending : content.submit}
        </button>
      </form>

      <p className="auth-switch">
        {content.switchText} <Link href={content.switchHref}>{content.switchLabel}</Link>
      </p>
      <p className="auth-note">
        Сессия Manga Hub отделена от cookies подключённых сайтов.
      </p>
    </div>
  );
}
