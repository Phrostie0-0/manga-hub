import { EventEmitter } from "node:events";

import type { BrowserContext, Page } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";

import { watchAuthorizationWindow } from "../../workers/auth-browser/window-lifecycle";

class FakePage extends EventEmitter {}
class FakeBrowser extends EventEmitter {}
class FakeContext extends EventEmitter {
  readonly fakeBrowser = new FakeBrowser();
  openPages: FakePage[] = [];

  browser() {
    return this.fakeBrowser;
  }

  pages() {
    return this.openPages;
  }
}

describe("watchAuthorizationWindow", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports closing the final page", () => {
    vi.useFakeTimers();
    const context = new FakeContext();
    const page = new FakePage();
    context.openPages = [page];
    const onClosed = vi.fn();

    const stop = watchAuthorizationWindow(
      context as unknown as BrowserContext,
      onClosed,
      25,
    );
    context.openPages = [];
    page.emit("close");
    vi.advanceTimersByTime(25);

    expect(onClosed).toHaveBeenCalledOnce();
    stop();
  });

  it("allows an OAuth popup to replace the original page", () => {
    vi.useFakeTimers();
    const context = new FakeContext();
    const original = new FakePage();
    const popup = new FakePage();
    context.openPages = [original];
    const onClosed = vi.fn();

    const stop = watchAuthorizationWindow(
      context as unknown as BrowserContext,
      onClosed,
      25,
    );
    context.openPages = [popup];
    context.emit("page", popup as unknown as Page);
    original.emit("close");
    vi.advanceTimersByTime(25);

    expect(onClosed).not.toHaveBeenCalled();
    stop();
  });

  it("reports the whole browser disconnecting immediately", () => {
    const context = new FakeContext();
    const onClosed = vi.fn();

    const stop = watchAuthorizationWindow(
      context as unknown as BrowserContext,
      onClosed,
    );
    context.fakeBrowser.emit("disconnected");

    expect(onClosed).toHaveBeenCalledOnce();
    stop();
  });

  it("reports a window that was already closed before observation started", () => {
    vi.useFakeTimers();
    const context = new FakeContext();
    const onClosed = vi.fn();

    const stop = watchAuthorizationWindow(
      context as unknown as BrowserContext,
      onClosed,
      25,
    );
    vi.advanceTimersByTime(25);

    expect(onClosed).toHaveBeenCalledOnce();
    stop();
  });
});
