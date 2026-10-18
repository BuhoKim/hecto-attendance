export const INITIAL_REFRESH_DELAY_MS = 5 * 60 * 1000;
export const MAX_REFRESH_DELAY_MS = 10 * 60 * 1000;

export function getNextRefreshDelay(succeeded, currentDelay) {
  if (succeeded) return INITIAL_REFRESH_DELAY_MS;
  return Math.min(currentDelay * 2, MAX_REFRESH_DELAY_MS);
}
