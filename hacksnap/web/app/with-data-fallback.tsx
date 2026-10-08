import type { ReactNode } from "react";
import { availableData } from "../lib/data-availability";
import { DataUnavailable } from "./data-unavailable";
import { readPrimaryContent } from "../lib/primary-content";
import { BrowseLayout } from "./topic-sidebar";

export function withDataFallback<Props>(page: (props: Props) => Promise<ReactNode>) {
  return async function PageWithDataFallback(props: Props) {
    const result = await readPrimaryContent(() => availableData(() => page(props)));
    return result.available ? (
      result.value
    ) : (
      <BrowseLayout>
        <DataUnavailable />
      </BrowseLayout>
    );
  };
}
