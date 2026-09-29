import "server-only";
import { ReadyStoryPageError } from "./ready-story-pagination-errors";

export { ReadyStoryPageError } from "./ready-story-pagination-errors";

export const READY_STORY_PAGE_SIZE = 10;
export const MAX_READY_STORY_PAGE_SIZE = 10;
export const MAX_READY_STORY_SNAPSHOT_SIZE = 400;
export const MAX_READY_STORY_CURSOR_LENGTH = 6_000;
// A fixed deadline survives a typical reading session and never extends on use.
export const READY_STORY_CURSOR_TTL_MS = 8 * 60 * 60_000;

const CURSOR_VERSION = 2;
const HEADER_BYTES = 19;

export type ReadyStorySnapshotItem = {
  hn_id: string;
  rank: string;
  is_recent: boolean;
};

export type ReadyStoryCursor = {
  items: ReadyStorySnapshotItem[];
  offset: number;
  pageSize: number;
  expiresAt: string;
  observedAt: string;
  ingestion: string | null;
  selectionLimited: boolean;
};

function writeUint32(value: number, bytes: number[]) {
  bytes.push((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
}

function readUint32(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] * 2 ** 24 +
    bytes[offset + 1] * 2 ** 16 +
    bytes[offset + 2] * 2 ** 8 +
    bytes[offset + 3]
  );
}

function writeVarint(value: number, bytes: number[]) {
  while (value >= 128) {
    bytes.push((value % 128) + 128);
    value = Math.floor(value / 128);
  }
  bytes.push(value);
}

function readVarint(bytes: Uint8Array, start: number): [number, number] | null {
  let value = 0;
  let multiplier = 1;
  for (let offset = start; offset < bytes.length && offset - start < 8; offset++) {
    const byte = bytes[offset];
    value += (byte & 127) * multiplier;
    if ((byte & 128) === 0) return [value, offset + 1];
    multiplier *= 128;
  }
  return null;
}

function validItem(item: ReadyStorySnapshotItem) {
  return (
    /^[1-9][0-9]{0,14}$/.test(item.hn_id) &&
    /^[1-9][0-9]{0,14}$/.test(item.rank) &&
    Number.isSafeInteger(Number(item.rank))
  );
}

function validSnapshot(items: ReadyStorySnapshotItem[]) {
  const ids = new Set<string>();
  let previousRank = 0;
  return items.every((item) => {
    const rank = Number(item.rank);
    if (!validItem(item) || ids.has(item.hn_id) || rank <= previousRank) return false;
    ids.add(item.hn_id);
    previousRank = rank;
    return true;
  });
}

function encodeBytes(cursor: Omit<ReadyStoryCursor, "expiresAt"> & { expiresAtMs: number }) {
  if (
    cursor.items.length === 0 ||
    cursor.items.length > MAX_READY_STORY_SNAPSHOT_SIZE ||
    !validPageSize(cursor.pageSize) ||
    !Number.isInteger(cursor.offset) ||
    cursor.offset % cursor.pageSize !== 0 ||
    cursor.offset < 0 ||
    cursor.offset >= cursor.items.length ||
    !Number.isSafeInteger(cursor.expiresAtMs) ||
    cursor.expiresAtMs <= 0
  )
    throw new ReadyStoryPageError("invalid_cursor");
  const expiry = Math.floor(cursor.expiresAtMs / 1000);
  const observed = Math.floor(Date.parse(cursor.observedAt) / 1000);
  const ingestion = cursor.ingestion ? Math.floor(Date.parse(cursor.ingestion) / 1000) : 0;
  if (
    !Number.isSafeInteger(expiry) ||
    expiry > 0xffffffff ||
    !Number.isSafeInteger(observed) ||
    !Number.isSafeInteger(ingestion)
  )
    throw new ReadyStoryPageError("invalid_cursor");

  const bytes = [
    CURSOR_VERSION,
    cursor.selectionLimited ? 1 : 0,
    cursor.items.length >> 8,
    cursor.items.length & 255,
    cursor.offset >> 8,
    cursor.offset & 255,
  ];
  writeUint32(expiry, bytes);
  writeUint32(observed, bytes);
  writeUint32(ingestion, bytes);
  bytes.push(cursor.pageSize);
  if (!validSnapshot(cursor.items)) throw new ReadyStoryPageError("invalid_cursor");
  for (const item of cursor.items) {
    writeVarint(Number(item.hn_id), bytes);
    writeVarint(Number(item.rank) * 2 + Number(item.is_recent), bytes);
  }
  return Buffer.from(bytes).toString("base64url");
}

