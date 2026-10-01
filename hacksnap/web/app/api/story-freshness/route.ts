import { getCurrentReadySelectionIds } from "../../../lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(
      { ids: await getCurrentReadySelectionIds() },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return Response.json(
      { error: "Story updates are temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
    );
  }
}
