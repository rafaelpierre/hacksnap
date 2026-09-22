import { previewText } from "./preview-metadata";

export function shareText(id: string, title: string, takeaway?: string | null) {
  const url = `https://hacksnap.live/story/${id}`;
  const text = previewText(takeaway?.trim() || title, 240);
  return {
    url,
    text,
    // Leave room for X's URL and double-weighted Unicode characters.
    tweet: previewText(text, 120),
    post: `${text}\n\n${url}`,
  };
}
