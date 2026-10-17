from pipeline import editorial_prompts, prompts
from pipeline.editorial_review import REVIEW_PROMPT
from pipeline.summary_format import SUMMARY_FORMAT_PROMPT


def test_generators_refreshes_and_reviewer_share_formatting_contract():
    for prompt in (
        editorial_prompts.SYSTEM_PROMPT,
        editorial_prompts.DISCUSSION_REFRESH_PROMPT,
        prompts.SYSTEM_PROMPT,
        prompts.DISCUSSION_REFRESH_PROMPT,
        REVIEW_PROMPT,
    ):
        assert SUMMARY_FORMAT_PROMPT in prompt
    assert "article_summary: one paragraph" not in editorial_prompts.SYSTEM_PROMPT
    assert "Write article_summary as one short paragraph" not in prompts.SYSTEM_PROMPT


def test_article_paragraph_limits_are_deterministic():
    from pipeline.summary_format import article_readability_issues

    assert article_readability_issues(None) == []
    assert article_readability_issues("A brief source.") == []
    assert article_readability_issues("word " * 60) == []
    assert "paragraph 1 exceeds 60" in article_readability_issues("word " * 61)[0]
    assert article_readability_issues("Short opening.\n\n" + "word " * 80) == []
    assert "paragraph 2 exceeds 80" in article_readability_issues(
        "Short opening.\n\n" + "word " * 81)[0]
    assert "missing whitespace" in article_readability_issues("April 1998.Claude recovered it.")[0]
    assert article_readability_issues("Node.js uses X9.62 and 3.14. Dr. Smith agrees.") == []

    assert "paragraph 1 exceeds 60" in article_readability_issues(
        "## Heading\n" + "word " * 61)[0]
    assert article_readability_issues(
        "See https://example.com/1998.Claude and `1998.Claude` or a.The@example.com.") == []
