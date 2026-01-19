/**
 * Status Card Generator Service
 * Generates 1080x1920 Instagram Story cards for social sharing
 */

import sharp from "sharp";
import { supabaseAdmin } from "./supabase.js";

// Tier styling constants
const TIER_EMOJI: Record<string, string> = {
  rookie: "🌱",
  seeker: "🔍",
  builder: "🔨",
  maven: "⭐",
  icon: "💎",
  legend: "👑",
};

const TIER_COLOR: Record<string, string> = {
  rookie: "#C0C0C0",
  seeker: "#C0C0C0",
  builder: "#C0C0C0",
  maven: "#FFD700",
  icon: "#E5E4E2",
  legend: "#FF6B6B",
};

// Card dimensions
const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1920;

// Colors
const CORAL = "#FF6B6B";
const WHITE = "#FFFFFF";
const MUTED = "#666666";

export interface StatusCardData {
  username: string;
  tier: string;
  rank?: number | null;
  school_name?: string | null;
  streak: number;
  weekly_votes: number;
  outfit_photo_url?: string | null;
}

/**
 * Generate the gradient background SVG
 */
function buildGradientSVG(): string {
  return `
    <svg width="${CARD_WIDTH}" height="${CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:#0A0A0A"/>
          <stop offset="100%" style="stop-color:#1A1A1A"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)"/>
    </svg>
  `;
}

/**
 * Fetch and process the outfit photo
 * Resizes to 800x1000 with rounded corners
 */
async function processOutfitPhoto(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[StatusCard] Failed to fetch photo: ${response.status}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    // Create rounded rectangle mask
    const width = 800;
    const height = 1000;
    const radius = 24;

    const roundedMask = Buffer.from(`
      <svg width="${width}" height="${height}">
        <rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="white"/>
      </svg>
    `);

    // Resize and apply rounded corners
    const processedImage = await sharp(imageBuffer)
      .resize(width, height, {
        fit: "cover",
        position: "center",
      })
      .composite([
        {
          input: roundedMask,
          blend: "dest-in",
        },
      ])
      .png()
      .toBuffer();

    return processedImage;
  } catch (error) {
    console.warn("[StatusCard] Error processing photo:", error);
    return null;
  }
}

/**
 * Create a placeholder for when no photo is available
 */
function buildPhotoPlaceholder(): string {
  const width = 800;
  const height = 1000;
  const radius = 24;

  return `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="#2A2A2A"/>
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"
            font-family="Arial, sans-serif" font-size="32" fill="#666666">
        No Photo
      </text>
    </svg>
  `;
}

/**
 * Build the text overlay SVG with all card elements
 */
function buildOverlaySVG(data: StatusCardData): string {
  const tierEmoji = TIER_EMOJI[data.tier] || "🌱";
  const tierColor = TIER_COLOR[data.tier] || "#C0C0C0";

  // Build rank badge if rank exists
  let rankBadge = "";
  if (data.rank && data.rank > 0) {
    const rankText = `#${data.rank}`;
    const badgeWidth = 80 + (rankText.length > 2 ? (rankText.length - 2) * 12 : 0);
    rankBadge = `
      <g transform="translate(${CARD_WIDTH - badgeWidth - 40}, 40)">
        <rect x="0" y="0" width="${badgeWidth}" height="40" rx="20" ry="20" fill="${CORAL}"/>
        <text x="${badgeWidth / 2}" y="26" text-anchor="middle"
              font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="${WHITE}">
          ${rankText}
        </text>
      </g>
    `;
  }

  // Stats row
  const statsText = `🔥 ${data.streak} · ${data.weekly_votes} votes this week`;

  // School name (if provided)
  let schoolElement = "";
  if (data.school_name) {
    schoolElement = `
      <text x="${CARD_WIDTH / 2}" y="1460" text-anchor="middle"
            font-family="Arial, sans-serif" font-size="28" fill="${CORAL}">
        ${escapeXml(data.school_name)}
      </text>
    `;
  }

  // Tier emoji badge (positioned at bottom-right of photo area)
  const tierBadge = `
    <g transform="translate(${CARD_WIDTH / 2 + 400 - 50}, 1150)">
      <circle cx="40" cy="40" r="40" fill="${tierColor}"/>
      <text x="40" y="52" text-anchor="middle" font-size="40">${tierEmoji}</text>
    </g>
  `;

  return `
    <svg width="${CARD_WIDTH}" height="${CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <!-- VOUCH wordmark - top left -->
      <text x="40" y="70" font-family="Arial, sans-serif" font-size="32" font-weight="bold" fill="${CORAL}">
        VOUCH
      </text>

      ${rankBadge}

      ${tierBadge}

      <!-- Username -->
      <text x="${CARD_WIDTH / 2}" y="1330" text-anchor="middle"
            font-family="Arial, sans-serif" font-size="48" font-weight="bold" fill="${WHITE}">
        @${escapeXml(data.username)}
      </text>

      <!-- Stats row -->
      <text x="${CARD_WIDTH / 2}" y="1400" text-anchor="middle"
            font-family="Arial, sans-serif" font-size="28" fill="${MUTED}">
        ${statsText}
      </text>

      ${schoolElement}

      <!-- QR placeholder -->
      <rect x="${(CARD_WIDTH - 200) / 2}" y="1560" width="200" height="200" rx="16" ry="16" fill="${WHITE}"/>

      <!-- Footer -->
      <text x="${CARD_WIDTH / 2}" y="1860" text-anchor="middle"
            font-family="Arial, sans-serif" font-size="24" fill="${MUTED}">
        vouch.social
      </text>
    </svg>
  `;
}

