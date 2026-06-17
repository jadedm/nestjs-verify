# basic-twilio-postgres

Runnable example wiring `@jadedm/nestjs-verify` + Twilio + Postgres.

## Setup

```bash
cp .env.example .env
# fill in DATABASE_URL, TWILIO_*

# from the monorepo root:
pnpm install
pnpm build
pnpm --filter basic-twilio-postgres start
```

## Try it

```bash
# start a verification
curl -X POST http://localhost:3000/verify/start \
  -H 'Content-Type: application/json' \
  -d '{"to":"+14155552671"}'

# check a code
curl -X POST http://localhost:3000/verify/check \
  -H 'Content-Type: application/json' \
  -d '{"to":"+14155552671","code":"123456"}'
```
