import type { BrowserContext, Page } from "playwright";

/**
 * Reports a user-closed authorization window while allowing short-lived OAuth
 * popup hand-offs to replace the original page.
 */
export function watchAuthorizationWindow(
  context: BrowserContext,
  onClosed: () => void,
  graceMs = 250,
): () => void {
  const browser = context.browser();
  const watchedPages = new Set<Page>();
  let closeTimer: NodeJS.Timeout | undefined;
  let stopped = false;

  function onBrowserDisconnected() {
    if (!stopped) onClosed();
  }

  function onPageClosed() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (!stopped && context.pages().length === 0) onClosed();
    }, graceMs);
  }

  function watchPage(page: Page) {
    if (watchedPages.has(page)) return;
    watchedPages.add(page);
    page.on("close", onPageClosed);
  }

  context.on("page", watchPage);
  const initialPages = context.pages();
  initialPages.forEach(watchPage);
  browser?.on("disconnected", onBrowserDisconnected);
  if (initialPages.length === 0) onPageClosed();

  return () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(closeTimer);
    context.off("page", watchPage);
    browser?.off("disconnected", onBrowserDisconnected);
    for (const page of watchedPages) page.off("close", onPageClosed);
  };
}
