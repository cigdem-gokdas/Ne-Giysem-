/** True for failures that are worth retrying: no connectivity, timeouts and gateway/5xx responses.
 * Business errors (limits, validation, 4xx, Pro required) are never transient. */
export function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'ProRequiredError' || error.name === 'RateLimitError') return false;
  if (error.name === 'AbortError' || error instanceof TypeError) return true;
  return /network request failed|failed to fetch|network|internet bağlant|zaman aş|timeout|HTTP 5\d\d|geçici olarak yanıt vermedi/i.test(error.message);
}
