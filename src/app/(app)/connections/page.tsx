import type { Metadata } from "next";

import { ConnectionsPanel } from "@/components/connections-panel";

export const metadata: Metadata = { title: "Подключения" };

export default function ConnectionsPage() {
  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Внешние аккаунты</p>
          <h1>Подключения</h1>
          <p>Управляй источниками, повторным входом и синхронизацией.</p>
        </div>
      </header>
      <ConnectionsPanel />
    </div>
  );
}
