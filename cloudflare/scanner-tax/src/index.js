const PROBE_PATTERNS = [
  // Environment files, including nested paths and variants such as .env.local.
  /(?:^|\/)\.env(?:\.|\/|$)/,
  /(?:^|\/)\.(?:bashrc|zshrc|bash_profile|zprofile)(?:\/|$)/,
  /(?:^|\/)(?:agents?|gemini|qwen)\.md(?:\/|$)/,
  /(?:^|\/)wp-(?:admin|login|config)(?:\.php)?(?:\/|$)/,
  /(?:^|\/)wp-includes\/wlwmanifest\.xml(?:\/|$)/,
  /(?:^|\/)xmlrpc\.php(?:\/|$)/,
];

function normalizePath(pathname) {
  let path = pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // A malformed escape must not turn a request into a Worker exception.
  }
  return path.replace(/\/{2,}/g, "/").toLowerCase();
}

function scannerResponse(path, method) {
  // Keep attacker-controlled paths short and remove control/bidi characters.
  const safePath = path.slice(0, 200).replace(
    /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028-\u202e\u2066-\u2069]/g,
    "?",
  );
  const message = String.raw`
+--------------------------------------------------+
|                  HTTP 402                         |
|               PAYMENT REQUIRED                    |
+--------------------------------------------------+

Oh, hello there, scanner.

You requested:
    ${safePath}

Welcome to our premium secret-file retrieval service.

+----------------------------------------+
|           SCANNER TAX INVOICE           |
+----------------------------------------+
| Secret file discovery       GBP 404,000  |
| Being annoying              GBP     402  |
| Wasting everyone's time     GBP     999  |
+----------------------------------------+
| TOTAL DUE                   GBP 405,401  |
+----------------------------------------+

Payment methods accepted:
    [ ] Visa
    [ ] Mastercard
    [ ] Bitcoin
    [x] Going away

Files successfully obtained: ABSOLUTELY NOTHING.

              .-.
             (o.o)
              |=|
             __|__
           //.=|=.\\
          // .=|=. \\
          \\ .=|=. //
           \\(_=_)//
            (:| |:)
             || ||
             () ()
             || ||
            ==' '==

Your request was terminated at the edge.
Please insert payment and try never again.
`;

  return new Response(method === "HEAD" ? null : message, {
    status: 402,
    statusText: "Payment Required",
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "X-Content-Type-Options": "nosniff",
      "X-Scanner-Tax": "unpaid",
    },
  });
}

export default {
  async fetch(request) {
    const path = normalizePath(new URL(request.url).pathname);
    if (PROBE_PATTERNS.some(pattern => pattern.test(path))) {
      return scannerResponse(path, request.method);
    }

    // A Cloudflare Route forwards this unchanged request to the existing origin.
    return fetch(request);
  },
};
