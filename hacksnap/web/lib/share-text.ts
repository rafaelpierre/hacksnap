import { canonicalStoryUrl } from "./story-url";
export { canonicalStoryUrl } from "./story-url";

export function suggestedPost(
  id: string,
  title: string,
  takeaway?: string | null,
  slug?: string | null,
): string {
  const url = canonicalStoryUrl(id, slug);
  const summary = takeaway?.trim();
  return summary
    ? `${title.trim()}\n\n${summary}\n\n${url}`
    : `${title.trim()}\n\nSummary pending. Read the story and Hacker News discussion: ${url}`;
}

/** LinkedIn needs a pasteable URL even when the reader removes it from the draft. */
export function linkedInPost(post: string, url: string): string {
  if (post.split(/\s+/u).includes(url)) return post;
  return post.trim() ? `${post}\n\n${url}` : url;
}

/** Destinations are navigation only. None of these URLs publishes a post. */
export function shareDestinations(post: string, url: string, title: string) {
  return [
    {
      name: "X",
      href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(post)}`,
      acceptsText: true,
    },
    {
      name: "LinkedIn",
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
      acceptsText: false,
    },
    {
      name: "Email",
      href: `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(post.replaceAll("\n", "\r\n"))}`,
      acceptsText: true,
    },
  ];
}

export async function copyText(
  text: string,
  clipboard?: Pick<Clipboard, "writeText">,
): Promise<boolean> {
  if (!clipboard) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
