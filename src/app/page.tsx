import Link from "next/link";

import { Brand } from "@/components/brand";

export default function HomePage() {
  return (
    <main className="landing-shell">
      <header className="landing-header">
        <Brand />
        <nav aria-label="Авторизация">
          <Link className="button button-ghost" href="/sign-in">
            Войти
          </Link>
          <Link className="button button-primary" href="/sign-up">
            Создать профиль
          </Link>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Твой прогресс — в одном месте</p>
          <h1>Одна библиотека для всех манга-сервисов.</h1>
          <p className="hero-lead">
            Подключи свои аккаунты, импортируй добавленные тайтлы и смотри прочитанные главы по каждому источнику.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary button-large" href="/sign-up">
              Собрать библиотеку
            </Link>
            <span>ReManga и MangaLib — первыми</span>
          </div>
        </div>

        <div className="hero-preview" aria-label="Пример объединённой библиотеки">
          <div className="preview-topbar">
            <span />
            <span />
            <span />
            <strong>Моя библиотека</strong>
          </div>
          <div className="preview-body">
            <div className="preview-stat">
              <span>В библиотеке</span>
              <strong>128</strong>
              <small>тайтлов из двух источников</small>
            </div>
            <div className="preview-row">
              <span className="preview-cover cover-one">S</span>
              <span>
                <strong>Solo Leveling</strong>
                <small>ReManga · глава 202</small>
              </span>
              <b>202</b>
            </div>
            <div className="preview-row">
              <span className="preview-cover cover-two">B</span>
              <span>
                <strong>Blue Lock</strong>
                <small>MangaLib · глава 315</small>
              </span>
              <b>315</b>
            </div>
            <div className="sync-line">
              <span className="pulse" />
              Последняя синхронизация только что
            </div>
          </div>
        </div>
      </section>

      <section className="feature-strip" aria-label="Возможности">
        <article>
          <span>01</span>
          <h2>Только личная библиотека</h2>
          <p>Никакого лишнего каталога: импортируются тайтлы, которые уже добавлены в твои аккаунты.</p>
        </article>
        <article>
          <span>02</span>
          <h2>Прогресс по источникам</h2>
          <p>Дробные главы, экстра и разные нумерации остаются отдельными подтверждёнными фактами.</p>
        </article>
        <article>
          <span>03</span>
          <h2>Без хранения паролей</h2>
          <p>Вход происходит на сайте источника, а сохранённая сессия шифруется отдельно для подключения.</p>
        </article>
      </section>
    </main>
  );
}
