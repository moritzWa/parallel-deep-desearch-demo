# Architecture Documentation

## Overview

This app demonstrates **parallel streaming** of multiple OpenAI Deep Research jobs, merging their results into a single Server-Sent Events (SSE) stream with full TypeScript type safety.

## Shared Types (`/src/types/stream-events.ts`)

All streaming events are strongly typed and shared between backend and frontend:

```typescript
export type StreamEvent =
  | WebSearchSearchingEvent    // Web search starting
  | WebSearchCompletedEvent    // Web search finished
  | ContentEvent               // Streaming text chunk
  | TextDoneEvent              // Text block complete
  | JobDoneEvent               // Individual job done
  | ErrorEvent                 // Error occurred
  | CompleteEvent;             // All jobs complete (no job field)
```

**Key features:**
- **Type safety**: Catch errors at compile time, not runtime
- **Discriminated unions**: Switch statements are exhaustive-checked
- **Type guards**: `hasJobField()` safely narrows types
- **Special case**: `CompleteEvent` has no `job` field (applies to all jobs)

## How It Works

### Backend: API Route (`/src/app/api/deep-research/route.ts`)

#### 1. `runSingleDeepResearch()` - Async Generator Function

```typescript
async function* runSingleDeepResearch(query: string, jobId: number)
```

**What it does:**
- Makes a request to OpenAI's Deep Research API (`openai.responses.create()`)
- Uses the `o4-mini-deep-research-2025-06-26` model
- Enables `web_search_preview` tool for real-world research
- Returns an **async generator** that yields events as they arrive from OpenAI

**Key concepts:**
- **Async Generator (`async function*`)**: A function that can yield multiple values over time (like a stream)
- **`yield`**: Emits a value without ending the function - allows streaming
- **`for await...of`**: Loops over async iterables (like the OpenAI event stream)

**Events yielded:**
- `web_search_searching`: OpenAI is performing a web search
- `web_search_completed`: A web search finished
- `content`: Text chunk from the AI's response
- `text_done`: Finished generating one text block
- `done`: Entire response complete
- `error`: Something went wrong

Each event is tagged with `job: jobId` so the frontend knows which query it belongs to.

---

#### 2. `POST()` - HTTP Handler

```typescript
export async function POST(req: NextRequest)
```

**What it does:**
- Receives `{ queries: string[] }` in the request body
- Starts multiple Deep Research jobs **in parallel**
- **Merges** all their event streams into a single SSE stream
- Sends events to the client as they arrive from ANY job

**Key concepts:**

##### ReadableStream
```typescript
const stream = new ReadableStream({
  async start(controller) { ... }
})
```
- **ReadableStream**: Web API for creating custom streams
- **`start(controller)`**: Callback that runs when stream starts
- **`controller`**: Object to send data (`controller.enqueue()`) and close stream (`controller.close()`)

##### Stream Merging with Promise.race() and Pending Promises Map

```typescript
const generators = queries.map((query, index) =>
  runSingleDeepResearch(query, index)
);
```
- Creates one async generator per query (e.g., 2-3 generators for multiple queries)
- Each generator is independently streaming events from OpenAI

**Critical Implementation Detail - Avoiding Lost Events:**

```typescript
const pendingPromises = new Map<Generator, Promise<{gen: Generator, result: IteratorResult<any>}>>();

// Initialize all generators with their first next() call
for (const gen of generators) {
  pendingPromises.set(gen, gen.next().then(result => ({ gen, result })));
}

while (pendingPromises.size > 0) {
  // Race all pending promises
  const { gen, result } = await Promise.race(pendingPromises.values());

  if (result.done) {
    // Generator is complete, remove it
    pendingPromises.delete(gen);
  } else {
    // Send the event as SSE
    const data = JSON.stringify(result.value);
    controller.enqueue(encoder.encode(`data: ${data}\n\n`));

    // Immediately start waiting for the next value from this generator
    pendingPromises.set(gen, gen.next().then(result => ({ gen, result })));
  }
}
```

