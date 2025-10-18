# Parallel Deep Research Demo

A Next.js application demonstrating parallel streaming with OpenAI's Deep Research API.

## Features

- Runs multiple Deep Research jobs in parallel
- Merges streaming responses in real-time
- Server-Sent Events (SSE) for live updates
- Simple UI with shadcn components

## Setup

1. Install dependencies:
```bash
bun install
```

2. Add your OpenAI API key to `.env.local`:
```bash
OPENAI_API_KEY=sk-...your-key-here
```

3. Run the development server:
```bash
bun run dev
```

## Testing with curl

See [test-api.md](./test-api.md) for detailed curl commands to test the API.

Quick test:
```bash
curl -N -X POST http://localhost:3000/api/deep-research \
  -H "Content-Type: application/json" \
  -d '{"query": "What are the key legal precedents for breach of contract in California?"}'
```

## Architecture

- **Backend**: `/src/app/api/deep-research/route.ts` - API route that handles parallel Deep Research jobs
- **Frontend**: `/src/app/page.tsx` - UI for triggering and displaying research results
- **Stream Merging**: Uses Promise.race() to merge multiple async generators in real-time