export function createReadyStoryCursor(
  input: Omit<ReadyStoryCursor, "expiresAt"> & { expiresAt?: Date },
): string {
  const cursor = encodeBytes({
    ...input,
    expiresAtMs: (input.expiresAt ?? new Date(Date.now() + READY_STORY_CURSOR_TTL_MS)).getTime(),
  });
  if (cursor.length > MAX_READY_STORY_CURSOR_LENGTH)
    throw new ReadyStoryPageError("invalid_cursor");
  return cursor;
}

export function parseReadyStoryCursor(value: string, now = Date.now()): ReadyStoryCursor {
  if (!/^[A-Za-z0-9_-]{1,6000}$/.test(value)) throw new ReadyStoryPageError("invalid_cursor");
  let bytes: Uint8Array;
  try {
    bytes = Buffer.from(value, "base64url");
  } catch {
    throw new ReadyStoryPageError("invalid_cursor");
  }
  if (Buffer.from(bytes).toString("base64url") !== value)
    throw new ReadyStoryPageError("invalid_cursor");
  if (bytes.length < HEADER_BYTES || bytes[0] !== CURSOR_VERSION || (bytes[1] & ~1) !== 0)
    throw new ReadyStoryPageError("invalid_cursor");
  const count = bytes[2] * 256 + bytes[3];
  const offset = bytes[4] * 256 + bytes[5];
  const expiresAtMs = readUint32(bytes, 6) * 1000;
  const observedSeconds = readUint32(bytes, 10);
  const ingestionSeconds = readUint32(bytes, 14);
  const pageSize = bytes[18];
  if (
    !count ||
    count > MAX_READY_STORY_SNAPSHOT_SIZE ||
    offset >= count ||
    !validPageSize(pageSize) ||
    offset % pageSize !== 0
  )
    throw new ReadyStoryPageError("invalid_cursor");
  if (expiresAtMs <= now) throw new ReadyStoryPageError("snapshot_expired");
  if (expiresAtMs > now + READY_STORY_CURSOR_TTL_MS + 60_000)
    throw new ReadyStoryPageError("invalid_cursor");

  let position = HEADER_BYTES;
  const items: ReadyStorySnapshotItem[] = [];
  for (let index = 0; index < count; index++) {
    const id = readVarint(bytes, position);
    if (!id) throw new ReadyStoryPageError("invalid_cursor");
    const rank = readVarint(bytes, id[1]);
    if (!rank) throw new ReadyStoryPageError("invalid_cursor");
    position = rank[1];
    const rankValue = Math.floor(rank[0] / 2);
    const item = {
      hn_id: String(id[0]),
      rank: String(rankValue),
      is_recent: rank[0] % 2 === 1,
    };
    items.push(item);
  }
  if (position !== bytes.length) throw new ReadyStoryPageError("invalid_cursor");
  if (!validSnapshot(items)) throw new ReadyStoryPageError("invalid_cursor");
  return {
    items,
    offset,
    pageSize,
    expiresAt: new Date(expiresAtMs).toISOString(),
    observedAt: new Date(observedSeconds * 1000).toISOString(),
    ingestion: ingestionSeconds ? new Date(ingestionSeconds * 1000).toISOString() : null,
    selectionLimited: bytes[1] === 1,
  };
}

function validPageSize(value: number) {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_READY_STORY_PAGE_SIZE;
}

export function assertReadyStoryPageSize(value: number | undefined) {
  if (value === undefined) return READY_STORY_PAGE_SIZE;
  if (!validPageSize(value)) throw new ReadyStoryPageError("invalid_page_size");
  return value;
}

export function assertReadyStoryPage(value: number | undefined) {
  if (value === undefined) return 1;
  if (!Number.isSafeInteger(value) || value < 1) throw new ReadyStoryPageError("invalid_page");
  return value;
}
