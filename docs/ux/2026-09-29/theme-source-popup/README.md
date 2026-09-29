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
