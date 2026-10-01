"use client";

import Link, { useLinkStatus } from "next/link";
import type { ComponentProps } from "react";
import styles from "./navigation-pending-link.module.css";

type NavigationPendingLinkProps = ComponentProps<typeof Link> & {
  pendingLabel?: string;
};

/**
 * Keeps navigation as an ordinary link while showing feedback for the one link
 * whose client-side transition is still in flight.
 */
export function NavigationPendingLink({
  children,
  pendingLabel = "Loading destination…",
  className,
  ...props
}: NavigationPendingLinkProps) {
  return (
    <Link {...props} className={[className, styles.link].filter(Boolean).join(" ")}>
      {children}
      <NavigationPendingHint label={pendingLabel} />
    </Link>
  );
}

function NavigationPendingHint({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return (
    <>
      <span
        className={styles.hint}
        data-pending={pending ? "true" : undefined}
        aria-hidden="true"
      />
      {pending && (
        <span className={styles.announcement} role="status" aria-live="polite">
          {label}
        </span>
      )}
    </>
  );
}
