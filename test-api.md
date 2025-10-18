# Testing the Deep Research API

## Setup

1. Add your OpenAI API key to `.env.local`:
   ```bash
   OPENAI_API_KEY=sk-...your-key-here
   ```

2. Start the dev server:
   ```bash
   bun run dev
   ```

## Test Commands

### Test 1: Single Query
```bash
curl -N -X POST http://localhost:3000/api/deep-research \
  -H "Content-Type: application/json" \
  -d '{"query": "What are the key legal precedents for breach of contract in California?"}'
```

### Test 2: Parallel Queries (2 jobs)
```bash
curl -N -X POST http://localhost:3000/api/deep-research \
  -H "Content-Type: application/json" \
  -d '{
    "queries": [
      "What are the key legal precedents for breach of contract in California?",
      "Summarize recent changes to employment law in 2024"
    ]
  }'
```

### Test 3: Parallel Queries (3 jobs)
```bash
curl -N -X POST http://localhost:3000/api/deep-research \
  -H "Content-Type: application/json" \
  -d '{
    "queries": [
      "What are the key legal precedents for breach of contract in California?",
      "Summarize recent changes to employment law in 2024",
      "What are the requirements for patent infringement claims?"
    ]
  }'
```

## Expected Output

You should see Server-Sent Events (SSE) streaming back like:

```
data: {"type":"content","job":0,"content":"In California","timestamp":1234567890}

data: {"type":"content","job":1,"content":"Employment law","timestamp":1234567891}

data: {"type":"content","job":0,"content":" breach of contract","timestamp":1234567892}

data: {"type":"done","job":0,"timestamp":1234567900}

data: {"type":"done","job":1,"timestamp":1234567901}

data: {"type":"complete"}
```

## Notes

- The `-N` flag in curl disables buffering so you see streaming output in real-time
- Each event has a `job` field (0, 1, 2, etc.) to identify which query it belongs to
- Events are merged in real-time as they arrive from parallel jobs
