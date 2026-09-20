"use client";

import { useCallback, useEffect, useState } from "react";

type Source = {
  code: string;
  name: string;
  description: string;
  browserRequired: boolean;
  connectionEnabled: boolean;
};

type Connection = {
  id: string;
  sourceCode: string;
  sourceName: string;
  remoteDisplayName: string | null;
  status: string;
  lastSyncedAt: string | null;
};

type LoadState =
  | { status: "loading" }
  | { status: "ready"; sources: Source[]; connections: Connection[] }
  | { status: "error" };

export function ConnectionsPanel() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [connecting, setConnecting] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
      try {
        const [sourcesResponse, connectionsResponse] = await Promise.all([
          fetch("/api/v1/sources", { signal }),
          fetch("/api/v1/connections", { signal }),
        ]);

        if (!sourcesResponse.ok || !connectionsResponse.ok) throw new Error("request failed");

        const [sources, connections] = (await Promise.all([
          sourcesResponse.json(),
          connectionsResponse.json(),
        ])) as [{ items: Source[] }, { items: Connection[] }];

        setState({ status: "ready", sources: sources.items, connections: connections.items });
      } catch (error) {
        if ((error as Error).name !== "AbortError") setState({ status: "error" });
      }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function loadInitialState() {
      await load(controller.signal);
    }
    void loadInitialState();
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (state.status !== "ready") return;
    const pending = state.connections.some((connection) =>
      ["pending_auth", "awaiting_user", "validating", "importing"].includes(connection.status),
    );
    if (!pending && !connecting) return;
    const timer = window.setInterval(() => void load(), 2_000);
    return () => window.clearInterval(timer);
  }, [connecting, load, state]);

  async function connect(sourceCode: string) {
    setConnecting(sourceCode);
    setActionError(null);
    try {
      const response = await fetch("/api/v1/connections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceCode }),
      });
      if (!response.ok) throw new Error("connection failed");
      await load();
    } catch {
      setActionError("Не удалось запустить вход. Проверь, что worker запущен, и попробуй ещё раз.");
    } finally {
      setConnecting(null);
    }
  }

  const statusLabel = (status: string) => {
    const labels: Record<string, string> = {
      pending_auth: "В очереди",
      awaiting_user: "Ждёт входа",
      validating: "Проверка сессии",
      importing: "Импорт библиотеки",
      active: "Синхронизируется",
      reauth_required: "Нужен повторный вход",
      needs_attention: "Нужно внимание",
      rate_limited: "Пауза по лимиту",
      degraded: "Ошибка синхронизации",
    };
    return labels[status] ?? status;
  };

  if (state.status === "loading") {
    return (
      <div className="card-grid" aria-label="Загрузка подключений">
        <div className="source-card skeleton-card" />
        <div className="source-card skeleton-card" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="empty-state compact">
        <span className="empty-icon" aria-hidden="true">!</span>
        <h2>Не удалось загрузить подключения</h2>
        <p>Обнови страницу. Если ошибка повторится, проверь соединение с сервером.</p>
      </div>
    );
  }

  return (
    <div className="connections-stack">
      {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}
      {state.connections.length ? (
        <section aria-labelledby="active-connections">
          <h2 id="active-connections">Подключённые аккаунты</h2>
          <div className="card-grid">
            {state.connections.map((connection) => (
              <article className="source-card" key={connection.id}>
                <div className="source-card-heading">
                  <span className="source-monogram">{connection.sourceName.slice(0, 1)}</span>
                  <div>
                    <h3>{connection.sourceName}</h3>
                    <p>{connection.remoteDisplayName ?? "Внешний аккаунт"}</p>
                  </div>
                </div>
                <span className={`status-pill ${connection.status === "active" ? "success" : ""}`}>
                  {statusLabel(connection.status)}
                </span>
              </article>
            ))}
          </div>
        </section>
      ) : (
        <div className="empty-state compact">
          <span className="empty-icon" aria-hidden="true">↗</span>
          <h2>Подключений пока нет</h2>
          <p>Выбери сервис ниже. После входа Manga Hub импортирует только твою личную библиотеку.</p>
        </div>
      )}

      <section aria-labelledby="available-sources">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Источники</p>
            <h2 id="available-sources">Добавить аккаунт</h2>
          </div>
          <span className="privacy-note">Пароль вводится на странице источника</span>
        </div>

        <div className="card-grid">
          {state.sources.map((source) => {
            const connection = state.connections.find(
              (connection) => connection.sourceCode === source.code,
            );
            const active = connection?.status === "active";
            const pending = connection
              ? ["pending_auth", "awaiting_user", "validating", "importing"].includes(connection.status)
              : false;
            const busy = connecting === source.code || pending;

            return (
              <article className="source-card" key={source.code}>
                <div className="source-card-heading">
                  <span className={`source-monogram source-${source.code}`}>
                    {source.name.slice(0, 1)}
                  </span>
                  <div>
                    <h3>{source.name}</h3>
                    <p>{source.description}</p>
                  </div>
                </div>
                <div className="source-card-footer">
                  <span className="status-pill">
                    {source.browserRequired ? "Вход в отдельном окне" : "API"}
                  </span>
                  <button
                    className="button button-secondary"
                    disabled={active || busy || !source.connectionEnabled}
                    onClick={() => void connect(source.code)}
                    type="button"
                  >
                    {active
                      ? "Подключено"
                      : busy
                        ? connection?.status === "awaiting_user"
                          ? "Заверши вход"
                          : "Запускаю…"
                        : connection
                          ? "Повторить вход"
                          : source.connectionEnabled
                            ? "Подключить"
                            : "Скоро"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
