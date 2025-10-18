import OpenAI from 'openai';
import { NextRequest } from 'next/server';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Runs a single Deep Research job and returns a streaming response
 */
async function* runSingleDeepResearch(query: string, jobId: number) {
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
    // Handle text deltas (streaming content)
    if (event.type === 'response.output_text.delta') {
      yield {
        type: 'content',
        job: jobId,
        content: event.delta,
        timestamp: Date.now(),
      };
    }

    // Handle text completion
    if (event.type === 'response.output_text.done') {
      yield {
        type: 'text_done',
        job: jobId,
        item_id: event.item_id,
        timestamp: Date.now(),
      };
    }

    // Handle web search events
    if (event.type === 'response.web_search_call.searching') {
      yield {
        type: 'web_search_searching',
        job: jobId,
        item_id: event.item_id,
        sequence_number: event.sequence_number,
        timestamp: Date.now(),
      };
    }

    if (event.type === 'response.web_search_call.completed') {
      yield {
        type: 'web_search_completed',
        job: jobId,
        item_id: event.item_id,
        timestamp: Date.now(),
      };
    }

    // Handle completion
    if (event.type === 'response.completed') {
      yield {
        type: 'done',
        job: jobId,
        timestamp: Date.now(),
      };
    }

    // Handle errors
    if (event.type === 'response.failed') {
      yield {
        type: 'error',
        job: jobId,
        error: 'Response failed',
        timestamp: Date.now(),
      };
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
          const activeGenerators = new Set<Generator>(generators);

          while (activeGenerators.size > 0) {
            // Create a promise for the next value from each generator
            const promises = Array.from(activeGenerators).map(async (gen) => ({
              gen,
              result: await gen.next(),
            }));

            // Race to get the next available value
            const { gen, result } = await Promise.race(promises);

            if (result.done) {
              activeGenerators.delete(gen);
            } else {
              // Send the event as SSE
              const data = JSON.stringify(result.value);
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }
          }

          // Send final done event
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'complete' })}\n\n`)
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
