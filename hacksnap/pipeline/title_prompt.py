TITLE_PROMPT = """
title is the published headline, distinct from the supplied source title. Write one
catchy, specific headline with strong copy: name the subject and use a concrete verb.
Create curiosity through the most surprising supported finding, consequence or tension
in the summary. Give the reader a reason to read without hiding the subject or making
a promise the summary cannot deliver. Prefer roughly 6–14 words, at most 160 characters.
Return plain text on a single line, without Markdown, a label or surrounding quotes.

Write the title after composing the summary, then check them together. Every headline
claim must be supported by the summary and its original sources. Preserve scope,
attribution and uncertainty when they change the meaning: a proposal is not a result,
a benchmark is not production evidence, and an anecdote is not a general finding.
Use the article's central development when available. For HN self-posts (article=null),
base the title on the supplied post and supported analysis, without implying an
external article. Title-only posts without usable source text or comments are skipped
before generation. An unusable retrieved page still follows the skip rules.

Avoid clickbait, vague teasers, inflated stakes, unsupported superlatives, rhetorical
questions and formulaic contrasts. Wit is welcome only when the facts earn it.
Keep overall_takeaway complementary: it adds a useful fact or qualification beyond
the headline rather than repeating it. Accuracy takes priority over a clever hook.
"""
