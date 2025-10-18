import OpenAI from 'openai';
import { NextRequest } from 'next/server';
import {
  StreamEvent,
  WebSearchSearchingEvent,
  WebSearchCompletedEvent,
  ContentEvent,
  TextDoneEvent,
  JobDoneEvent,
  ErrorEvent,
  CompleteEvent,
} from '@/types/stream-events';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Runs a single Deep Research job and returns a streaming response
 */
async function* runSingleDeepResearch(
  query: string,
  jobId: number
): AsyncGenerator<Exclude<StreamEvent, CompleteEvent>, void, unknown> {
  // Use the responses endpoint instead of chat.completions
  const stream = await openai.responses.create({
    model: 'o4-mini-deep-research-2025-06-26',
    input: [
      {
        role: 'user',
        content: query,
      },
    ],
    tools: [
      {
        type: 'web_search_preview',
      },
    ],
    stream: true,
  });

  for await (const event of stream) {
    // Log all events for debugging
    console.log(`[Job ${jobId}] Event:`, event.type);

    // Handle text deltas (streaming content)
    if (event.type === 'response.output_text.delta') {
      console.log(`[Job ${jobId}] Text delta: "${event.delta}"`);
      const contentEvent: ContentEvent = {
        type: 'content',
        job: jobId,
        content: event.delta,
        timestamp: Date.now(),
      };
      yield contentEvent;
    }

    // Handle text completion
    if (event.type === 'response.output_text.done') {
      const textDoneEvent: TextDoneEvent = {
        type: 'text_done',
        job: jobId,
        item_id: event.item_id,
        timestamp: Date.now(),
      };
      yield textDoneEvent;
    }

    // Handle web search events
    if (event.type === 'response.web_search_call.searching') {
      console.log(`[Job ${jobId}] Web search #${event.sequence_number}`);
      const searchEvent: WebSearchSearchingEvent = {
        type: 'web_search_searching',
        job: jobId,
        item_id: event.item_id,
        sequence_number: event.sequence_number,
        timestamp: Date.now(),
      };
      yield searchEvent;
    }

    if (event.type === 'response.web_search_call.completed') {

      // log raw web search completed event 
      console.log(`[Job ${jobId}] Web search completed event:`, event);

      const completedEvent: WebSearchCompletedEvent = {
        type: 'web_search_completed',
        job: jobId,
        item_id: event.item_id,
        timestamp: Date.now(),
      };
      yield completedEvent;
    }

    // Handle completion
    if (event.type === 'response.completed') {
      console.log(`[Job ${jobId}] Completed`);
      const doneEvent: JobDoneEvent = {
        type: 'done',
        job: jobId,
        timestamp: Date.now(),
      };
      yield doneEvent;
    }

    // Handle errors
    if (event.type === 'response.failed') {
      console.error(`[Job ${jobId}] Failed`);
      const errorEvent: ErrorEvent = {
        type: 'error',
        job: jobId,
        error: 'Response failed',
        timestamp: Date.now(),
      };
      yield errorEvent;
    }
  }
}

/**
 * POST /api/deep-research
 * Body: { query: string } or { queries: string[] }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Support both single query and multiple queries
    const queries = Array.isArray(body.queries) ? body.queries : [body.query];

    if (!queries.length || queries.some((q: any) => !q)) {
      return new Response(
        JSON.stringify({ error: 'Query or queries required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create a readable stream for SSE (Server-Sent Events)
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Start all jobs in parallel
          const generators = queries.map((query: string, index: number) =>
            runSingleDeepResearch(query, index)
          );

          // Merge streams by racing them
          type Generator = AsyncGenerator<any, void, unknown>;

          // Create a map to track pending promises for each generator
          const pendingPromises = new Map<Generator, Promise<{gen: Generator, result: IteratorResult<any>}>>();

          // Initialize all generators with their first next() call
          for (const gen of generators) {
            pendingPromises.set(gen, gen.next().then((result: IteratorResult<Exclude<StreamEvent, CompleteEvent>>) => ({ gen, result })));
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
              pendingPromises.set(gen, gen.next().then((result: IteratorResult<Exclude<StreamEvent, CompleteEvent>>) => ({ gen, result })));
            }
          }

          // Send final done event
          const completeEvent: CompleteEvent = {
            type: 'complete',
            timestamp: Date.now(),
          };
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(completeEvent)}\n\n`)
          );
          controller.close();
        } catch (error) {
          console.error('Deep research error:', error);
          const errorData = JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Request error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
