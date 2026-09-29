import {
  canonicalArticleImage,
  type ArticleImage,
  type CanonicalArticleImage,
} from "./article-image";

export type StoryImageFields = ArticleImage & {
  hn_id: string;
};

export type ReadyStoryImage = CanonicalArticleImage;

// Story previews and page images share one public-image boundary. Older ready
// Blob objects have proportional dimensions and do not need the newer hero name.
export function readyStoryImage(story: StoryImageFields): ReadyStoryImage | null {
  return canonicalArticleImage(story);
}
