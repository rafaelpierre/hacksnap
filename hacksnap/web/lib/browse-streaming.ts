import { headers } from "next/headers";

// React's streamed Suspense content needs JavaScript to replace its fallback.
// Browser fetches (including client-router navigation) use destination "empty";
// full documents and clients without Fetch Metadata keep readable blocking HTML.
// Next hides its internal RSC header from the userland headers() view.
export async function shouldStreamBrowse() {
  return (await headers()).get("sec-fetch-dest") === "empty";
}
