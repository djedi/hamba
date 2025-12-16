import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { get } from 'svelte/store';

// Mock navigator.serviceWorker before importing the module
const mockServiceWorkerRegistration = {
  unregister: vi.fn().mockResolvedValue(true),
  sync: {
    register: vi.fn().mockResolvedValue(undefined),
  },
};

const mockServiceWorker = {
  register: vi.fn().mockResolvedValue(mockServiceWorkerRegistration),
  ready: Promise.resolve(mockServiceWorkerRegistration),
  controller: {
    postMessage: vi.fn(),
  },
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

// Set up navigator.serviceWorker mock before imports
vi.stubGlobal('navigator', {
  ...navigator,
  serviceWorker: mockServiceWorker,
  onLine: true,
});

// Import after mocking
import {
  isOnline,
  isServiceWorkerReady,
  pendingActionsCount,
  registerServiceWorker,
  unregisterServiceWorker,
  initOnlineListener,
  syncNow,
  clearCache,
  getQueueStatus,
  onServiceWorkerMessage,
} from './offline';

describe('offline module', () => {
  beforeEach(() => {
    // Reset stores
    isOnline.set(true);
    isServiceWorkerReady.set(false);
    pendingActionsCount.set(0);

    // Clear mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isOnline store', () => {
    it('defaults to true when navigator is online', () => {
      expect(get(isOnline)).toBe(true);
    });

    it('can be set to false', () => {
      isOnline.set(false);
      expect(get(isOnline)).toBe(false);
    });
  });

  describe('pendingActionsCount store', () => {
    it('defaults to 0', () => {
      expect(get(pendingActionsCount)).toBe(0);
    });

    it('can be incremented', () => {
      pendingActionsCount.update((n) => n + 1);
      expect(get(pendingActionsCount)).toBe(1);
    });

    it('can be decremented but not below 0', () => {
      pendingActionsCount.set(2);
      pendingActionsCount.update((n) => Math.max(0, n - 3));
      expect(get(pendingActionsCount)).toBe(0);
    });
  });

  describe('registerServiceWorker', () => {
    it('registers the service worker', async () => {
      const result = await registerServiceWorker();

      expect(result).toBe(true);
      expect(mockServiceWorker.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
      expect(get(isServiceWorkerReady)).toBe(true);
    });

    it('adds message event listener', async () => {
      await registerServiceWorker();

      expect(mockServiceWorker.addEventListener).toHaveBeenCalledWith(
        'message',
        expect.any(Function)
      );
    });
  });

  describe('unregisterServiceWorker', () => {
    it('unregisters the service worker', async () => {
      await registerServiceWorker();
      const result = await unregisterServiceWorker();

      expect(result).toBe(true);
      expect(mockServiceWorkerRegistration.unregister).toHaveBeenCalled();
      expect(get(isServiceWorkerReady)).toBe(false);
    });

    it('returns false if no registration exists', async () => {
      const result = await unregisterServiceWorker();
      expect(result).toBe(false);
    });
  });

  describe('initOnlineListener', () => {
    it('adds online and offline event listeners', () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener');

      const cleanup = initOnlineListener();

      expect(addEventListenerSpy).toHaveBeenCalledWith('online', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('offline', expect.any(Function));

      cleanup();
    });

    it('returns a cleanup function that removes listeners', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

      const cleanup = initOnlineListener();
      cleanup();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('online', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('offline', expect.any(Function));
    });

    it('updates isOnline store when online event fires', () => {
      isOnline.set(false);
      initOnlineListener();

      // Simulate online event
      window.dispatchEvent(new Event('online'));

      expect(get(isOnline)).toBe(true);
    });

    it('updates isOnline store when offline event fires', () => {
      isOnline.set(true);
      initOnlineListener();

      // Simulate offline event
      window.dispatchEvent(new Event('offline'));

      expect(get(isOnline)).toBe(false);
    });
  });

  describe('syncNow', () => {
    it('does not sync when offline', async () => {
      isOnline.set(false);
      await registerServiceWorker();

      await syncNow();

      expect(mockServiceWorkerRegistration.sync.register).not.toHaveBeenCalled();
    });

    it('uses Background Sync API when available', async () => {
      isOnline.set(true);
      await registerServiceWorker();

      await syncNow();

      expect(mockServiceWorkerRegistration.sync.register).toHaveBeenCalledWith('sync-actions');
    });
  });

  describe('getQueueStatus', () => {
    it('sends GET_QUEUE_STATUS message to service worker', async () => {
      await registerServiceWorker();
      getQueueStatus();

      expect(mockServiceWorker.controller.postMessage).toHaveBeenCalledWith({
        type: 'GET_QUEUE_STATUS',
      });
    });
  });

  describe('clearCache', () => {
    it('sends CLEAR_CACHE message to service worker', async () => {
      await registerServiceWorker();
      clearCache();

      expect(mockServiceWorker.controller.postMessage).toHaveBeenCalledWith({
        type: 'CLEAR_CACHE',
      });
    });
  });

  describe('onServiceWorkerMessage', () => {
    it('subscribes to messages and returns cleanup function', () => {
      const handler = vi.fn();
      const cleanup = onServiceWorkerMessage(handler);

      expect(typeof cleanup).toBe('function');

      cleanup();
    });
  });
});
