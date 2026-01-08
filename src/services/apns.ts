/**
 * Apple Push Notification Service (APNs) Integration
 * Uses HTTP/2 based APNs provider API with JWT authentication
 */

import { SignJWT, importPKCS8 } from "jose";

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

interface APNsConfig {
  keyId: string;
  teamId: string;
  key: string;
  bundleId: string;
}

// Cache JWT token (valid for 1 hour, we refresh at 55 min)
let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Send a push notification via APNs
 * @param deviceToken - The APNs device token from the iOS app
 * @param payload - Notification content
 * @returns true if successful, false otherwise
 */
export async function sendPushNotification(
  deviceToken: string,
  payload: PushPayload
): Promise<boolean> {
  const config = getAPNsConfig();

  if (!config) {
    console.error("[APNs] Missing required environment variables");
    return false;
  }

  const token = await getAPNsJWT(config);
  const isProduction = process.env.NODE_ENV === "production";
  const apnsHost = isProduction
    ? "api.push.apple.com"
    : "api.sandbox.push.apple.com";

  try {
    const response = await fetch(
      `https://${apnsHost}/3/device/${deviceToken}`,
      {
        method: "POST",
        headers: {
          authorization: `bearer ${token}`,
          "apns-topic": config.bundleId,
          "apns-push-type": "alert",
          "apns-priority": "10",
          "apns-expiration": "0", // Immediate delivery only
        },
        body: JSON.stringify({
          aps: {
            alert: {
              title: payload.title,
              body: payload.body,
            },
            sound: "default",
            badge: 1,
          },
          ...(payload.data || {}),
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[APNs] Error ${response.status}: ${errorText} (token: ${deviceToken.slice(0, 8)}...)`
      );

      // Handle specific APNs errors
      if (response.status === 410) {
        // Device token is no longer valid - should remove from DB
        console.log(`[APNs] Token expired/invalid, should be removed`);
      }

      return false;
    }

    return true;
  } catch (error) {
    console.error("[APNs] Network error:", error);
    return false;
  }
}

/**
 * Get APNs configuration from environment variables
 */
function getAPNsConfig(): APNsConfig | null {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const key = process.env.APNS_KEY;
  const bundleId = process.env.APNS_BUNDLE_ID;

  if (!keyId || !teamId || !key || !bundleId) {
    return null;
  }

  return { keyId, teamId, key, bundleId };
}

/**
 * Generate a JWT for APNs authentication
 * Tokens are cached and reused until near expiration
 */
async function getAPNsJWT(config: APNsConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  // Return cached token if still valid (with 5 min buffer)
  if (cachedToken && cachedToken.expiresAt > now + 300) {
    return cachedToken.token;
  }

  // Decode the base64-encoded key and import it
  const keyPem = Buffer.from(config.key, "base64").toString("utf8");
  const privateKey = await importPKCS8(keyPem, "ES256");

  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: config.keyId })
    .setIssuer(config.teamId)
    .setIssuedAt(now)
    .sign(privateKey);

  // Cache for 1 hour (APNs tokens valid for 1 hour)
  cachedToken = { token, expiresAt: now + 3600 };

  return token;
}

/**
 * Validate that APNs is properly configured
 */
export function isAPNsConfigured(): boolean {
  return getAPNsConfig() !== null;
}
