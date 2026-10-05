/**
 * Token bucket: allows bursts up to `capacity`, refilling at `refillPerSecond`.
 * Returns a function that consumes one token and reports whether the action is allowed.
 */
export const createRateLimiter = (capacity: number, refillPerSecond: number) => {
  let tokens = capacity;
  let last = Date.now();

  return (): boolean => {
    const now = Date.now();
    tokens = Math.min(capacity, tokens + ((now - last) / 1000) * refillPerSecond);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
};
