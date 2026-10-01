from pathlib import Path
import subprocess
import sys

repository = Path(sys.argv[1]).resolve()
output = Path(sys.argv[2]).resolve()
fixture = repository / "docs/ux/2026-10-01/issue-178/prepare-preview.py"
subprocess.run([sys.executable, str(fixture), str(repository), str(output)], check=True)

data = output / "lib/data.ts"
source = data.read_text()
source = source.replace(
    "rank_history: [], image_url: null, image_status: null,",
    """rank_history: [],
  ...(i === 0 ? { image_url: 'https://store.public.blob.vercel-storage.com/articles/100.webp', image_status: 'ready', image_width: 1200, image_height: 675, image_mime_type: 'image/webp' } : {}),""",
)
source = source.replace("summary: { overall_takeaway:", "summary: i === 4 ? null : { overall_takeaway:")
data.write_text(source)
print(output)
