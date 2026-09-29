export type ArticleImage = {
  image_url?: string | null;
  image_status?: string | null;
  image_width?: number | null;
  image_height?: number | null;
  image_mime_type?: string | null;
};

export type CanonicalArticleImage = {
  url: string;
  width: number;
  height: number;
  mimeType: string;
};

const BLOB_HOST = /^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/i;

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/**
 * The database stores publisher provenance privately. Only a ready image copied
 * into the public Blob store can enter the reader-facing contract.
 */
export function canonicalArticleImage(image: ArticleImage): CanonicalArticleImage | null {
  if (image.image_status !== "ready" || typeof image.image_url !== "string") return null;
  try {
    const url = new URL(image.image_url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !BLOB_HOST.test(url.hostname) ||
      !url.pathname.startsWith("/articles/") ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    const width = positiveInteger(image.image_width);
    const height = positiveInteger(image.image_height);
    const mimeType =
      typeof image.image_mime_type === "string" && image.image_mime_type.startsWith("image/")
        ? image.image_mime_type
        : undefined;
    if (!width || !height || !mimeType) return null;
    return {
      url: url.toString(),
      width,
      height,
      mimeType,
    };
  } catch {
    return null;
  }
}
