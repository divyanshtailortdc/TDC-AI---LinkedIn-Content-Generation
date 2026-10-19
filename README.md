# TDC AI — LinkedIn Content Generation

A clean, modular starter foundation for the TDC AI LinkedIn Content Generation platform.

---

## 📌 Project Overview

**TDC AI — LinkedIn Content Generation** is designed to streamline thought leadership and professional content creation on LinkedIn. 

This repository contains the foundation setup including:
- Next.js (App Router) + TypeScript
- Minimal landing page
- Drizzle ORM + PostgreSQL schema and migrations

---

## 🛠️ Tech Stack

- **Framework:** [Next.js](https://nextjs.org/) (App Router, React 19)
- **Database ORM:** [Drizzle ORM](https://orm.drizzle.team/) + PostgreSQL (`postgres.js` driver)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Icons:** [lucide-react](https://lucide.dev/)

---

## 📁 Project Structure

```text
src/
├── app/
│   ├── page.tsx          # Minimal, modern landing page
│   ├── layout.tsx        # Root HTML layout and font definitions
│   └── globals.css       # Global styles and Tailwind tokens
├── components/           # Reusable UI components
├── db/                   # Database layer (Drizzle ORM)
│   ├── index.ts          # Singleton Drizzle client with import "server-only";
│   ├── schema.ts         # PostgreSQL entities (ideas, drafts, runs, sources, media)
│   └── migrations/       # Auto-generated SQL migration files
├── lib/                  # Shared utilities and service logic
└── types/                # Shared TypeScript type definitions
```

---

## 🗄️ Database & Schema Management (Drizzle ORM)

The database client in `src/db/index.ts` is guarded with `import "server-only";` and is attached to `globalThis` during development to prevent connection spikes from Next.js fast refresh.

### Migration Commands

```bash
# Generate SQL migration files from schema
npm run db:generate

# Apply pending migrations to the database
npm run db:migrate

# Push schema changes directly to database (prototyping)
npm run db:push

# Open Drizzle Studio UI to browse records
npm run db:studio
```

---

## 🚀 Local Development

### 1. Setup Environment

Copy the example environment file and configure your `DATABASE_URL` and API keys:

```bash
cp .env.example .env
```

Use `.env`, not `.env.local`: the dashboard points to `.env`, and Next.js lets a key in `.env.local` (even an empty one) override the same key in `.env`.

### 2. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 3. Verification Commands

```bash
npx tsc --noEmit
npm run lint
npm run build
```
