# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS

## Deployment na Vercel

Projekt je nastaven pro hosting na Vercelu. Build (`npm run build`) používá Nitro preset `vercel` a vytvoří `.vercel/output` (Vercel Build Output API) — SSR běží jako serverless funkce, statické soubory se servírují z CDN.

Postup:

1. **Propojit repozitář** ve Vercel Dashboardu (**Add New → Project → Import Git Repository**). Vercel detekuje build automaticky (`npm run build`), není potřeba nic měnit v nastavení.
2. **Nastavit environment variables** (**Settings → Environment Variables**) podle `.env.example`:
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (klientská část)
   - `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server funkce)
   - `OPENROUTER_API_KEY` (OCR přes AI – OpenRouter, výchozí vision model `qwen/qwen3-vl-8b-instruct`, lze změnit přes `OPENROUTER_MODEL`)
   - `LOVABLE_API_KEY` (OCR přes AI – fallback, použije se automaticky, když OpenRouter vrátí 402/429 nebo je nedostupný; doporučeno nastavit oba klíče)
3. **Deploy** — push do propojené větve spustí automatický deploy, případně lokálně přes `npx vercel --prod`.

Poznámky:

- Lokální preview produkčního buildu: `npm run build` + `npx vercel dev` (nebo `npx vercel build && npx vercel deploy --prebuilt`). Původní `npm run preview` (`vite preview`) funguje jen pro build bez Nitro přesměrování.
- Preview deploymenty může blokovat **Deployment Protection** — buď ji vypněte, nebo použijte *Protection Bypass for Automation* (Settings → Deployment Protection).
