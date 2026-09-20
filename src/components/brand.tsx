import Link from "next/link";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="brand" href={compact ? "/library" : "/"} aria-label="Manga Hub">
      <span className="brand-mark" aria-hidden="true">
        M
      </span>
      <span>Manga Hub</span>
    </Link>
  );
}
