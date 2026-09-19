import spec from "./spec.json";

export function GET() {
  return Response.json(spec, {headers: {"Content-Type": "application/vnd.oai.openapi+json", "Cache-Control": "public, max-age=3600"}});
}
