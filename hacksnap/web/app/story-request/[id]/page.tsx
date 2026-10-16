import { connection } from "next/server";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import StoryPage, {
  generateMetadata as storyMetadata,
  type StoryRouteProps,
} from "../../story/[id]/story-page";

async function requestOnly() {
  await connection();
  if ((await headers()).get("x-hacksnap-story-request") !== "1") notFound();
}

export async function generateMetadata(props: StoryRouteProps) {
  await requestOnly();
  return storyMetadata({ ...props, requestTime: true });
}

export default async function Page(props: StoryRouteProps) {
  await requestOnly();
  return StoryPage({ ...props, requestTime: true });
}
