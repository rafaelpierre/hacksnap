# Theme source popup

Screenshots render the actual DiscussionAnalysis component and global styles with
synthetic fixture data, local fonts, a long title, and twelve source links.

Verified in local Chrome at 1280px and 320px, light and dark, and 100% and 200%
root text size. Popups stayed within the viewport without horizontal overflow.
The list scrolls when its height exceeds the available space.

Keyboard checks: Enter opens the popup and focuses its X button; Tab reaches the
first source link; Escape closes it and restores focus to its info icon. The X
button and outside click dismiss the popup. Opening sources leaves the theme's
summary collapsed. This preview contains no JavaScript.

- `desktop-light.png`: 1280px, light, 100% text.
- `mobile-dark-200.png`: 320px, dark, 200% text.

## Critical and supportive highlights

The extended fixture includes both groups. Each begins with the addressed claim
in italics, followed by the stance, paraphrase, and explanation. Original comment
links are inside the shared popup, with separate targets for each highlight.

Verified both popup controls with Enter, Tab to the original comment, Escape,
focus restoration, and the close button. Both groups' popups fit at 320px and
1280px in light/dark at 100% and 200% text, without horizontal overflow.

- `highlights-desktop.png`: both groups in light mode, with popups closed.
- `highlight-popup-mobile.png`: critical comment popup in dark mode at 320px.

## Theme icon placement

The source icon follows the theme title; the expansion chevron stays at the far
right. Verified pointer clicks open only the intended popup or disclosure.
CSS anchors keep the controls as separate native interactive elements.
The existing trailing placement remains the fallback without anchor support.

At extreme text enlargement in a narrow container, controls wrap below the title
so the full title retains readable line lengths and both targets remain distinct.
Checked light/dark at 320px and 1280px with normal and 200% text.

- `theme-icons-mobile.png`: title-adjacent source icons at 320px.
- `theme-icons-enlarged.png`: controls wrap below titles at 320px and 200% text.
