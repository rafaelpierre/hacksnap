# Discussion theme chevron

The native disclosure triangle is replaced with Lucide's ChevronDown, following
shadcn's accordion convention. It sits at the trailing edge and rotates when open.
Native details/summary retains keyboard and no-JavaScript behavior. Reduced motion
removes the transition; long titles wrap while keeping the icon visible.

Checked the actual server-rendered component with the shared qualified-agreement
fixture and repository CSS in the in-app browser. Verified light/dark appearance,
320px and desktop layouts, 200% text, visible focus, Enter/Space toggling, and no
horizontal overflow at 320px. Screenshots use a temporary fixture page with system
fonts, not the complete production shell. No new dependency is added.

## Stance heading icons

Most critical and Most supportive use small Lucide ThumbsDown/ThumbsUp outlines.
Their 1em sizing follows the existing heading scale, muted color keeps the text
prominent, and aria-hidden avoids repeating the label for screen readers. Icons
are decorative, with no voting or button affordance. Checked both themes at desktop
and 320px, including 200% text and wrapped headings without horizontal overflow.
The thumbs screenshots use the shared reply-to-a-critic fixture with both groups.

## Coverage timestamp typography

The coverage timestamp inherits Source Sans 3 from its surrounding sentence,
removing the global monospace style within `.analysis-coverage`.
Verified matching computed font families and wrapping at desktop and 320px in
light and dark themes with 200% text. The isolated component preview uses the
bundled Source Sans 3 font; mobile has no horizontal overflow.
Screenshots: `metadata-desktop.png` (light) and `metadata-mobile.png` (dark).
