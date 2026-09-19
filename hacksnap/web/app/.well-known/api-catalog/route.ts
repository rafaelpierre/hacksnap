const catalogURL = "https://hacksnap.live/.well-known/api-catalog";
const apiURL = "https://hacksnap.live/api/stories";
const headers = {
  "Content-Type": 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
  "Link": `<${catalogURL}>; rel="api-catalog"`,
  "Cache-Control": "public, max-age=3600",
};

export function GET() {
  return Response.json({linkset: [
    {anchor: catalogURL, item: [{href: apiURL, type: "application/json"}]},
    {
      anchor: apiURL,
      "service-desc": [{href: "https://hacksnap.live/openapi.json", type: "application/vnd.oai.openapi+json"}],
      "service-doc": [{href: "https://hacksnap.live/docs/api", type: "text/html"}],
    },
  ]}, {headers});
}

export function HEAD() {
  return new Response(null, {headers});
}
