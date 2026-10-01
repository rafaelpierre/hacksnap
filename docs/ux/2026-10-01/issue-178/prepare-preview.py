from pathlib import Path
import shutil, sys
root=Path(sys.argv[1]).resolve()
out=Path(sys.argv[2]).resolve()
out.mkdir(exist_ok=True)
shutil.copytree(root/'hacksnap/web',out,dirs_exist_ok=True,ignore=shutil.ignore_patterns('node_modules','.next','.env*'))
if not (out/'node_modules').exists(): (out/'node_modules').symlink_to(root/'hacksnap/web/node_modules',target_is_directory=True)
p=out/'lib/data.ts'
s=p.read_text()
helper='''
const previewStories = Array.from({ length: 5 }, (_, i) => ({
  hn_id: String(100 + i), story_slug: `preview-story-${100+i}`,
  title: ['A practical guide to building reliable agents', 'Small models take on useful coding tasks', 'Research teams compare evaluation methods', 'What changes when inference gets cheaper', 'The week in open source AI'][i],
  category: 'agents_coding', url: 'https://example.com/story', points: 100-i, comment_count: 20,
  date_added: new Date('2026-10-01T09:00:00Z'), rank: String(i+1), is_recent: true,
  rank_history: [], image_url: null, image_status: null,
  summary: { overall_takeaway: 'A controlled browser fixture for verifying story navigation, loading feedback, and readable layouts.', sentiment: 0, source_coverage: { stored_comments: 20, included_comments: 10, comments_truncated: false, article_status: 'fetched' } }
}));
async function previewDelay() { await new Promise(resolve => setTimeout(resolve, 1800)); }
'''
s += helper
marker='} = {}): Promise<ReadyStoryPage> {'
assert marker in s
s=s.replace(marker,marker+'''\n  await previewDelay();
  return { stories: previewStories, ingestion: new Date(), observed_at: new Date().toISOString(), pagination: {cursor: null, previousCursor: null, hasMore: false, page: 1, expiresAt: new Date(Date.now()+60000).toISOString(), selectionLimited: false} };
''',1)
for marker in ['export const getCategoryStories = cache(async (category: CategoryId, page: number) => {','export const getArchiveStories = cache(async (month: string | null, page: number) => {']:
 assert marker in s
 s=s.replace(marker,marker+'\n await previewDelay(); return { stories: previewStories, hasNext: false };\n',1)
start=s.index('export const getArchiveMonths = cache(')
end=s.index('export const getCategoryStories',start)
s=s[:start]+'''export const getArchiveMonths = cache(async () => { await previewDelay(); return [{ month: '2026-10', count: 5 }]; });
export const getCategoryCounts = cache(async () => ({ agents_coding: 5 }));

'''+s[end:]
p.write_text(s)
print(out)
