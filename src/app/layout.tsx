import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Manga Hub — одна библиотека для разных сервисов",
    template: "%s · Manga Hub",
  },
  description:
    "Личная манга-библиотека и прогресс чтения из ReManga, MangaLib и других сервисов.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
