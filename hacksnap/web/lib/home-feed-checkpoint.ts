// Retire the former ranked-home checkpoint without touching other browser data.
export const HOME_FEED_CHECKPOINT_KEY = "hacksnap:home-feed-checkpoint";

export function clearHomeFeedCheckpoint(): boolean {
  try {
    globalThis.localStorage?.removeItem(HOME_FEED_CHECKPOINT_KEY);
    return true;
  } catch {
    return false;
  }
}
