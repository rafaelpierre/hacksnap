"""Archive ordering index follows the browser's stable pagination order."""

from io import StringIO

from alembic.migration import MigrationContext
from alembic.operations import Operations

from test_discussion_migration import load_migration


def render(direction: str) -> str:
    output = StringIO()
    context = MigrationContext.configure(
        dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output}
    )
    migration = load_migration("0017_archive_order.py")
    with Operations.context(context):
        getattr(migration, direction)()
    return output.getvalue()


def test_archive_order_index_and_rollback():
    migration = load_migration("0017_archive_order.py")
    assert migration.down_revision == "0016_image_queue"
    assert "CREATE INDEX hn_archive_date_idx ON hacker_news_threads" in render("upgrade")
    assert "(date_added DESC, hn_id DESC)" in render("upgrade")
    assert "DROP INDEX hn_archive_date_idx" in render("downgrade")
