import { SEARCH_PARAMS, type SearchOptions } from "@/lib/api";
import { getSearchEngine } from "@/lib/corpus";

export const dynamic = "force-dynamic";

/** GET /api/search?q=&year=&animal=&region=&topic=&sort=relevance|newest|oldest|animal&limit=1-50 */
export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const options: SearchOptions = Object.fromEntries(SEARCH_PARAMS.map((name) => [name, params.get(name) ?? ""]));
  try {
    return Response.json(getSearchEngine().search(options));
  } catch (error) {
    // Keep the server alive and tell the browser what happened.
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
