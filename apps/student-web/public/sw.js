// Minimal service worker: makes the app installable. It deliberately caches NOTHING, so order and
// payment data is always live from the network and never served stale.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
