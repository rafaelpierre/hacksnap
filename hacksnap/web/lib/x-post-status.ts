import twitter from "twitter-text";

/** X counts URLs as 23 characters and weights some Unicode characters differently. */
export function xPostStatus(post: string) {
  const parsed = twitter.parseTweet(post);
  return { length: parsed.weightedLength, limit: 280, valid: parsed.valid };
}
