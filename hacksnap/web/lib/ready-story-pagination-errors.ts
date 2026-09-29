export type ReadyStoryPageErrorCode =
  | "invalid_page"
  | "invalid_page_size"
  | "invalid_cursor"
  | "snapshot_expired"
  | "snapshot_invalidated";

export class ReadyStoryPageError extends Error {
  constructor(readonly code: ReadyStoryPageErrorCode) {
    super(code.replaceAll("_", " "));
    this.name = "ReadyStoryPageError";
  }

  get status() {
    return this.code.startsWith("snapshot_") ? 410 : 400;
  }
}
