"use client";

import { useEffect } from "react";
import { SWEET_DAW_BUILD_INFO } from "@/generated/buildInfo";

const BUILD_STORAGE_KEY = "sweet-daw:last-build-id";
const REFRESH_SESSION_KEY = "sweet-daw:refreshing-build-id";
const CHUNK_REFRESH_SESSION_KEY = "sweet-daw:refreshing-after-chunk-error";
const REFRESH_ATTEMPT_PREFIX = "sweet-daw:refresh-attempts:";
const MAX_REFRESH_ATTEMPTS_PER_SESSION = 2;

type RemoteBuildInfo = {
  buildId?: string;
};

export function UpdateGuard() {
  useEffect(() => {
    let cancelled = false;

    const checkForFreshBuild = async () => {
      try {
        // Delay to avoid Next.js hydration and rendering collisions
        await new Promise((resolve) => setTimeout(resolve, 3000));
        if (cancelled) return;

        const latestBuildId = await fetchLatestBuildId();
        if (cancelled || !latestBuildId) return;

        const currentBuildId = SWEET_DAW_BUILD_INFO.buildId;
        setLocalStorage(BUILD_STORAGE_KEY, latestBuildId);

        if (latestBuildId === currentBuildId) {
          removeSessionStorage(REFRESH_SESSION_KEY);
          return;
        }

        if (!canAttemptSessionRefresh(`build:${latestBuildId}`)) {
          return;
        }

        setSessionStorage(REFRESH_SESSION_KEY, latestBuildId);
        await clearRuntimeCaches();

        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set("sdaw_v", latestBuildId);
        window.location.replace(nextUrl.toString());
      } catch {
        // Update checks must never prevent the DAW from loading.
      }
    };

    void checkForFreshBuild();

    const registerServiceWorker = async () => {
      try {
        // Delay SW registration until application is fully hydrated and stable
        await new Promise((resolve) => setTimeout(resolve, 3500));
        if (cancelled) return;

        if ("serviceWorker" in navigator && window.location.protocol === "https:") {
          const basePath = getBasePath();
          const scriptURL = `${basePath}/sw.js`;
          const scope = `${basePath}/`;
          await navigator.serviceWorker.register(scriptURL, {
            scope,
          });
          console.info("[Sweet DAW] Service worker registered", { basePath, scriptURL, scope });
        }
      } catch {
        // SW registration failed silently
      }
    };
    void registerServiceWorker();

    const cleanupPullToRefreshGuard = installPullToRefreshGuard();
    const cleanupChunkErrorGuard = installChunkErrorGuard();

    return () => {
      cancelled = true;
      cleanupPullToRefreshGuard();
      cleanupChunkErrorGuard();
    };
  }, []);

  return null;
}

function installChunkErrorGuard() {
  const recover = () => {
    const buildId = SWEET_DAW_BUILD_INFO.buildId;
    if (!canAttemptSessionRefresh(`chunk:${buildId}`)) return;
    setSessionStorage(CHUNK_REFRESH_SESSION_KEY, buildId);

    void clearRuntimeCaches().finally(() => {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("sdaw_chunkfix", Date.now().toString());
      window.location.replace(nextUrl.toString());
    });
  };

  const onError = (event: ErrorEvent) => {
    const message = `${event.message ?? ""} ${event.filename ?? ""}`;
    if (isChunkLoadFailure(message)) {
      event.preventDefault();
      recover();
    }
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason instanceof Error ? `${event.reason.name} ${event.reason.message}` : String(event.reason);
    if (isChunkLoadFailure(reason)) {
      event.preventDefault();
      recover();
    }
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}

function isChunkLoadFailure(message: string) {
  return /ChunkLoadError|Loading chunk|failed to fetch dynamically imported module|Importing a module script failed|_next\/static\/chunks/i.test(
    message,
  );
}

function installPullToRefreshGuard() {
  let touchStartY = 0;

  const onTouchStart = (event: TouchEvent) => {
    touchStartY = event.touches[0]?.clientY ?? 0;
  };

  const onTouchMove = (event: TouchEvent) => {
    if (isInteractiveControl(event.target)) return;
    if (event.touches.length !== 1) return;

    const currentY = event.touches[0]?.clientY ?? 0;
    const pullingDown = currentY > touchStartY;
    if (!pullingDown) return;

    const scrollParent = findScrollableParent(event.target);
    const scrollTop = scrollParent ? scrollParent.scrollTop : window.scrollY;
    if (scrollTop <= 0) {
      event.preventDefault();
    }
  };

  try {
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
  } catch {
    return () => undefined;
  }

  return () => {
    document.removeEventListener("touchstart", onTouchStart);
    document.removeEventListener("touchmove", onTouchMove);
  };
}

function findScrollableParent(target: EventTarget | null) {
  try {
    let element = target instanceof Element ? target : null;
    while (element && element !== document.body) {
      const style = window.getComputedStyle(element);
      const overflowY = style.overflowY;
      const canScroll = (overflowY === "auto" || overflowY === "scroll") && element.scrollHeight > element.clientHeight;
      if (canScroll) return element as HTMLElement;
      element = element.parentElement;
    }
  } catch {
    return null;
  }
  return null;
}

function isInteractiveControl(target: EventTarget | null) {
  const element = target instanceof Element ? target : null;
  return Boolean(element?.closest("input, select, textarea, button, canvas, [role='slider']"));
}

async function fetchLatestBuildId() {
  try {
    const response = await fetch(`${getBasePath()}/sweet-daw-build.json?ts=${Date.now()}`, {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache",
      },
    });

    if (!response.ok) return null;
    const info = (await response.json()) as RemoteBuildInfo;
    return typeof info.buildId === "string" && info.buildId.length > 0 ? info.buildId : null;
  } catch {
    return null;
  }
}

async function clearRuntimeCaches() {
  const jobs: Array<Promise<unknown>> = [];

  if ("caches" in window && typeof caches.keys === "function") {
    jobs.push(
      caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))),
    );
  }

  if ("serviceWorker" in navigator && typeof navigator.serviceWorker.getRegistrations === "function") {
    jobs.push(
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister()))),
    );
  }

  await Promise.allSettled(jobs);
}

function getBasePath() {
  const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? (process.env.NEXT_PUBLIC_STATIC_EXPORT === "true" ? "/lando_hp/sdaw" : "");
  return rawBasePath.endsWith("/") ? rawBasePath.slice(0, -1) : rawBasePath;
}

function getSessionStorage(key: string) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function setSessionStorage(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable in private mode; cache cleanup can still proceed.
  }
}

function removeSessionStorage(key: string) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Storage may be unavailable in private mode.
  }
}

function canAttemptSessionRefresh(reason: string) {
  const key = `${REFRESH_ATTEMPT_PREFIX}${reason}`;
  const current = Number(getSessionStorage(key) ?? "0");
  if (!Number.isFinite(current) || current < 0) {
    setSessionStorage(key, "1");
    return true;
  }
  if (current >= MAX_REFRESH_ATTEMPTS_PER_SESSION) {
    return false;
  }
  setSessionStorage(key, String(current + 1));
  return true;
}

function setLocalStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable in private mode.
  }
}
