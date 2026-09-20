import { AppNavigation } from "@/components/app-navigation";
import { requireSession } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  return (
    <div className="app-shell">
      <AppNavigation user={{ email: session.user.email, name: session.user.name }} />
      <main className="app-main">{children}</main>
    </div>
  );
}
