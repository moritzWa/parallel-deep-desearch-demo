/**
 * Shared types for Deep Research streaming events
 * Used by both backend (API route) and frontend (client component)
 */

/**
 * Base event that all streaming events extend from
 */
interface BaseStreamEvent {
  job: number;
  timestamp: number;
}

/**
 * Web search is starting
 */
export interface WebSearchSearchingEvent extends BaseStreamEvent {
  type: 'web_search_searching';
  item_id: string;
  sequence_number: number;
}

/**
 * Web search completed
 */
export interface WebSearchCompletedEvent extends BaseStreamEvent {
  type: 'web_search_completed';
  item_id: string;
}

/**
 * Streaming text content chunk
 */
export interface ContentEvent extends BaseStreamEvent {
  type: 'content';
  content: string;
}

/**
 * Text block finished (not the entire response)
 */
export interface TextDoneEvent extends BaseStreamEvent {
  type: 'text_done';
  item_id: string;
}

/**
 * Individual job completed
 */
export interface JobDoneEvent extends BaseStreamEvent {
  type: 'done';
}

/**
 * Error occurred for a specific job
 */
export interface ErrorEvent extends BaseStreamEvent {
  type: 'error';
  error: string;
}

/**
 * All jobs completed (sent once at the end)
 * Note: This event has no 'job' field since it applies to all jobs
 */
export interface CompleteEvent {
  type: 'complete';
  timestamp: number;
}

/**
 * Union type of all possible stream events
 */
export type StreamEvent =
  | WebSearchSearchingEvent
  | WebSearchCompletedEvent
  | ContentEvent
  | TextDoneEvent
  | JobDoneEvent
  | ErrorEvent
  | CompleteEvent;

/**
 * Type guard to check if event has a job field
 */
export function hasJobField(event: StreamEvent): event is Exclude<StreamEvent, CompleteEvent> {
  return 'job' in event;
}
