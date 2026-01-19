/**
 * Vote Rate Limiting Middleware
 * Prevents spam and abuse in the voting system
 */

import type { Context } from "hono";

// ============================================================================
// Constants
// ============================================================================

const DAILY_VOTE_LIMIT = 100; // Max votes per user per day
const TARGET_VOTE_LIMIT = 5; // Max votes per user on same person's outfits per day
const VOTE_COOLDOWN_MS = 1000; // 1 second between votes
const DAILY_NOTIFICATION_LIMIT = 5; // Max notifications per recipient per day
const NOTIFICATION_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between notifications to same recipient

const DAY_MS = 24 * 60 * 60 * 1000;

// ============================================================================
// Types
// ============================================================================

interface CountEntry {
  count: number;
  resetAt: number;
}

interface NotificationEntry {
  count: number;
  resetAt: number;
  lastNotifiedAt: number;
}

export class VoteRateLimitError extends Error {
  public readonly retryAfter: number;
  public readonly code: string;

  constructor(message: string, retryAfter: number, code: string) {
    super(message);
    this.name = "VoteRateLimitError";
    this.retryAfter = retryAfter;
    this.code = code;
  }
}

// ============================================================================
// In-Memory Stores
// ============================================================================

// Key: `userId` -> daily vote count
const dailyVotes = new Map<string, CountEntry>();

// Key: `voterId:targetUserId` -> targeted vote count
const targetedVotes = new Map<string, CountEntry>();

// Key: `userId` -> timestamp of last vote
const lastVoteTime = new Map<string, number>();

// Key: `recipientId` -> notification tracking
const notifications = new Map<string, NotificationEntry>();

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Remove expired entries from all stores
 */
export function cleanupExpired(): void {
  const now = Date.now();

  for (const [key, entry] of dailyVotes.entries()) {
    if (entry.resetAt < now) {
      dailyVotes.delete(key);
    }
  }

  for (const [key, entry] of targetedVotes.entries()) {
    if (entry.resetAt < now) {
      targetedVotes.delete(key);
    }
  }

  for (const [key, entry] of notifications.entries()) {
    if (entry.resetAt < now) {
      notifications.delete(key);
    }
  }

  // Clean lastVoteTime entries older than cooldown (they're no longer relevant)
  for (const [key, timestamp] of lastVoteTime.entries()) {
    if (now - timestamp > VOTE_COOLDOWN_MS) {
      lastVoteTime.delete(key);
    }
  }
}

// Run cleanup every 60 seconds
setInterval(cleanupExpired, 60000);

// ============================================================================
// Vote Rate Limiting Functions
// ============================================================================

/**
 * Check if a vote is allowed based on rate limits
 * @throws VoteRateLimitError if rate limit exceeded
 */
export function checkVoteAllowed(voterId: string, targetUserId: string): void {
  const now = Date.now();
  const resetAt = now + DAY_MS;

  // Check 1-second cooldown
  const lastVote = lastVoteTime.get(voterId);
  if (lastVote && now - lastVote < VOTE_COOLDOWN_MS) {
    const retryAfter = Math.ceil((VOTE_COOLDOWN_MS - (now - lastVote)) / 1000);
    throw new VoteRateLimitError(
      "Please wait before voting again",
      retryAfter,
      "vote_cooldown"
    );
  }

  // Check daily limit (100 votes per day)
  let dailyEntry = dailyVotes.get(voterId);
  if (!dailyEntry || dailyEntry.resetAt < now) {
    dailyEntry = { count: 0, resetAt };
  }
  if (dailyEntry.count >= DAILY_VOTE_LIMIT) {
    const retryAfter = Math.ceil((dailyEntry.resetAt - now) / 1000);
    throw new VoteRateLimitError(
      "Too many votes today",
      retryAfter,
      "daily_limit"
    );
  }

  // Check target limit (5 votes per user on same person's outfits per day)
  const targetKey = `${voterId}:${targetUserId}`;
  let targetEntry = targetedVotes.get(targetKey);
  if (!targetEntry || targetEntry.resetAt < now) {
    targetEntry = { count: 0, resetAt };
  }
  if (targetEntry.count >= TARGET_VOTE_LIMIT) {
    const retryAfter = Math.ceil((targetEntry.resetAt - now) / 1000);
    throw new VoteRateLimitError(
      "Too many votes for this user",
      retryAfter,
      "target_limit"
    );
  }
}

