# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Styleum API is a TypeScript REST API for a wardrobe management and outfit generation app. Built with Hono web framework running on Node.js, using Supabase for database and authentication.

## Tech Stack

- **Runtime**: Node.js with `@hono/node-server`
- **Framework**: Hono
- **Database/Auth**: Supabase (PostgreSQL + Auth)
- **Language**: TypeScript (ES modules)
- **Deployment**: Railway

## Commands

```bash
npm run dev      # Start dev server with hot reload (tsx watch)
npm run build    # Compile TypeScript to dist/
npm start        # Run production build
```

## Project Structure

```
src/
├── index.ts              # App entry, middleware, route mounting
├── middleware/
│   ├── auth.ts           # JWT verification via Supabase
│   └── rateLimit.ts      # In-memory rate limiter with presets
├── routes/
│   ├── items.ts          # /api/items - wardrobe CRUD
│   ├── outfits.ts        # /api/outfits - generation, history
│   ├── gamification.ts   # /api/gamification - XP, streaks, achievements
│   ├── subscriptions.ts  # /api/subscriptions - Pro status, limits
│   └── webhooks.ts       # /webhooks - RevenueCat (no auth)
├── services/
│   └── supabase.ts       # Admin client, type definitions, helpers
└── utils/
    └── limits.ts         # Free/Pro tier limit checking
```

## API Routes

| Route | Auth | Description |
|-------|------|-------------|
| `GET /` | No | Health check |
| `GET /health` | No | Health check with timestamp |
| `/api/*` | Yes | All protected endpoints |
| `/webhooks/*` | No | External webhooks (signature verified) |

## Environment Variables

Required (see `.env.example`):
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_KEY` - Service role key (admin access)
- `REVENUECAT_WEBHOOK_SECRET` - For webhook signature verification

## Architecture Notes

- Auth middleware extracts Bearer token and verifies with `supabase.auth.getUser()`
- Rate limiter uses in-memory Map with automatic cleanup (not suitable for multi-instance)
- Item uploads create placeholder records with `category: 'processing'` (embedding happens async)
- Credit limits reset monthly; item limits only apply to free users
- Gamification XP/streak updates use Supabase RPC functions (`add_user_xp`, `increment_times_worn`)
