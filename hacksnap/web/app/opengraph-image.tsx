import { ogImage } from "../lib/og-image";

export const alt = "Hacksnap — AI on Hacker News. The articles and the arguments worth reading.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return ogImage();
}
