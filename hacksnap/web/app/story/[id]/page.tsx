import StoryPage, { generateMetadata as storyMetadata, type StoryRouteProps } from "./story-page";
import { storyISREnabled } from "../../../lib/publication-cache";

export const revalidate = 300;
export const generateStaticParams = storyISREnabled() ? () => [] : undefined;

export function generateMetadata(props: StoryRouteProps) {
  return storyMetadata(props);
}
export default function Page(props: StoryRouteProps) {
  return StoryPage(props);
}
