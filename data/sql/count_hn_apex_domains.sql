-- Approximate registrable domains using the common multipart suffixes below.
-- Usage: SELECT * FROM public.count_hn_apex_domains()
--        ORDER BY occurrences DESC, apex_domain;
CREATE OR REPLACE FUNCTION public.count_hn_apex_domains()
RETURNS TABLE (apex_domain text, occurrences bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH hosts AS (
    SELECT rtrim(
      substring(
        lower(trim(url))
        FROM '^(?:https?://|//)(?:[^/@]+@)?([^/:?#]+)'
      ),
      '.'
    ) AS host
    FROM public.hacker_news_threads
    WHERE url IS NOT NULL
  ),
  domains AS (
    SELECT coalesce(
      substring(
        host FROM
        '[^.]+[.](?:co[.]uk|org[.]uk|ac[.]uk|com[.]au|net[.]au|org[.]au|co[.]nz|co[.]jp|co[.]in|com[.]br|com[.]cn)$'
      ),
      substring(host FROM '[^.]+[.][^.]+$')
    ) AS apex_domain
    FROM hosts
    WHERE host IS NOT NULL
      AND host !~ '^[0-9.]+$'
      AND host !~ '[:\[\]]'
  )
  SELECT domains.apex_domain, count(*) AS occurrences
  FROM domains
  WHERE domains.apex_domain IS NOT NULL
  GROUP BY domains.apex_domain
  ORDER BY occurrences DESC, domains.apex_domain;
$$;
