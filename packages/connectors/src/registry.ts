import type { ProviderAdapter } from "./contract";
import { MangaLibAdapter } from "./mangalib/adapter";
import { ReMangaAdapter } from "./remanga/adapter";
import type { ProviderCode } from "./types";

const adapters = new Map<ProviderCode, ProviderAdapter>([
  ["remanga", new ReMangaAdapter()],
  ["mangalib", new MangaLibAdapter()],
]);

export function getProviderAdapter(code: ProviderCode): ProviderAdapter {
  const adapter = adapters.get(code);
  if (!adapter) throw new Error(`Provider adapter is not enabled: ${code}`);
  return adapter;
}

export function listProviderAdapters(): ProviderAdapter[] {
  return [...adapters.values()];
}
