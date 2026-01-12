# Task Completion Checklist

When completing a task in the Styleum API codebase, follow these steps:

## 1. Code Quality
- [ ] Ensure TypeScript compiles without errors: `npm run build`
- [ ] Follow existing code style and conventions
- [ ] Use proper type annotations
- [ ] Add console logging for important operations with appropriate prefixes

## 2. Testing
- [ ] Manually test the API endpoint/functionality
- [ ] No automated test suite exists - consider adding tests if appropriate

## 3. Database Changes
If the task involves database changes:
- [ ] Create a new migration file in `supabase/migrations/`
- [ ] Use timestamp naming: `YYYYMMDDHHMMSS_description.sql`
- [ ] Apply migration: `supabase db push`

## 4. Environment Variables
If new environment variables are needed:
- [ ] Document in CLAUDE.md
- [ ] Add to Railway environment settings

## 5. Before Committing
- [ ] Run `npm run build` to verify compilation
- [ ] Review changes with `git diff`
- [ ] Write clear, descriptive commit message

## 6. Deployment
- Deployment is automatic on push to main branch via Railway
- Health check runs against `/health` endpoint
- Monitor Railway logs for any deployment issues

## Notes
- No linting or formatting tools configured
- No automated tests currently
- Manual verification is the primary testing method
