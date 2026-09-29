# Share menu destinations

The reusable Share menu is available on feed rows and at both story-page Share actions. Copy link always uses the canonical `https://hacksnap.live/story/{id}` address. The suggested post starts from the headline and takeaway; pending summaries get a complete readable draft. Readers can edit the post before copying or opening a text-capable destination.

The initial destinations are X, LinkedIn and Email. X and Email receive the current edited text. The menu uses the official twitter-text weighted count, including URL transformation, to prevent opening X when the draft exceeds 280 characters; readers can shorten the draft without changing the text available for copying or Email. LinkedIn's share endpoint only accepts a URL, so it receives the canonical story address for its preview; readers can copy their edited post separately and paste it there. Opening a destination is navigation to a compose/share surface, not a publication confirmation.

The feed initially mounts a small Share trigger. Opening it loads the post editor and X parser on demand; the first-open loading state still offers Copy link, LinkedIn, Email, and Copy suggested post. If the editor fails to load, those options remain available and the menu offers a retry. Closing and reopening keeps any edits to the draft while the story component remains mounted.

If clipboard writing fails or is unavailable, the menu exposes the exact requested link or post in a selected, read-only field for manual copying. Success feedback appears only after the write resolves.
