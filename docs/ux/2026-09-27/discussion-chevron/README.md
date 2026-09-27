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
