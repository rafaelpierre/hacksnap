"use client";

import { useEffect, useState } from "react";

const options: Intl.DateTimeFormatOptions = {
  year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short",
};

export function StoryAddedTime({dateTime}: {dateTime: string}) {
  // A stable UTC fallback keeps server rendering and hydration consistent.
  const [local, setLocal] = useState<{dateTime: string; label: string} | null>(null);
  useEffect(() => {
    setLocal({dateTime, label: new Intl.DateTimeFormat(undefined, options).format(new Date(dateTime))});
  }, [dateTime]);
  const label = local?.dateTime === dateTime ? local.label
    : new Intl.DateTimeFormat("en-GB", {...options, timeZone: "UTC"}).format(new Date(dateTime));
  return <time dateTime={dateTime}>{label}</time>;
}
