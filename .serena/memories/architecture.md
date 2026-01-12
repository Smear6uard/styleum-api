# Codebase Architecture

## Directory Structure
```
styleum-api/
├── src/
│   ├── index.ts              # Entry point, app setup, health routes
│   ├── middleware/
│   │   ├── auth.ts           # JWT authentication middleware
│   │   ├── rateLimit.ts      # In-memory rate limiting
│   │   └── trackActivity.ts  # User activity tracking
│   ├── routes/
│   │   ├── account.ts        # Account management (deletion)
│   │   ├── gamification.ts   # XP, streaks, achievements
│   │   ├── items.ts          # Wardrobe item CRUD
│   │   ├── onboarding.ts     # Onboarding flow
│   │   ├── outfits.ts        # Outfit generation endpoints
│   │   ├── profile.ts        # User profile
│   │   ├── styleQuiz.ts      # Style quiz/taste setup
│   │   ├── subscriptions.ts  # Subscription management
│   │   └── webhooks.ts       # External webhooks (RevenueCat)
│   ├── services/
│   │   ├── supabase.ts       # Supabase client setup
│   │   ├── outfitGenerator.ts # Core outfit generation logic
│   │   ├── tasteVector.ts    # User taste vector management
│   │   ├── colorHarmony.ts   # Color compatibility scoring
│   │   ├── weather.ts        # Weather API integration
│   │   └── ai/
│   │       ├── index.ts          # AI service exports
│   │       ├── runpod.ts         # RunPod API client
│   │       ├── backgroundRemoval.ts # BiRefNet background removal
│   │       ├── visionAnalysis.ts    # Florence-2 vision analysis
│   │       ├── embeddings.ts        # FashionSigLIP embeddings
│   │       ├── itemTagging.ts       # Gemini item tagging
│   │       └── openrouter.ts        # OpenRouter API client
│   ├── jobs/
│   │   ├── preGenerate.ts          # Pre-generate outfits (cron)
│   │   └── sendMorningNotifications.ts # Push notifications (cron)
│   └── utils/
│       ├── limits.ts         # Subscription tier limits
│       └── seasonalFilter.ts # Season-based filtering
├── supabase/
│   └── migrations/           # Database migrations
├── dist/                     # Compiled JavaScript output
├── package.json
├── tsconfig.json
└── railway.toml              # Railway deployment config
```

## API Route Structure
| Route | Auth | Description |
|-------|------|-------------|
| `GET /`, `GET /health` | No | Health checks |
| `/api/*` | Yes | Protected endpoints (Bearer token) |
| `/webhooks/*` | No | External webhooks (signature verified) |
| `/cron/*` | Secret | Cron job endpoints |

## Item Processing Pipeline
1. **Upload**: Item created with `processing_status: 'processing'`
2. **Background removal**: BiRefNet via RunPod
3. **Vision analysis**: Florence-2 extracts visual features
4. **Embedding**: FashionSigLIP generates 768-dim vector
5. **Tagging**: Gemini reasons about category, occasions, seasons
6. **Complete**: Status updated to `completed`

## Taste Vector System
- Initialized from style quiz swipes (liked/disliked images)
- Updated via EMA on outfit interactions
- Interaction weights: wear=1.0, save=0.7, like=0.5, skip=-0.2, reject=-0.5
- Used for personalized outfit scoring with cosine similarity

## Database Tables (Key)
- `wardrobe_items` - User clothing with embeddings (pgvector halfvec)
- `user_taste_vectors` - Personalization vectors
- `generated_outfits` - Cached outfits (24h TTL)
- `outfit_history` - Permanent wear records
- `user_gamification` - XP, streaks, achievements
- `style_reference_images` - Images for style quiz

## Tier Limits
- **Free**: 35 items, 5 style credits/month
- **Pro**: Unlimited items, 75 style credits/month
