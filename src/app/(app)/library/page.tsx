import type { Metadata } from "next";

import { LibraryPanel } from "@/components/library-panel";

export const metadata: Metadata = { title: "Библиотека" };

export default function LibraryPage() {
  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Личная коллекция</p>
          <h1>Библиотека</h1>
          <p>Тайтлы и подтверждённый прогресс из подключённых аккаунтов.</p>
        </div>
        <a className="button button-secondary" href="/connections">
          Управлять источниками
        </a>
      </header>
      <LibraryPanel />
    </div>
  );
}