**How this works:**
1. **Map tracks pending promises**: Each generator has exactly ONE pending `next()` call tracked in the Map
2. **`Promise.race(pendingPromises.values())`**: Returns the **first** generator that produces a value
3. **Immediate replacement**: When a promise resolves, we immediately create a new `next()` promise for that specific generator
4. **No concurrent `next()` calls**: Each generator only has one `next()` call active at a time
5. **No lost events**: Every event is guaranteed to be processed before requesting the next one

**Why this approach prevents lost events:**
- ❌ **Previous bug**: Creating new `gen.next()` promises on every loop iteration caused multiple concurrent `next()` calls on the same generator → **dropped events**
- ✅ **Current fix**: Map ensures ONE pending promise per generator. When resolved, immediately replaced with new `next()` call
- ✅ **True parallelism**: All generators advance independently while maintaining event order per generator

**Why `Promise.race()`?**
- Without it, we'd have to wait for Job 1 to finish before Job 2 starts (sequential)
- With it, all jobs run truly in parallel, and events stream as they arrive (parallel)
- Events from different jobs are interleaved in real-time based on which produces events faster

##### Sending SSE

```typescript
const encoder = new TextEncoder();
const data = JSON.stringify(result.value);
controller.enqueue(encoder.encode(`data: ${data}\n\n`));
```

**Server-Sent Events (SSE) format:**
- Each message starts with `data: `
- Followed by JSON
- Ends with `\n\n` (two newlines)
- Example: `data: {"type":"content","job":0,"content":"Hello"}\n\n`

**TextEncoder:**
- Converts strings to bytes (Uint8Array)
- Required because streams work with binary data

---

### Frontend: Client Component (`/src/components/research-stream.tsx`)

#### State Management

```typescript
const [jobs, setJobs] = useState<ResearchJob[]>(
  DEMO_QUERIES.map((query, id) => ({
    id,
    query,
    content: '',
    status: 'idle',
    searchCount: 0,
  }))
);
```

- **3 jobs** (one per query)
- Each job tracks: query text, accumulated content, status, search count

---

#### Fetching & Streaming

```typescript
const response = await fetch('/api/deep-research', {
  method: 'POST',
  body: JSON.stringify({ queries: DEMO_QUERIES }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();
```

**Key concepts:**
- **`response.body.getReader()`**: Gets a stream reader for the HTTP response
- **`TextDecoder`**: Converts bytes back to strings (opposite of TextEncoder)

```typescript
while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value);
  const lines = chunk.split('\n');

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6); // Remove "data: " prefix
      const event = JSON.parse(data);
      // Update state based on event...
    }
  }
}
```

**How it works:**
1. **`reader.read()`**: Reads the next chunk of data from the stream (blocks until available)
2. **`value`**: Bytes (Uint8Array) containing the chunk
3. **`decoder.decode(value)`**: Converts bytes to string
4. **`split('\n')`**: SSE events are separated by newlines
5. **Parse JSON**: Extract the event object
6. **Update state**: Use `setJobs()` to update the corresponding job

---

#### State Updates with Type Safety

```typescript
const event: StreamEvent = JSON.parse(data);

// Skip 'complete' event (applies to all jobs, not a specific one)
if (event.type === 'complete') {
  console.log('All jobs complete');
  continue;
}

// Type guard ensures event has a job field
if (!hasJobField(event)) {
  console.warn('Event missing job field:', event);
  continue;
}

// TypeScript now knows event has a 'job' field
setJobs((prev) =>
  prev.map((job) => {
    if (job.id !== event.job) return job; // Not this job, skip

    switch (event.type) {
      case 'web_search_searching':
        return { ...job, searchCount: job.searchCount + 1 };
      case 'web_search_completed':
        return job; // Acknowledge, don't change status
      case 'content':
        return { ...job, content: job.content + event.content };
      case 'text_done':
        return job; // Text block done, continue
      case 'done':
        return { ...job, status: 'done' };
      case 'error':
        return { ...job, status: 'error' };
      default:
        // Exhaustive check - TypeScript errors if we miss a case
        const _exhaustive: never = event;
        return job;
    }
  })
);
```

