import { create } from 'zustand';
import { config } from '@/config';
import { api } from '@/services/api/client';
import type { Notification } from '@/types';

const BASE = import.meta.env.BASE_URL; // "/workora/"
const PREF = 'workora.desktop';

/**
 * How this browser delivers desktop notifications:
 * - `push`: Web Push subscription, works even when every Workora tab is closed;
 * - `tab`: permission granted but push unavailable, so the open app shows them while in the background;
 * - `off` / `blocked` / `unsupported`.
 */
export type DesktopMode = 'push' | 'tab' | 'off' | 'blocked' | 'unsupported';

interface DesktopState {
  mode: DesktopMode;
  busy: boolean;
  set: (s: Partial<Omit<DesktopState, 'set'>>) => void;
}

const supported = () => typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && window.isSecureContext;

const readPref = () => {
  try {
    return localStorage.getItem(PREF);
  } catch {
    return null;
  }
};
const writePref = (v: string | null) => {
  try {
    if (v) localStorage.setItem(PREF, v);
    else localStorage.removeItem(PREF);
  } catch {
    /* private mode: the browser permission still applies */
  }
};

function initialMode(): DesktopMode {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  const pref = readPref();
  return pref === 'push' || pref === 'tab' ? pref : 'off';
}

export const useDesktop = create<DesktopState>((set) => ({ mode: initialMode(), busy: false, set }));

let registration: Promise<ServiceWorkerRegistration> | null = null;
const worker = () => (registration ??= navigator.serviceWorker.register(`${BASE}sw.js`, { scope: BASE }).then(() => navigator.serviceWorker.ready));

const b64ToBytes = (s: string) => {
  const raw = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** "Chrome on macOS", so people can recognise their browsers in Settings. */
export function deviceName(ua = navigator.userAgent) {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : 'unknown OS';
  return `${browser} on ${os}`;
}

/** Subscribes this browser to Web Push and tells the server. Returns false when push isn't available. */
async function subscribePush(): Promise<boolean> {
  try {
    const reg = await worker();
    if (!('pushManager' in reg)) return false;
    const { publicKey } = await api.get<{ publicKey: string }>('/notifications/push');
    let sub = await reg.pushManager.getSubscription();
    // A subscription made with another server key can't receive our messages.
    const key = sub?.options.applicationServerKey;
    if (sub && key && btoa(String.fromCharCode(...new Uint8Array(key))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== publicKey) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    await api.post('/notifications/push/subscriptions', { endpoint: json.endpoint, keys: json.keys, device: deviceName() });
    return true;
  } catch {
    return false;
  }
}

/** Asks for permission (must run from a click) and turns desktop notifications on for this browser. */
export async function enableDesktop(): Promise<DesktopMode> {
  const { set } = useDesktop.getState();
  if (!supported()) return 'unsupported';
  set({ busy: true });
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      const mode = permission === 'denied' ? 'blocked' : 'off';
      set({ mode });
      return mode;
    }
    await worker().catch(() => undefined);
    const mode: DesktopMode = (await subscribePush()) ? 'push' : 'tab';
    writePref(mode);
    set({ mode });
    return mode;
  } finally {
    set({ busy: false });
  }
}

export async function disableDesktop() {
  const { set } = useDesktop.getState();
  set({ busy: true });
  try {
    const reg = await navigator.serviceWorker.getRegistration(BASE);
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) {
      await api.raw('DELETE', '/notifications/push/subscriptions', { body: { endpoint: sub.endpoint } }).catch(() => undefined);
      await sub.unsubscribe().catch(() => undefined);
    }
    writePref('off');
    set({ mode: Notification.permission === 'denied' ? 'blocked' : 'off' });
  } finally {
    set({ busy: false });
  }
}

/**
 * On sign-out: the server forgets this browser for this person (it stays subscribed and turned on locally;
 * the next sign-in re-registers it). Takes the token up front because the session is cleared right after.
 */
export async function detachDesktop(token: string | undefined) {
  if (!token || !supported()) return;
  const reg = await navigator.serviceWorker.getRegistration(BASE).catch(() => undefined);
  const sub = await reg?.pushManager?.getSubscription().catch(() => null);
  if (!sub) return;
  await fetch(`${config.apiBase}/notifications/push/subscriptions`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint }),
    keepalive: true,
  }).catch(() => undefined);
}

/**
 * After sign-in: re-register this browser's subscription for whoever is signed in now (a shared
 * computer moves to the new person), and pick up permission changes made in browser settings.
 */
export async function syncDesktop() {
  const { set } = useDesktop.getState();
  const mode = initialMode();
  if (mode === 'push' || mode === 'tab') {
    await worker().catch(() => undefined);
    const next: DesktopMode = (await subscribePush()) ? 'push' : 'tab';
    writePref(next);
    set({ mode: next });
  } else set({ mode });
}

/** Opens a path inside the app when a desktop notification is clicked while a tab is open. */
export function listenForClicks(open: (path: string) => void) {
  if (!supported()) return () => undefined;
  const onMessage = (e: MessageEvent) => {
    if (e.data?.type !== 'open' || typeof e.data.url !== 'string') return;
    const url = new URL(e.data.url, location.origin);
    if (url.origin !== location.origin || !url.pathname.startsWith(BASE)) return;
    open(`/${url.pathname.slice(BASE.length)}${url.search}`);
  };
  navigator.serviceWorker.addEventListener('message', onMessage);
  return () => navigator.serviceWorker.removeEventListener('message', onMessage);
}

/** True when the person can't see the app right now (another tab, another app, minimised). */
export const appInBackground = () => document.visibilityState === 'hidden' || !document.hasFocus();

/** In-tab fallback: the open app shows the notification itself when push isn't available here. */
export async function showFromTab(n: Notification, url: string) {
  if (useDesktop.getState().mode !== 'tab' || Notification.permission !== 'granted' || !appInBackground()) return false;
  const reg = await worker().catch(() => null);
  const data = { id: n.id, title: n.title, body: n.body, url: new URL(url, location.origin).href, category: n.category };
  if (reg?.active) reg.active.postMessage({ type: 'show', notification: data });
  else new window.Notification(n.title, { body: n.body, tag: n.id });
  return true;
}

/** The in-app path a notification opens: its link, the task, or the Inbox. */
export const notificationPath = (n: Pick<Notification, 'link' | 'taskKey'>) => n.link ?? (n.taskKey ? `/projects/${n.taskKey.split('-')[0]}/board?task=${n.taskKey}` : '/inbox');

/** "Send test" in tab mode: shows one right away, whether or not the app is in front. */
export async function showTestFromTab() {
  const reg = await worker();
  await reg.showNotification('Desktop notifications work', {
    body: 'This is how Workora reaches you when you are in another tab or app.',
    tag: 'test',
    icon: `${BASE}icon-192.png`,
    badge: `${BASE}badge-72.png`,
    data: { url: `${location.origin}${BASE}settings` },
  });
}
