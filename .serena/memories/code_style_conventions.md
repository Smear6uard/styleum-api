# Code Style and Conventions

## TypeScript Configuration
- **Target**: ES2022
- **Module**: ESNext with bundler resolution
- **Strict mode**: Enabled
- ES modules with `.js` extensions in imports

## Naming Conventions
- **Functions**: camelCase (e.g., `generateOutfits`, `getUserWardrobe`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `INTERACTION_WEIGHTS`, `VECTOR_DIM`)
- **Interfaces**: PascalCase (e.g., `GeneratedOutfit`, `WardrobeItem`)
- **Types**: PascalCase (e.g., `InteractionType`, `Variables`)
- **Files**: camelCase (e.g., `outfitGenerator.ts`, `tasteVector.ts`)

## Import Style
- Use `.js` extension for local imports (ES modules requirement)
- Type imports use `import type { ... }` syntax
- Group imports: external packages first, then local modules

```typescript
import type { Context, Next } from "hono";
import { supabaseAdmin } from "../services/supabase.js";
```

## Function Documentation
- JSDoc comments for public/exported functions
- Inline comments for complex logic
- Console logging with prefixes for tracing: `[Taste]`, `[AI]`, etc.

```typescript
/**
 * Initialize taste vector from onboarding swipes.
 * User swipes through 25-30 style images (Tinder-style).
 */
export async function initializeTasteVector(...): Promise<void> {
```

## Type Annotations
- Explicit return types on exported functions
- Use `as const` for constant objects used as enums
- Filter with type guards: `.filter((e): e is Type => ...)`

## Error Handling
- Try-catch for async operations
- Console.error for logging errors
- Return HTTP error responses with `c.json({ error: "..." }, statusCode)`

## API Response Pattern
```typescript
return c.json({ data: result }, 200);
return c.json({ error: "Error message" }, 400);
```

## Hono Middleware Pattern
- Use `Context<{ Variables: Type }>` for typed context
- Set variables with `c.set("key", value)`
- Get variables with `c.get("key")`
