-- Count full hostnames, preserving subdomains and excluding ports.
-- Usage: SELECT * FROM public.count_hn_domains()
--        ORDER BY occurrences DESC, domain;
CREATE OR REPLACE FUNCTION public.count_hn_domains()
RETURNS TABLE (domain text, occurrences bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH hosts AS (
    SELECT rtrim(
      substring(
        lower(trim(url))
        FROM '^(?:https?://|//)(?:[^/@]+@)?(\[[^]]+\]|[^/:?#]+)'
      ),
      '.'
    ) AS domain
    FROM public.hacker_news_threads
    WHERE url IS NOT NULL
  )
  SELECT hosts.domain, count(*) AS occurrences
  FROM hosts
  WHERE hosts.domain IS NOT NULL
  GROUP BY hosts.domain
  ORDER BY occurrences DESC, hosts.domain;
$$;
