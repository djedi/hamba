/**
 * Date formatting utilities for email display.
 * Implements Superhuman-style relative dates: "2m ago", "1h ago", "Yesterday", "Dec 10"
 */

/**
 * Format timestamp for email list display (relative dates).
 * - < 1 minute: "Just now"
 * - < 60 minutes: "Xm ago"
 * - < 24 hours: "Xh ago"
 * - Yesterday: "Yesterday"
 * - This year: "Dec 10"
 * - Past years: "Dec 10, 2023"
 */
export function formatRelativeDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  // Less than 1 minute
  if (diffMinutes < 1) {
    return "Just now";
  }

  // Less than 1 hour
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  // Less than 24 hours (but check if it's actually today)
  const isToday = date.toDateString() === now.toDateString();
  if (isToday && diffHours < 24) {
    return `${diffHours}h ago`;
  }

  // Yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return "Yesterday";
  }

  // Same year: "Dec 10"
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  }

  // Different year: "Dec 10, 2023"
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Format timestamp for expanded thread header (short format).
 * Shows time for today, or short date otherwise.
 * - Today: "3:30 PM"
 * - Other days: "Dec 10"
 */
export function formatDateShort(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Format timestamp for expanded email view (full readable date).
 * Example: "Mon, Dec 15 at 3:30 PM"
 */
export function formatDateMedium(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Format timestamp for full date display (used in email detail view).
 * Example: "Monday, December 15, 2024 at 3:30 PM"
 */
export function formatDateFull(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Format timestamp for tooltip display (ISO-style with full detail).
 * Example: "Sunday, December 15, 2024 at 3:30 PM"
 */
export function formatDateTooltip(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}
