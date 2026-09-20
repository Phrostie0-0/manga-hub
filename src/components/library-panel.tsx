"use client";

import { useEffect, useState } from "react";

type LibraryItem = {
  id: string;
  title: string;
  status: string;
  coverUrl: string | null;
  sources: Array<{
    code: string;
    name: string;
    progressLabel: string | null;
    observedAt: string | null;
  }>;
};

type LibraryResponse = {
  items: LibraryItem[];
  total: number;
};

export function LibraryPanel() {
  const [query, setQuery] = useState("");
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const search = new URLSearchParams();
    if (query.trim()) search.set("query", query.trim());

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/v1/library?${search}`, { signal: controller.signal });
        if (!response.ok) throw new Error("request failed");
        setData((await response.json()) as LibraryResponse);
        setFailed(false);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setFailed(true);
      }
    }, query ? 180 : 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return (
    <div className="library-stack">
      <div className="library-toolbar">
        <label className="search-field">
          <span className="sr-only">Поиск по личной библиотеке</span>
          <span aria-hidden="true">⌕</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Найти в своей библиотеке"
            type="search"
            value={query}
          />
        </label>
        <span className="item-count">{data?.total ?? 0} тайтлов</span>
      </div>

      {failed ? (
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true">!</span>
          <h2>Библиотека не загрузилась</h2>
          <p>Обнови страницу или попробуй чуть позже.</p>
        </div>
      ) : !data ? (
        <div className="library-list" aria-label="Загрузка библиотеки">
          <div className="library-row skeleton-row" />
          <div className="library-row skeleton-row" />
        </div>
      ) : data.items.length ? (
        <div className="library-list">
          {data.items.map((item) => (
            <article className="library-row" key={item.id}>
              <div className="cover-placeholder" aria-hidden="true">
                {item.title.slice(0, 1)}
              </div>
              <div className="library-title">
                <h2>{item.title}</h2>
                <p>{item.status}</p>
              </div>
              <div className="source-progress">
                {item.sources.map((source) => (
                  <span key={source.code}>
                    <strong>{source.name}</strong>
                    {source.progressLabel ?? "Прогресс неизвестен"}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true">◫</span>
          <h2>{query ? "Ничего не найдено" : "Здесь появится твоя библиотека"}</h2>
          <p>
            {query
              ? "Попробуй другое название. Поиск работает только по импортированным тайтлам."
              : "Подключи ReManga или MangaLib — после первого импорта здесь появятся тайтлы и прогресс по каждому источнику."}
          </p>
          {!query ? (
            <a className="button button-primary" href="/connections">
              Перейти к подключениям
            </a>
          ) : null}
        </div>
      )}
    </div>
  );
}
