/* Workora service worker: shows desktop notifications for Web Push messages and opens the right page on click. */
const BASE = new URL('./', self.location).pathname; // "/workora/"

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const appWindows = () => self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => list.filter((c) => new URL(c.url).pathname.startsWith(BASE)));

function show(data) {
  return self.registration.showNotification(data.title || 'Workora', {
    body: [data.body, data.organization].filter(Boolean).join('\n'),
    tag: data.id,
    icon: `${BASE}icon-192.png`,
    badge: `${BASE}badge-72.png`,
    timestamp: Date.now(),
    data: { url: data.url || `${self.location.origin}${BASE}inbox` },
  });
}

self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Workora', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    appWindows().then((windows) => {
      // Workora in front already shows the notification as a toast and in the bell; don't double up.
      const inFront = windows.some((c) => c.focused && c.visibilityState === 'visible');
      if (inFront && data.category !== 'test') return undefined;
      return show(data);
    }),
  );
});

// Notifications the app shows itself (while a tab is open but in the background) come through here too.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'show') event.waitUntil(show(event.data.notification));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  event.waitUntil(
    appWindows().then((windows) => {
      const target = windows.find((c) => c.focused) || windows[0];
      if (target) {
        // An open tab navigates inside the app (no reload) and comes to the front.
        target.postMessage({ type: 'open', url });
        return target.focus();
      }
      return self.clients.openWindow(url || BASE);
    }),
  );
});