/**
 * Record a successful vote (call after vote is persisted)
 */
export function recordVote(voterId: string, targetUserId: string): void {
  const now = Date.now();
  const resetAt = now + DAY_MS;

  // Update last vote time
  lastVoteTime.set(voterId, now);

  // Increment daily count
  let dailyEntry = dailyVotes.get(voterId);
  if (!dailyEntry || dailyEntry.resetAt < now) {
    dailyEntry = { count: 0, resetAt };
  }
  dailyEntry.count++;
  dailyVotes.set(voterId, dailyEntry);

  // Increment targeted count
  const targetKey = `${voterId}:${targetUserId}`;
  let targetEntry = targetedVotes.get(targetKey);
  if (!targetEntry || targetEntry.resetAt < now) {
    targetEntry = { count: 0, resetAt };
  }
  targetEntry.count++;
  targetedVotes.set(targetKey, targetEntry);
}

// ============================================================================
// Notification Rate Limiting Functions
// ============================================================================

/**
 * Check if a notification should be sent to a recipient
 * @returns true if notification should be sent, false if rate limited
 */
export function shouldNotify(recipientId: string): boolean {
  const now = Date.now();

  const entry = notifications.get(recipientId);
  if (!entry || entry.resetAt < now) {
    // Reset for new day
    return true;
  }

  // Check daily limit
  if (entry.count >= DAILY_NOTIFICATION_LIMIT) {
    return false;
  }

  // Check 5-minute cooldown
  if (now - entry.lastNotifiedAt < NOTIFICATION_COOLDOWN_MS) {
    return false;
  }

  return true;
}

/**
 * Record a sent notification
 */
export function recordNotification(recipientId: string): void {
  const now = Date.now();
  const resetAt = now + DAY_MS;

  let entry = notifications.get(recipientId);
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt, lastNotifiedAt: 0 };
  }

  entry.count++;
  entry.lastNotifiedAt = now;
  notifications.set(recipientId, entry);
}

// ============================================================================
// Helper Functions for Route Integration
// ============================================================================

/**
 * Get rate limit info for response headers
 */
export function getVoteRateLimitInfo(voterId: string): {
  limit: number;
  remaining: number;
  resetSeconds: number;
} {
  const now = Date.now();
  const dailyEntry = dailyVotes.get(voterId);
  const remaining = dailyEntry
    ? Math.max(0, DAILY_VOTE_LIMIT - dailyEntry.count)
    : DAILY_VOTE_LIMIT;
  const resetSeconds = dailyEntry
    ? Math.ceil((dailyEntry.resetAt - now) / 1000)
    : Math.ceil(DAY_MS / 1000);

  return {
    limit: DAILY_VOTE_LIMIT,
    remaining,
    resetSeconds,
  };
}

/**
 * Set rate limit headers on context
 */
export function setVoteRateLimitHeaders(
  c: Context,
  voterId: string
): void {
  const info = getVoteRateLimitInfo(voterId);
  c.header("X-RateLimit-Limit", info.limit.toString());
  c.header("X-RateLimit-Remaining", info.remaining.toString());
  c.header("X-RateLimit-Reset", info.resetSeconds.toString());
}

// ============================================================================
// Exports for testing
// ============================================================================

export function _getStoreStats() {
  return {
    dailyVotes: dailyVotes.size,
    targetedVotes: targetedVotes.size,
    lastVoteTime: lastVoteTime.size,
    notifications: notifications.size,
  };
}

export function _clearStores() {
  dailyVotes.clear();
  targetedVotes.clear();
  lastVoteTime.clear();
  notifications.clear();
}
