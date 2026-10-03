"""Deterministic thread selection and complete serialized-budget regressions."""
import copy
import json
import random

import pytest

from pipeline.config import Settings
from pipeline.preprocess import DEFAULT_COMMENT_CHARS, prepare_comments
from pipeline.prompts import DISCUSSION_REFRESH_PROMPT, SYSTEM_PROMPT


def entry(cid, parent=1000, text="A substantive argument.", **flags):
    return {"depth": 1 if parent == 1000 else 2,
            "item": {"id": cid, "parent": parent, "text": text, **flags}}


def payload(*comments):
    return {"story": {"id": 1000}, "comments": list(comments)}


def ids(comments):
    return [comment["id"] for comment in comments]


def size(comments):
    return len(json.dumps(comments, ensure_ascii=False))


def test_four_roots_rank_by_all_retained_descendants_and_id_not_text_length():
    data = payload(*(entry(i, text="Longer root " * (10 - i)) for i in range(1, 7)),
                   entry(70, 6), entry(71, 70), entry(72, 71),
                   entry(80, 5), entry(81, 80), entry(90, 4), entry(91, 3))
    comments, coverage = prepare_comments(data)
    assert [c["id"] for c in comments if c["parent"] == 1000] == [6, 5, 3, 4]
    assert set(ids(comments)) == {6, 70, 71, 72, 5, 80, 81, 3, 91, 4, 90}
    assert coverage == {"stored_comments": 13, "included_comments": 11,
                        "comments_truncated": True}
    random.Random(193).shuffle(data["comments"])
    assert prepare_comments(data) == (comments, coverage)


def test_active_reply_branch_wins_and_ancestors_precede_children():
    data = payload(entry(1), entry(2, 1), entry(3, 1), entry(4, 3), entry(5, 4))
    all_comments, _ = prepare_comments(data)
    budget = size([c for c in all_comments if c["id"] in {1, 3, 4}])
    comments, coverage = prepare_comments(data, budget)
    assert ids(comments) == [1, 3, 4]
    assert size(comments) == budget
    assert coverage["comments_truncated"]


def test_root_context_is_reserved_before_replies():
    data = payload(entry(1), entry(2), entry(3, 1), entry(4, 3), entry(5, 4))
    all_comments, _ = prepare_comments(data)
    budget = size([c for c in all_comments if c["id"] in {1, 2}])
    assert ids(prepare_comments(data, budget)[0]) == [1, 2]


def test_deleted_root_and_dead_parent_preserve_thread_membership_without_their_text():
    data = payload(entry(1, deleted=True), entry(2, 1, dead=True), entry(3, 2),
                   entry(4), entry(5, 4, text="<p> </p>"), entry(6, 5))
    comments, coverage = prepare_comments(data)
    assert ids(comments) == [3, 4, 6]
    assert coverage == {"stored_comments": 3, "included_comments": 3,
                        "comments_truncated": False}


def test_orphans_and_cycles_are_not_promoted_to_top_level_threads():
    data = payload(entry(1), entry(2, 999), entry(3, 4), entry(4, 3))
    comments, coverage = prepare_comments(data)
    assert ids(comments) == [1]
    assert coverage["stored_comments"] == 4
    assert coverage["comments_truncated"]


@pytest.mark.parametrize("data", [payload(), payload(entry(1, deleted=True)),
                                  payload(entry(1, dead=True)), payload(entry(1, text=" "))])
def test_empty_unusable_inputs(data):
    assert prepare_comments(data, 2) == ([], {
        "stored_comments": 0, "included_comments": 0, "comments_truncated": False,
    })


@pytest.mark.parametrize("budget", [-1, 0, 1])
def test_impossible_budgets_are_rejected(budget):
    with pytest.raises(ValueError, match="empty JSON list"):
        prepare_comments(payload(), budget)


def test_oversized_root_never_leaves_usable_replies_without_parent_context():
    comments, coverage = prepare_comments(payload(entry(1, text="x" * 13000), entry(2, 1)))
    assert comments == []
    assert coverage == {"stored_comments": 2, "included_comments": 0,
                        "comments_truncated": True}


def test_oversized_branch_does_not_block_smaller_branches():
    data = payload(entry(1), entry(2, 1, text="x" * 13000), entry(3, 2), entry(4, 1))
    assert ids(prepare_comments(data)[0]) == [1, 4]


def test_all_budget_boundaries_include_metadata_escaping_and_list_overhead():
    data = payload(entry(1, text='Quotes " \\ café 😄', by='author " \\'),
                   entry(2, 1, text='Reply " \\'), entry(3, text="Other root"))
    original = copy.deepcopy(data)
    complete, _ = prepare_comments(data)
    for budget in range(2, size(complete) + 2):
        comments, coverage = prepare_comments(data, budget)
        assert size(comments) <= budget
        assert coverage["included_comments"] == len(comments)
        assert coverage["comments_truncated"] == (len(comments) < 3)
        if 2 in ids(comments):
            assert ids(comments).index(1) < ids(comments).index(2)
    assert prepare_comments(data, size(complete))[0] == complete
    assert data == original


def test_default_budget_is_shared_by_settings_and_selector():
    assert DEFAULT_COMMENT_CHARS == 12000
    assert Settings.__dataclass_fields__["comment_chars"].default == DEFAULT_COMMENT_CHARS
    data = payload(entry(1, text="x" * 11900), entry(2, 1, text="y" * 1000))
    comments, coverage = prepare_comments(data)
    assert size(comments) <= 12000
    assert coverage["comments_truncated"]


def test_both_prompts_explain_sample_activity_and_avoid_forced_balance():
    for prompt in [SYSTEM_PROMPT, DISCUSSION_REFRESH_PROMPT]:
        assert "at most four top-level threads" in prompt
        assert "Do not require an opposing" in prompt
        assert "sample cannot represent the whole" in prompt
        assert "Never infer majority opinion" in prompt
