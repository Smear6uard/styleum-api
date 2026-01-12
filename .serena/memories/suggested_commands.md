# Suggested Commands for Styleum API

## Development Commands
```bash
# Start development server with hot reload
npm run dev

# Build TypeScript to dist/
npm run build

# Run production build
npm start
```

## Testing
No automated tests are currently configured. The test script exits with error:
```bash
npm test  # Currently just echoes error
```

## Linting & Formatting
No ESLint or Prettier configuration exists. Code formatting is handled manually.

## TypeScript
```bash
# Type check without emitting
npx tsc --noEmit

# Build with TypeScript compiler
npm run build
```

## Database (Supabase)
```bash
# Push migrations to Supabase
supabase db push

# Generate types from database
supabase gen types typescript --project-id <project-id> > src/types/database.ts
```

## Git Commands
```bash
git status
git add .
git commit -m "message"
git push
git pull
git log --oneline -10
```

## System Commands (macOS/Darwin)
```bash
ls -la           # List files
cat <file>       # View file contents
grep -r "pattern" src/  # Search in code
find . -name "*.ts"     # Find TypeScript files
```

## Railway Deployment
Deployment happens automatically on push to main branch.
```bash
# View Railway logs (if Railway CLI installed)
railway logs
```
