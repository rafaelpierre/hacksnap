"""Optional cloud image check: uv run modal run tests/modal_smoke.py.

Builds the same Linux image as the scheduled job, without deploying a schedule
or accessing Supabase. Fetches only the public example.com fixture page.
"""

import modal

if modal.is_local():
    from modal_app import hacksnap_image
else:
    hacksnap_image = None

app = modal.App("hacksnap-image-check")


@app.function(image=hacksnap_image, timeout=120)
def check_image():
    import subprocess

    from pipeline.kestrel import KestrelFetcher

    version = subprocess.check_output(["kestrel", "--version"], text=True).strip()
    article = KestrelFetcher("kestrel").fetch("https://example.com")
    assert "Example Domain" in article
    return {"binary": version, "extracted_chars": len(article)}


@app.local_entrypoint()
def main():
    print(check_image.remote())
