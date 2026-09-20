import { Brand } from "@/components/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-shell">
      <div className="auth-brand-row">
        <Brand />
      </div>
      <div className="auth-stage">
        <div className="auth-side-copy" aria-hidden="true">
          <p className="eyebrow">Читай где удобно</p>
          <h2>А прогресс соберём вместе.</h2>
          <div className="orbit">
            <span className="orbit-core">M</span>
            <span className="orbit-node node-one">R</span>
            <span className="orbit-node node-two">L</span>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}
