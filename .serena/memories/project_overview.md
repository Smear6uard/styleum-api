# Styleum API - Project Overview

## Purpose
Styleum API is a TypeScript REST API for a wardrobe management and outfit generation mobile app. It allows users to:
- Upload and manage wardrobe items with AI-powered analysis
- Generate personalized outfit recommendations
- Complete style quizzes to build taste profiles
- Track outfit history and gamification features

## Tech Stack
- **Runtime**: Node.js with ES modules
- **Framework**: Hono (lightweight web framework)
- **Server**: @hono/node-server
- **Database/Auth**: Supabase (PostgreSQL + Auth + pgvector for embeddings)
- **AI Services**: RunPod serverless endpoints, Gemini via OpenRouter
- **Language**: TypeScript (strict mode)
- **Deployment**: Railway with Nixpacks builder

## Key Dependencies
- `hono` - Web framework
- `@supabase/supabase-js` - Database and auth client
- `dotenv` - Environment variables
- `tsx` - TypeScript execution for development

## Environment Variables Required
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_KEY` - Service role key (admin access)
- `RUNPOD_API_KEY` - RunPod API key for AI models
- `REVENUECAT_WEBHOOK_SECRET` - Webhook signature verification
- `CRON_SECRET` - Secret for authenticating cron job endpoints

## Deployment
- Hosted on Railway
- Uses Nixpacks builder
- Health check endpoint: `/health`
- Cron jobs configured for pre-generation (4AM ET) and notifications (9AM ET)
