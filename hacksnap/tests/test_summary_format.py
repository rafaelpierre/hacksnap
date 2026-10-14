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
