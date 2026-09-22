"use client";

import { useEffect, useState } from "react";
import { timestamp } from "../lib/format";

export function LocalTime({ dateTime }: { dateTime: string }) {
  const [local, setLocal] = useState<{ dateTime: string; label: string } | null>(null);

  useEffect(() => {
    // Omit locale and timeZone to use the visitor's browser preferences.
    const label = new Intl.DateTimeFormat(undefined, {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(dateTime));
    setLocal({ dateTime, label });
  }, [dateTime]);

  // Match the server HTML until mounted, and retain UTC without JavaScript.
  return <time dateTime={dateTime}>{local?.dateTime === dateTime ? local.label : timestamp(dateTime)}</time>;
}
