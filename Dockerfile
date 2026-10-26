FROM node:22-alpine

# sharp (media rendering) ships prebuilt musl binaries; libc6-compat covers
# any native addon that expects glibc symbols.
RUN apk add --no-cache libc6-compat

# pnpm-lock.yaml is the lockfile kept in sync with package.json
# (package-lock.json is stale and `npm ci` rejects it).
RUN npm install -g pnpm@10.33.0

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

# Placeholder env so `next build` can validate src/env.ts without secrets.
# Real values come from the runtime environment, which overrides .env.
COPY .env.example .env

# Inlined into the client bundle at build time, so pass the public URL:
#   docker build --build-arg NEXT_PUBLIC_APP_URL=https://linkedin.example.com .
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

ENV APP_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm build

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Starts `next start`; src/instrumentation.ts boots the job worker and the
# cron scheduler inside this same process unless APP_ROLE=web. With
# separate_worker set, Terraform runs this image twice: a web service
# (APP_ROLE=web) and a worker (APP_ROLE=worker).
CMD ["pnpm", "start"]
