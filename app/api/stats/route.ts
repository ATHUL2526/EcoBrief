import { getSearchEngine } from "@/lib/corpus";

export const dynamic = "force-dynamic";

/** GET /api/stats: paper count, publication years and animal groups with paper counts. */
export function GET() {
  try {
    return Response.json(getSearchEngine().stats());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