**Type safety benefits:**
- **`hasJobField()` guard**: Ensures event has `job` field before accessing it
- **Exhaustive switch**: TypeScript errors if we don't handle all event types
- **`CompleteEvent` handling**: Explicitly handled before job matching

**Why `prev.map()`?**
- We receive events from ALL jobs mixed together
- We need to update ONLY the job that matches `event.job`
- `map()` iterates through all jobs, updates the matching one, returns the rest unchanged

**Why `job.content + event.content`?**
- Content arrives in **chunks** (e.g., "Hello", " world", "!")
- We **append** each chunk to build the full response

---

## Event Flow Diagram

```
User clicks "Start All Research"
  ↓
Frontend: fetch('/api/deep-research', { queries: [q1, q2, q3] })
  ↓
Backend: Start 3 OpenAI Deep Research jobs in parallel
  ↓
Backend: Promise.race() waits for next event from any job
  ↓
Job 2 emits: { type: 'web_search_searching', job: 1, ... }
  ↓
Backend: Encode as SSE and send to client
  ↓
Frontend: reader.read() receives chunk
  ↓
Frontend: Parse JSON, update job #1 state
  ↓
React re-renders → User sees "Searching (1)" badge on Card 2
  ↓
(Repeat for all events from all jobs until all complete)
```

---

## Common Issues & Solutions

### Issue 1: Lost Events / Missing Content

**Symptom:** Some jobs don't receive all their events, or content starts mid-sentence

**Root cause:** The original implementation called `generator.next()` multiple times concurrently on the same generator, causing a race condition where some events were dropped.

**Solution:** Use a Map to track exactly ONE pending promise per generator:

```typescript
// ❌ BAD: Multiple concurrent next() calls
while (activeGenerators.size > 0) {
  const promises = Array.from(activeGenerators).map(async (gen) => ({
    gen,
    result: await gen.next(),  // Called every iteration!
  }));
  const { gen, result } = await Promise.race(promises);
  // Lost events when we loop back and call next() again
}

// ✅ GOOD: One pending promise per generator
const pendingPromises = new Map();
for (const gen of generators) {
  pendingPromises.set(gen, gen.next().then(result => ({ gen, result })));
}
while (pendingPromises.size > 0) {
  const { gen, result } = await Promise.race(pendingPromises.values());
  if (!result.done) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(result.value)}\n\n`));
    // Replace with new next() call AFTER processing
    pendingPromises.set(gen, gen.next().then(result => ({ gen, result })));
  }
}
```

### Issue 2: Jobs Performing Different Numbers of Searches

**This is expected behavior!** OpenAI's Deep Research model decides how many searches are needed based on query complexity:
- Complex philosophical questions → many searches (200+ web searches)
- Simple factual questions → fewer searches (10-20 web searches)
- Cached/well-known topics → minimal searches

**Example from logs:**
- Job 0: "David Deutsch on immortality" → 314 web searches
- Job 1: "Why do humans die?" → 216 web searches
- Both jobs running in parallel, each at their own pace!

---

## SSE vs WebSockets

**You mentioned WebSockets - this is actually SSE (Server-Sent Events):**

| Feature | SSE | WebSockets |
|---------|-----|-----------|
| Direction | Server → Client only | Bidirectional |
| Protocol | HTTP | ws:// |
| Format | Text (simple) | Binary/Text |
| Reconnect | Automatic | Manual |
| Use case | **Streaming responses** | Real-time chat |

We use SSE because:
- One-way communication (server sends updates)
- Simpler than WebSockets
- Works over standard HTTP
- Next.js has great SSE support

---

## Next Steps

1. **Check logs**: Open browser console and backend logs, click button
2. **Verify events**: Confirm all 3 jobs receive `response.output_text.delta` events
3. **Hypothesis**: If only job 1 shows searches, it's because OpenAI didn't search for the other queries

Let me know what you see in the logs!
