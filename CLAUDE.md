# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Styleum API is a TypeScript REST API for a wardrobe management and outfit generation app. Built with Hono web framework running on Node.js, using Supabase for database and authentication.

## Tech Stack

- **Runtime**: Node.js with `@hono/node-server`
- **Framework**: Hono
- **Database/Auth**: Supabase (PostgreSQL + Auth + pgvector)
- **AI Infrastructure**: RunPod serverless endpoints
- **Language**: TypeScript (ES modules)
- **Deployment**: Railway

## Commands

```bash
npm run dev      # Start dev server with hot reload (tsx watch)
npm run build    # Compile TypeScript to dist/
npm start        # Run production build
```

## Environment Variables

Required:
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_KEY` - Service role key (admin access)
- `RUNPOD_API_KEY` - RunPod API key for AI models
- `REVENUECAT_WEBHOOK_SECRET` - For webhook signature verification

## API Routes

| Route | Auth | Description |
|-------|------|-------------|
| `GET /`, `GET /health` | No | Health checks |
| `/api/*` | Yes | Protected endpoints (Bearer token) |
| `/webhooks/*` | No | External webhooks (signature verified) |

## Architecture

### Item Processing Pipeline

When a user uploads a wardrobe item (`POST /api/items`), processing happens asynchronously:

1. **Upload**: Item created with `processing_status: 'processing'`
2. **Background removal**: BiRefNet via RunPod removes image background
3. **Vision analysis**: Florence-2 extracts visual features and colors
4. **Embedding**: FashionSigLIP generates 768-dim embedding (halfvec)
5. **Tagging**: Gemini reasons about category, occasions, seasons, formality
6. **Complete**: Item updated with all metadata, status → `completed`

AI services are in `src/services/ai/`:
- `runpod.ts` - Generic RunPod caller with polling and exponential backoff
- `backgroundRemoval.ts` - BiRefNet endpoint
- `visionAnalysis.ts` - Florence-2 endpoint
- `embeddings.ts` - FashionSigLIP endpoint
- `itemTagging.ts` - Gemini for reasoning/tagging

### Taste Vector System

Users complete onboarding by swiping through style reference images. The taste vector (`src/services/tasteVector.ts`):
- Initialized from liked/disliked image embeddings
- Updated via EMA on outfit interactions (wear, save, like, skip, reject)
- Used to personalize outfit generation with cosine similarity scoring

Interaction weights: wear=1.0, save=0.7, like=0.5, skip=-0.2, reject=-0.5

### Outfit Generation

`src/services/outfitGenerator.ts` combines:
- Seasonal filtering based on weather API data
- Color harmony scoring
- Taste vector similarity
- Occasion matching

### Database

Uses pgvector with HNSW index for fast similarity search on item embeddings. Key tables:
- `wardrobe_items` - User clothing with embeddings
- `user_taste_vectors` - Personalization vectors
- `generated_outfits` - Cached outfits (24h TTL)
- `outfit_history` - Permanent wear records
- `user_gamification` - XP, streaks, achievements

Migrations in `supabase/migrations/`. Deploy with `supabase db push`.

### Limits

Free tier: 35 items, 5 style credits/month
Pro tier: Unlimited items, 75 style credits/month

Rate limits (in-memory, not multi-instance safe):
- Item uploads: 30/hour
- Style Me: 75/day
