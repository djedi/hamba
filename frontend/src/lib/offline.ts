/**
 * Offline support module for Hamba Email Client
 * - Registers and manages the service worker
 * - Tracks online/offline status
 * - Handles sync when coming back online
 */

import { writable, get } from "svelte/store";

// Online/offline status
export const isOnline = writable(typeof navigator !== "undefined" ? navigator.onLine : true);
export const isServiceWorkerReady = writable(false);
export const pendingActionsCount = writable(0);

// Service worker registration
let swRegistration: ServiceWorkerRegistration | null = null;

type MessageHandler = (data: any) => void;
const messageHandlers = new Set<MessageHandler>();

/**
 * Register the service worker
 */
export async function registerServiceWorker(): Promise<boolean> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    console.log("[Offline] Service workers not supported");
    return false;
  }

  try {
    swRegistration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
    });

    console.log("[Offline] Service worker registered");

    // Wait for the service worker to be ready
    await navigator.serviceWorker.ready;
    isServiceWorkerReady.set(true);

    // Set up message listener
    navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);

    // Request initial queue status
    getQueueStatus();

    return true;
  } catch (error) {
    console.error("[Offline] Service worker registration failed:", error);
    return false;
  }
}

/**
 * Unregister the service worker
 */
export async function unregisterServiceWorker(): Promise<boolean> {
  if (swRegistration) {
    const result = await swRegistration.unregister();
    swRegistration = null;
    isServiceWorkerReady.set(false);
    return result;
  }
  return false;
}

/**
 * Handle messages from the service worker
 */
function handleServiceWorkerMessage(event: MessageEvent) {
  const data = event.data;

  switch (data.type) {
    case "ACTION_QUEUED":
      console.log("[Offline] Action queued:", data.url);
      pendingActionsCount.update((n) => n + 1);
      break;

    case "SYNC_COMPLETE":
      console.log("[Offline] Sync complete:", data.results);
      const successCount = data.results.filter((r: any) => r.success).length;
      pendingActionsCount.update((n) => Math.max(0, n - successCount));
      break;

    case "QUEUE_STATUS":
      pendingActionsCount.set(data.count);
      break;

    case "CACHE_CLEARED":
      console.log("[Offline] Cache cleared");
      break;
  }

  // Notify all handlers
  messageHandlers.forEach((handler) => handler(data));
}

/**
 * Subscribe to service worker messages
 */
export function onServiceWorkerMessage(handler: MessageHandler): () => void {
  messageHandlers.add(handler);
  return () => messageHandlers.delete(handler);
}

/**
 * Send a message to the service worker
 */
function sendToServiceWorker(message: any): void {
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage(message);
  }
}

/**
 * Request queue status from service worker
 */
export function getQueueStatus(): void {
  sendToServiceWorker({ type: "GET_QUEUE_STATUS" });
}

/**
 * Trigger sync of queued actions
 */
export async function syncNow(): Promise<void> {
  if (!get(isOnline)) {
    console.log("[Offline] Cannot sync while offline");
    return;
  }

  // Try to use Background Sync API if available
  if (swRegistration && "sync" in swRegistration) {
    try {
      await (swRegistration as any).sync.register("sync-actions");
      return;
    } catch (error) {
      console.log("[Offline] Background sync not available, using fallback");
    }
  }

  // Fallback: send message to service worker
  sendToServiceWorker({ type: "SYNC_NOW" });
}

/**
 * Clear all caches
 */
export function clearCache(): void {
  sendToServiceWorker({ type: "CLEAR_CACHE" });
}

/**
 * Initialize online/offline listeners
 */
export function initOnlineListener(): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleOnline = () => {
    console.log("[Offline] Back online");
    isOnline.set(true);
    // Trigger sync when back online
    syncNow();
  };

  const handleOffline = () => {
    console.log("[Offline] Gone offline");
    isOnline.set(false);
  };

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  // Set initial state
  isOnline.set(navigator.onLine);

  return () => {
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
  };
}

/**
 * Check if we have a pending action for a specific resource
 */
export function hasPendingAction(url: string): boolean {
  // This would require async communication with SW
  // For now, we just check the count
  return get(pendingActionsCount) > 0;
}
