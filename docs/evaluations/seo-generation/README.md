# SEO generation limits smoke test

On 2026-10-16, the original 3,000-token configuration failed on all three sampled
stories with `finish_reason=length`. Raising the budget alone produced descriptions
of 187, 198 and 300 characters, beyond the intended editorial target.

The revised production agent uses a 10,000-token completion budget, a schema limit
of 160 description characters, and the `v2-concise-search-metadata` prompt. The
same three stored sources were passed to the agent concurrently in a temporary
Modal app, with no runtime overrides, retries, clipping or database writes.

[Saved outputs](metadata-limits.json) passed validation in all three cases, with
description lengths of 144, 159 and 137 characters. Titles were 55, 63 and 68
characters; the last is above the advisory title target, which permits necessary
qualifications. Completion usage was 1,645, 6,570 and 3,405 tokens respectively.
All jobs finished within the existing 65-second limit, including prefix waiting.

Manual comparison with the supplied summaries found that the scanner description
now limits USB trace diffing to the scanner example, the interpretability result
remains attributed to Cammarata, and the model release description selects a
single set of specifications without appending the discussion debate. This small
sample demonstrates recovery of the reported failures, not broad factual accuracy
or search ranking improvements. No metadata was published during this test.

[Modal run](https://modal.com/apps/rafaelpierre/main/ap-vT228VFj9bZCclqBEu4NtI)

The diagnostic also confirmed that `HACKSNAP_PUBLICATION_WEBHOOK_URL` and
`HACKSNAP_PUBLICATION_SECRET` are both absent in the Modal `hacksnap` secret.
Publication dispatch is therefore disabled by configuration. Enabling that
optional integration requires configuring the matching secret on the website
as described in `hacksnap/web/README.md`; this test did not change those settings
or verify the website's cache flags.
