/**
 * Web Push subscription management (new-mail notifications while the app is closed)
 */
import { api } from "./api";

export type PushSupport = "supported" | "needs-install" | "unsupported";

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const hasApis = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (hasApis) return "supported";
  // iOS Safari only exposes push to home-screen apps
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return isIOS && !isStandalone() ? "needs-install" : "unsupported";
}

function urlBase64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const padded = (b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Non-blocking: `serviceWorker.ready` never settles if registration failed */
async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/**
 * Re-register this device's existing subscription with the backend. Subscriptions are
 * tied to a login session, so call this after signing in (e.g. on app start).
 */
export async function syncPushSubscription(): Promise<void> {
  if (pushSupport() !== "supported" || Notification.permission !== "granted") return;
  const sub = await currentSubscription();
  if (sub) await api.pushSubscribe(sub.toJSON());
}

export async function isPushEnabled(): Promise<boolean> {
  if (pushSupport() !== "supported" || Notification.permission !== "granted") return false;
  return (await currentSubscription()) !== null;
}

/** Ask permission, subscribe this device and register it with the backend */
export async function enablePush(): Promise<void> {
  if (pushSupport() !== "supported") throw new Error("Push is not supported on this device");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission denied");
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg?.active) throw new Error("Offline support isn't running yet; reload Hamba and try again");
  const { publicKey } = await api.getPushKey();
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(publicKey) }));
  await api.pushSubscribe(sub.toJSON());
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await api.pushUnsubscribe(endpoint);
}
