import { previewText } from "./preview-metadata";

export function shareText(id: string, title: string, takeaway?: string | null, source?: string) {
  const url = `https://hacksnap.live/story/${id}${source ? `?${new URLSearchParams({utm: source})}` : ""}`;
  const text = previewText(takeaway?.trim() || title, 240);
  return {
    url,
    text,
    // Leave room for X's URL and double-weighted Unicode characters.
    tweet: previewText(text, 120),
    post: `${text}\n\n${url}`,
  };
}
