'use client';

import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { StreamEvent, hasJobField } from '@/types/stream-events';

interface ResearchJob {
  id: number;
  query: string;
  content: string;
  status: 'idle' | 'searching' | 'streaming' | 'done' | 'error';
  searchCount: number;
}

const DEMO_QUERIES = [
  'What did David Deutsch say about us being immortal by now?',
  // 'What did David Deutsch invent? Concise answer',
  'Why did humans evolve to die? Concise answer',
];

export function ResearchStream() {
  const [jobs, setJobs] = useState<ResearchJob[]>(
    DEMO_QUERIES.map((query, id) => ({
      id,
      query,
      content: '',
      status: 'idle',
      searchCount: 0,
    }))
  );
  const [isRunning, setIsRunning] = useState(false);

  const startAllResearch = async () => {
    setIsRunning(true);

    // Reset all jobs
    setJobs((prev) =>
      prev.map((job) => ({
        ...job,
        content: '',
        status: 'searching',
        searchCount: 0,
      }))
    );

    try {
      const response = await fetch('/api/deep-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queries: DEMO_QUERIES,
        }),
      });

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const event: StreamEvent = JSON.parse(data);
              console.log('Received event:', event);

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

              setJobs((prev) =>
                prev.map((job) => {
                  if (job.id !== event.job) return job;

                  switch (event.type) {
                    case 'web_search_searching':
                      console.log(`Job ${event.job}: web search #${job.searchCount + 1}`);
                      return {
                        ...job,
                        status: 'searching',
                        searchCount: job.searchCount + 1,
                      };
                    case 'web_search_completed':
                      // Just acknowledge, don't change status
                      return job;
                    case 'content':
                      const newContent = job.content + (event.content || '');
                      console.log(`Job ${event.job}: content chunk (${event.content?.length} chars), total: ${newContent.length}`);
                      return {
                        ...job,
                        status: 'streaming',
                        content: newContent,
                      };
                    case 'text_done':
                      // Text block complete, continue streaming
                      return job;
                    case 'done':
                      console.log(`Job ${event.job}: done`);
                      return { ...job, status: 'done' };
                    case 'error':
                      console.log(`Job ${event.job}: error`);
                      return { ...job, status: 'error' };
                    default:
                      // Exhaustive check - TypeScript will error if we miss a case
                      const _exhaustive: never = event;
                      console.log(`Unknown event type:`, _exhaustive);
                      return job;
                  }
                })
              );
            } catch (e) {
              console.error('Failed to parse event:', e, 'Data:', data);
            }
          }
        }
      }
    } catch (error) {
      console.error('Research error:', error);
      setJobs((prev) =>
        prev.map((job) => ({ ...job, status: 'error' as const }))
      );
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Parallel Deep Research Demo</h1>
          <p className="text-gray-600 mt-2">
            Streaming results from multiple research jobs in parallel
          </p>
        </div>
        <button
          onClick={startAllResearch}
          disabled={isRunning}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {isRunning ? 'Researching...' : 'Start All Research'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {jobs.map((job) => (
          <div
            key={job.id}
            className="border rounded-lg p-4 bg-white shadow-sm space-y-3"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold text-sm line-clamp-2">
                {job.query}
              </h3>
              <StatusBadge status={job.status} searchCount={job.searchCount} />
            </div>

            <div className="min-h-[300px] max-h-[500px] overflow-y-auto">
              {job.content ? (
                <div className="text-sm text-gray-700 prose prose-sm max-w-none">
                  <ReactMarkdown
                    components={{
                      p: ({ node, children, ...props }) => {
                        // Process children to remove parentheses around links
                        const processedChildren = React.Children.map(children, (child) => {
                          if (typeof child === 'string') {
                            // Remove parentheses that wrap citation links
                            // Pattern: (link) or ) (link) or (link) (
                            return child
                              .replace(/\s*\(\s*$/g, ' ') // Remove opening paren before link
                              .replace(/^\s*\)\s*/g, ' ') // Remove closing paren after link
                              .replace(/\s+/g, ' '); // Normalize spaces
                          }
                          return child;
                        });

                        return (
                          <p {...props} className="mb-3 leading-relaxed">
                            {processedChildren}
                          </p>
                        );
                      },
                      a: ({ node, href, children, ...props }) => {
                        // Extract domain from URL for display
                        let domain = '';
                        try {
                          domain = href ? new URL(href).hostname.replace('www.', '') : '';
                        } catch {
                          domain = href || '';
                        }

                        return (
                          <a
                            {...props}
                            href={href}
                            className="inline-flex items-center align-baseline mx-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-secondary-50 text-secondary-700 rounded hover:bg-secondary-100 transition-colors no-underline"
                            target="_blank"
                            rel="noopener noreferrer"
                            title={href}
                          >
                            {domain}
                          </a>
                        );
                      },
                      ul: ({ node, ...props }) => (
                        <ul {...props} className="list-disc pl-4 mb-3 space-y-1" />
                      ),
                      ol: ({ node, ...props }) => (
                        <ol {...props} className="list-decimal pl-4 mb-3 space-y-1" />
                      ),
                      li: ({ node, ...props }) => (
                        <li {...props} className="mb-1" />
                      ),
                      h1: ({ node, ...props }) => (
                        <h1 {...props} className="text-lg font-bold mb-2 mt-4" />
                      ),
                      h2: ({ node, ...props }) => (
                        <h2 {...props} className="text-base font-bold mb-2 mt-3" />
                      ),
                      h3: ({ node, ...props }) => (
                        <h3 {...props} className="text-sm font-bold mb-1 mt-2" />
                      ),
                      code: ({ node, ...props }) => (
                        <code
                          {...props}
                          className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono"
                        />
                      ),
                      blockquote: ({ node, ...props }) => (
                        <blockquote
                          {...props}
                          className="border-l-4 border-gray-300 pl-3 italic my-2 text-gray-600"
                        />
                      ),
                      strong: ({ node, ...props }) => (
                        <strong {...props} className="font-semibold text-gray-900" />
                      ),
                    }}
                  >
                    {job.content}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="text-sm text-gray-400 italic">
                  {job.status === 'searching' &&
                    `Searching... (${job.searchCount} searches)`}
                  {job.status === 'idle' && 'Waiting to start...'}
                  {job.status === 'error' && 'Error occurred'}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({
  status,
  searchCount,
}: {
  status: ResearchJob['status'];
  searchCount: number;
}) {
  const styles = {
    idle: 'bg-gray-100 text-gray-600',
    searching: 'bg-yellow-100 text-yellow-700',
    streaming: 'bg-blue-100 text-blue-700',
    done: 'bg-green-100 text-green-700',
    error: 'bg-red-100 text-red-700',
  };

  const labels = {
    idle: 'Idle',
    searching: `Searching (${searchCount})`,
    streaming: 'Streaming',
    done: 'Done',
    error: 'Error',
  };

  return (
    <span
      className={`px-2 py-1 text-xs font-medium rounded ${styles[status]} whitespace-nowrap`}
    >
      {labels[status]}
    </span>
  );
}
