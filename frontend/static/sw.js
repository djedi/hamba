/**
 * Service Worker for Hamba Email Client
 * Provides offline support with:
 * - Cache-first strategy for email data
 * - Offline action queue for mutations
 * - Background sync when coming back online
 */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `hamba-cache-${CACHE_VERSION}`;
const API_CACHE_NAME = `hamba-api-${CACHE_VERSION}`;

// Static assets to precache
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/favicon.ico',
  '/favicon-32x32.png',
  '/favicon-16x16.png',
];

// API endpoints that should be cached for offline reading
const CACHEABLE_API_PATTERNS = [
  /\/emails(\?|$)/,           // Email list
  /\/emails\/[^/]+$/,          // Single email
  /\/emails\/starred/,
  /\/emails\/sent/,
  /\/emails\/archived/,
  /\/emails\/snoozed/,
  /\/emails\/important/,
  /\/emails\/other/,
  /\/auth\/accounts$/,
  /\/labels(\?|$)/,
  /\/contacts/,
  /\/snippets/,
  /\/drafts/,
];

// API endpoints that are mutations (should be queued when offline)
const MUTATION_API_PATTERNS = [
  { pattern: /\/emails\/[^/]+\/star$/, method: 'POST' },
  { pattern: /\/emails\/[^/]+\/unstar$/, method: 'POST' },
  { pattern: /\/emails\/[^/]+\/read$/, method: 'POST' },
  { pattern: /\/emails\/[^/]+\/unread$/, method: 'POST' },
  { pattern: /\/emails\/[^/]+\/archive$/, method: 'POST' },
  { pattern: /\/emails\/[^/]+\/unarchive$/, method: 'POST' },
  { pattern: /\/emails\/[^/]+\/trash$/, method: 'POST' },
  { pattern: /\/emails\/[^/]+\/untrash$/, method: 'POST' },
  { pattern: /\/emails\/[^/]+\/snooze$/, method: 'POST' },
  { pattern: /\/emails\/[^/]+\/unsnooze$/, method: 'POST' },
  { pattern: /\/emails\/[^/]+\/reminder$/, method: 'POST' },
  { pattern: /\/emails\/[^/]+\/reminder$/, method: 'DELETE' },
  { pattern: /\/emails\/[^/]+\/important$/, method: 'POST' },
  { pattern: /\/emails\/[^/]+\/not-important$/, method: 'POST' },
  { pattern: /\/labels\/[^/]+\/emails\/[^/]+$/, method: 'POST' },
  { pattern: /\/labels\/[^/]+\/emails\/[^/]+$/, method: 'DELETE' },
];

// IndexedDB for offline action queue
const DB_NAME = 'hamba-offline';
const DB_VERSION = 1;
const QUEUE_STORE = 'action-queue';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
  });
}

async function addToQueue(action) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(QUEUE_STORE);
    const request = store.add({
      ...action,
      timestamp: Date.now(),
    });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getQueuedActions() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readonly');
    const store = tx.objectStore(QUEUE_STORE);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function removeFromQueue(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(QUEUE_STORE);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function clearQueue() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(QUEUE_STORE);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Check if a URL matches cacheable API patterns
function isCacheableApi(url) {
  const urlPath = new URL(url).pathname;
  return CACHEABLE_API_PATTERNS.some(pattern => pattern.test(urlPath));
}

// Check if a request is a mutation that should be queued
function isMutationRequest(request) {
  const urlPath = new URL(request.url).pathname;
  return MUTATION_API_PATTERNS.some(
    m => m.pattern.test(urlPath) && m.method === request.method
  );
}

// Install event - precache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(name => name.startsWith('hamba-') && name !== CACHE_NAME && name !== API_CACHE_NAME)
            .map(name => caches.delete(name))
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch event - handle caching and offline support
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Only handle same-origin and API requests
  if (url.origin !== self.location.origin && !url.pathname.startsWith('/')) {
    // Check if it's an API request (different origin for API)
    if (!url.href.includes('localhost:3001') && !url.href.includes('/api/')) {
      return;
    }
  }

  // Handle mutation requests (queue when offline)
  if (isMutationRequest(request)) {
    event.respondWith(handleMutation(request));
    return;
  }

  // Handle cacheable API requests
  if (isCacheableApi(request.url)) {
    event.respondWith(handleCacheableApi(request));
    return;
  }

  // Handle static assets with cache-first
  if (request.method === 'GET') {
    event.respondWith(
      caches.match(request)
        .then(cached => cached || fetch(request))
    );
  }
});

// Handle cacheable API requests with network-first, fallback to cache
async function handleCacheableApi(request) {
  const cache = await caches.open(API_CACHE_NAME);

  try {
    const response = await fetch(request);

    if (response.ok) {
      // Clone response before caching (response can only be read once)
      cache.put(request, response.clone());
    }

    return response;
  } catch (error) {
    // Network failed, try cache
    const cached = await cache.match(request);

    if (cached) {
      return cached;
    }

    // No cache, return offline error response
    return new Response(
      JSON.stringify({ error: 'Offline', offline: true }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

// Handle mutation requests - queue when offline
async function handleMutation(request) {
  try {
    const response = await fetch(request.clone());
    return response;
  } catch (error) {
    // Network failed, queue the action
    const body = await request.clone().text();

    await addToQueue({
      url: request.url,
      method: request.method,
      body: body || null,
      headers: Object.fromEntries(request.headers.entries()),
    });

    // Notify clients that action was queued
    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        client.postMessage({
          type: 'ACTION_QUEUED',
          url: request.url,
          method: request.method,
        });
      });
    });

    // Return success response (optimistic)
    return new Response(
      JSON.stringify({ success: true, queued: true }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

// Sync queued actions when back online
async function syncQueuedActions() {
  const actions = await getQueuedActions();
  const results = [];

  for (const action of actions) {
    try {
      const response = await fetch(action.url, {
        method: action.method,
        headers: action.headers,
        body: action.body,
        credentials: 'include',
      });

      if (response.ok) {
        await removeFromQueue(action.id);
        results.push({ id: action.id, success: true });
      } else {
        results.push({ id: action.id, success: false, error: response.status });
      }
    } catch (error) {
      results.push({ id: action.id, success: false, error: error.message });
    }
  }

  return results;
}

// Listen for sync event (when back online)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-actions') {
    event.waitUntil(
      syncQueuedActions().then(results => {
        // Notify clients of sync results
        self.clients.matchAll().then(clients => {
          clients.forEach(client => {
            client.postMessage({
              type: 'SYNC_COMPLETE',
              results,
            });
          });
        });
      })
    );
  }
});

// Listen for messages from clients
self.addEventListener('message', (event) => {
  if (event.data.type === 'SYNC_NOW') {
    syncQueuedActions().then(results => {
      event.source.postMessage({
        type: 'SYNC_COMPLETE',
        results,
      });
    });
  }

  if (event.data.type === 'GET_QUEUE_STATUS') {
    getQueuedActions().then(actions => {
      event.source.postMessage({
        type: 'QUEUE_STATUS',
        count: actions.length,
        actions: actions.map(a => ({ url: a.url, method: a.method, timestamp: a.timestamp })),
      });
    });
  }

  if (event.data.type === 'CLEAR_CACHE') {
    Promise.all([
      caches.delete(CACHE_NAME),
      caches.delete(API_CACHE_NAME),
    ]).then(() => {
      event.source.postMessage({ type: 'CACHE_CLEARED' });
    });
  }
});
