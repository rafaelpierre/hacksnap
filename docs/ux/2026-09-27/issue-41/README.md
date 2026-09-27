# Issue 41: API documentation checks

Inspected `/docs/api` from the production build on localhost:3441 in Chrome.
Screenshots show the new discussion-analysis section at 1280px and 320px,
in light and dark themes, with root text enlarged to 200% (32px).
All four cases have document scroll width equal to viewport width. Long API
field names wrap without horizontal overflow. No controls or navigation changed.
The ordinary desktop layout and negotiated Markdown documentation were also checked.

- [Desktop, light](api-docs-1280-light-200.png)
- [Desktop, dark](api-docs-1280-dark-200.png)
- [Mobile, light](api-docs-320-light-200.png)
- [Mobile, dark](api-docs-320-dark-200.png)
