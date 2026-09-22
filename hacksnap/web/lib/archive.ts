export const ARCHIVE_PAGE_SIZE = 30;

export function archivePage(value: string | string[] | undefined): number | null {
  if (value === undefined) return 1;
  if (typeof value !== "string" || !/^[1-9]\d{0,6}$/.test(value)) return null;
  return Number(value);
}

export function archiveMonth(path: string[] = []): string | null {
  if (path.length !== 2 || !/^[1-9]\d{3}$/.test(path[0]) || !/^(0[1-9]|1[0-2])$/.test(path[1])) return null;
  return path.join("-");
}

export function monthBounds(month: string): [string, string] {
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return [start.toISOString(), end.toISOString()];
}

export function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", {month: "long", year: "numeric", timeZone: "UTC"});
}

export function archiveURL(month: string | null, page = 1): string {
  const base = month ? `/archive/${month.replace("-", "/")}` : "/archive";
  return page === 1 ? base : `${base}?page=${page}`;
}

export const archiveMonthsSQL = `SELECT to_char(date_added AT TIME ZONE 'UTC', 'YYYY-MM') AS month,
  count(*)::int AS count FROM hacker_news_threads
  WHERE hn_id BETWEEN 1 AND 999999999999999
  GROUP BY 1 ORDER BY 1 DESC`;

export function archiveQuery(fields: string, month: string | null, page: number) {
  const values: (string | number)[] = month ? monthBounds(month) : [];
  const range = month ? "AND t.date_added >= $1::timestamptz AND t.date_added < $2::timestamptz" : "";
  values.push(ARCHIVE_PAGE_SIZE + 1, (page - 1) * ARCHIVE_PAGE_SIZE);
  return {text: `SELECT ${fields} FROM hacker_news_threads t
    LEFT JOIN hacksnap_summaries s ON s.story_id = t.hn_id
    WHERE t.hn_id BETWEEN 1 AND 999999999999999 ${range}
    ORDER BY t.date_added DESC, t.hn_id DESC
    LIMIT $${values.length - 1} OFFSET $${values.length}`, values};
}