/**
 * Escape XML special characters
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Sanitize username for use in storage path
 */
function sanitizeUsername(username: string): string {
  return username.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
}

/**
 * Upload the generated card to Supabase Storage
 */
async function uploadToStorage(
  buffer: Buffer,
  username: string
): Promise<string> {
  const sanitizedUsername = sanitizeUsername(username);
  const timestamp = Date.now();
  const path = `status-cards/${sanitizedUsername}-${timestamp}.png`;

  const { data, error } = await supabaseAdmin.storage
    .from("public")
    .upload(path, buffer, {
      contentType: "image/png",
      cacheControl: "3600",
      upsert: false,
    });

  if (error) {
    console.error("[StatusCard] Storage upload error:", error);
    throw new Error(`Failed to upload status card: ${error.message}`);
  }

  // Get public URL
  const {
    data: { publicUrl },
  } = supabaseAdmin.storage.from("public").getPublicUrl(data.path);

  return publicUrl;
}

/**
 * Generate a status card image and upload to storage
 * @param data - Card data including username, tier, stats, etc.
 * @returns Public URL of the generated card
 */
export async function generateStatusCard(
  data: StatusCardData
): Promise<string> {
  console.log(`[StatusCard] Generating card for @${data.username}`);

  // Step 1: Create gradient background
  const gradientSVG = buildGradientSVG();
  const gradientBuffer = await sharp(Buffer.from(gradientSVG)).png().toBuffer();

  // Step 2: Process outfit photo or create placeholder
  let photoBuffer: Buffer;
  if (data.outfit_photo_url) {
    const processed = await processOutfitPhoto(data.outfit_photo_url);
    if (processed) {
      photoBuffer = processed;
    } else {
      // Fallback to placeholder if photo fetch failed
      const placeholderSVG = buildPhotoPlaceholder();
      photoBuffer = await sharp(Buffer.from(placeholderSVG)).png().toBuffer();
    }
  } else {
    const placeholderSVG = buildPhotoPlaceholder();
    photoBuffer = await sharp(Buffer.from(placeholderSVG)).png().toBuffer();
  }

  // Step 3: Build text overlay
  const overlaySVG = buildOverlaySVG(data);
  const overlayBuffer = await sharp(Buffer.from(overlaySVG)).png().toBuffer();

  // Step 4: Composite all layers
  // Photo is centered horizontally: (1080 - 800) / 2 = 140
  // Photo starts at Y=250
  const finalImage = await sharp(gradientBuffer)
    .composite([
      {
        input: photoBuffer,
        left: 140,
        top: 250,
      },
      {
        input: overlayBuffer,
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toBuffer();

  // Step 5: Upload to storage
  const publicUrl = await uploadToStorage(finalImage, data.username);

  console.log(`[StatusCard] Generated card: ${publicUrl}`);
  return publicUrl;
}
