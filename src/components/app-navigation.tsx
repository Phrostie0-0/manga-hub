"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/server/auth/client";

import { Brand } from "./brand";

const links = [
  { href: "/library", label: "Библиотека" },
  { href: "/connections", label: "Подключения" },
] as const;

export function AppNavigation({
  user,
}: {
  user: { email: string; name: string };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  const initials = user.name.trim().slice(0, 2).toLocaleUpperCase("ru-RU") || "MH";

  return (
    <>
      <aside className="app-sidebar">
        <Brand compact />
        <nav className="app-nav" aria-label="Основная навигация">
          {links.map((link) => (
            <Link
              aria-current={pathname === link.href ? "page" : undefined}
              className={pathname === link.href ? "active" : undefined}
              href={link.href}
              key={link.href}
            >
              <span aria-hidden="true">{link.href === "/library" ? "◫" : "↗"}</span>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="account-summary">
            <span className="avatar" aria-hidden="true">
              {initials}
            </span>
            <span>
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </span>
          </div>
          <button className="button button-ghost button-wide" disabled={signingOut} onClick={signOut}>
            {signingOut ? "Выходим…" : "Выйти"}
          </button>
        </div>
      </aside>

      <nav className="mobile-nav" aria-label="Навигация на мобильном">
        {links.map((link) => (
          <Link
            aria-current={pathname === link.href ? "page" : undefined}
            className={pathname === link.href ? "active" : undefined}
            href={link.href}
            key={link.href}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
