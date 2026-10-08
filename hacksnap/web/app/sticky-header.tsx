import type { ReactNode } from "react";

/** The header stays in document flow so reading and restored scroll positions stay clear. */
export function SiteHeader({ children }: { children: ReactNode }) {
  return <header className="site-header">{children}</header>;
}
