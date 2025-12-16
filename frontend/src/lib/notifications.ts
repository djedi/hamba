/**
 * Desktop notification service for new mail alerts
 */

// Read notification preferences from localStorage
function getNotificationSettings(): {
  enabled: boolean;
  importantOnly: boolean;
  soundEnabled: boolean;
} {
  if (typeof localStorage === "undefined") {
    return { enabled: false, importantOnly: false, soundEnabled: true };
  }
  return {
    enabled: localStorage.getItem("settings.notifications") === "true",
    importantOnly: localStorage.getItem("settings.notifyImportantOnly") === "true",
    soundEnabled: localStorage.getItem("settings.sound") !== "false",
  };
}

// AudioContext for generating notification sound
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof AudioContext === "undefined") {
    return null;
  }
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

// Reset audio context (for testing)
export function _resetAudioContext(): void {
  audioContext = null;
}

/**
 * Play a simple notification ding sound using Web Audio API
 */
export function playNotificationSound(): void {
  const settings = getNotificationSettings();
  if (!settings.soundEnabled) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    // Resume context if suspended (browser autoplay policy)
    if (ctx.state === "suspended") {
      ctx.resume();
    }

    // Create a pleasant notification "ding" sound
    const now = ctx.currentTime;
    const duration = 0.15;

    // First tone (higher pitch)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.type = "sine";
    osc1.frequency.value = 880; // A5
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + duration);
    osc1.start(now);
    osc1.stop(now + duration);

    // Second tone (slightly lower, delayed)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.type = "sine";
    osc2.frequency.value = 659.25; // E5
    gain2.gain.setValueAtTime(0, now);
    gain2.gain.setValueAtTime(0.25, now + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.08 + duration);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.08 + duration);
  } catch {
    // Audio not supported - ignore
  }
}

/**
 * Check if we should show notifications
 */
export function shouldNotify(isImportant: boolean = false): boolean {
  const settings = getNotificationSettings();

  if (!settings.enabled) return false;

  // Check browser permission
  if (typeof Notification === "undefined" || Notification.permission !== "granted") {
    return false;
  }

  // If important-only mode, only notify for important emails
  if (settings.importantOnly && !isImportant) {
    return false;
  }

  return true;
}

/**
 * Show a desktop notification for new mail
 */
export function showNewMailNotification(options: {
  from: string;
  subject: string;
  isImportant?: boolean;
  onClick?: () => void;
}): void {
  if (!shouldNotify(options.isImportant)) return;

  try {
    const notification = new Notification(options.from, {
      body: options.subject || "(no subject)",
      icon: "/favicon-96x96.png",
      tag: "new-mail", // Prevents duplicate notifications
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
      options.onClick?.();
    };

    // Auto-close after 5 seconds
    setTimeout(() => notification.close(), 5000);

    // Play sound
    playNotificationSound();
  } catch {
    // Notification API not available - ignore
  }
}

/**
 * Request notification permission from the user
 */
export async function requestPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") {
    return "denied";
  }
  return Notification.requestPermission();
}

/**
 * Check if notifications are supported and enabled
 */
export function getNotificationStatus(): {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  enabled: boolean;
} {
  if (typeof Notification === "undefined") {
    return { supported: false, permission: "unsupported", enabled: false };
  }

  const settings = getNotificationSettings();
  return {
    supported: true,
    permission: Notification.permission,
    enabled: settings.enabled && Notification.permission === "granted",
  };
}
