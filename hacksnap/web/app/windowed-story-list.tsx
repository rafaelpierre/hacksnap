"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import type { PublicFeedStory } from "../lib/stories-api";
import { StoryRow } from "./story-row";

const ESTIMATED_STORY_HEIGHT = 280;
const ESTIMATED_DAY_HEADING_HEIGHT = 70;
const MAX_RENDERED_STORIES = 80;
const OVERSCAN_STORIES = 20;

type Group = {
  day: string;
  start: number;
  end: number;
};

type StoryItemProps = {
  story: PublicFeedStory;
  index: number;
  total: number;
  measure: boolean;
  ranked: boolean;
  feedPosition?: number;
  onHeight: (id: string, height: number) => void;
  onFocus: (index: number) => void;
};

function StoryItem({
  story,
  index,
  total,
  measure,
  ranked,
  feedPosition,
  onHeight,
  onFocus,
}: StoryItemProps) {
  const ref = useRef<HTMLLIElement>(null);

  useLayoutEffect(() => {
    if (!measure) return;
    const element = ref.current;
    if (!element) return;
    const performMeasure = () => {
      const height = element.getBoundingClientRect().height;
      if (height > 0) onHeight(story.hn_id, height);
    };
    performMeasure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(performMeasure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure, onHeight, story.hn_id]);

  return (
    <li
      ref={ref}
      data-home-story-id={story.hn_id}
      aria-posinset={index + 1}
      aria-setsize={total}
      onFocusCapture={() => onFocus(index)}
    >
      <StoryRow
        story={story}
        variant={ranked ? "ranked" : "unranked"}
        feedPosition={feedPosition}
      />
    </li>
  );
}

function StorySpacer({ height }: { height: number }) {
  if (height <= 0) return null;
  return (
    <li
      aria-hidden="true"
      className="windowed-story-spacer"
      role="presentation"
      style={{ height }}
    />
  );
}

function FeedSpacer({ height }: { height: number }) {
  if (height <= 0) return null;
  return <div aria-hidden="true" className="windowed-feed-spacer" style={{ height }} />;
}

function dayLabel(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function clampRange(start: number, length: number) {
  const clampedStart = Math.max(0, Math.min(start, Math.max(0, length - MAX_RENDERED_STORIES)));
  return { start: clampedStart, end: Math.min(length, clampedStart + MAX_RENDERED_STORIES) };
}

function rangeForIndex(index: number, length: number) {
  return clampRange(index - OVERSCAN_STORIES, length);
}

function findIndexAtOffset(offsets: number[], offset: number) {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (offsets[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function WindowedStoryList({
  stories,
  ranked,
  initialPage,
  groupByDay,
  pinnedStoryId,
  onStoryTitleClickCapture,
}: {
  stories: PublicFeedStory[];
  ranked: boolean;
  initialPage: number;
  groupByDay: boolean;
  pinnedStoryId?: string | null;
  onStoryTitleClickCapture?: MouseEventHandler<HTMLOListElement>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, number>());
  const dayHeights = useRef(new Map<string, number>());
  const frame = useRef<number | null>(null);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [range, setRange] = useState(() => clampRange(0, stories.length));
  const pinnedIndex = pinnedStoryId
    ? stories.findIndex((story) => story.hn_id === pinnedStoryId)
    : -1;
  const pinnedRange = pinnedIndex >= 0 ? rangeForIndex(pinnedIndex, stories.length) : null;
  const renderedRange = pinnedRange ?? range;

  const groups = useMemo(() => {
    if (!groupByDay) return [] as Group[];
    const next: Group[] = [];
    for (let index = 0; index < stories.length; index++) {
      const day = stories[index]!.date_added.slice(0, 10);
      const group = next.at(-1);
      if (group?.day === day) group.end = index + 1;
      else next.push({ day, start: index, end: index + 1 });
    }
    return next;
  }, [groupByDay, stories]);

  const layout = useMemo(() => {
    const storyOffsets = [0];
    for (const story of stories)
      storyOffsets.push(
        storyOffsets.at(-1)! + (heights.current.get(story.hn_id) ?? ESTIMATED_STORY_HEIGHT),
      );

    if (!groupByDay)
      return {
        storyOffsets,
        viewportOffsets: storyOffsets.slice(0, -1),
        totalHeight: storyOffsets.at(-1)!,
      };

    const viewportOffsets = Array<number>(stories.length);
    let totalHeight = 0;
    for (const group of groups) {
      totalHeight += dayHeights.current.get(group.day) ?? ESTIMATED_DAY_HEADING_HEIGHT;
      for (let index = group.start; index < group.end; index++) {
        viewportOffsets[index] = totalHeight;
        totalHeight += storyOffsets[index + 1]! - storyOffsets[index]!;
      }
    }
    return { storyOffsets, viewportOffsets, totalHeight };
  }, [groupByDay, groups, layoutVersion, stories]);

  const updateRange = useCallback(() => {
    const element = root.current;
    if (!element || stories.length <= MAX_RENDERED_STORIES) return;
    // The feed's document offset is scrollY plus its viewport top, so its local
    // scroll position is the inverse viewport top. This also works while a
    // restored anchor is being mounted after its first scroll correction.
    const index = findIndexAtOffset(
      layout.viewportOffsets,
      Math.max(0, -element.getBoundingClientRect().top),
    );
    const next = rangeForIndex(index, stories.length);
    setRange((current) =>
      current.start === next.start && current.end === next.end ? current : next,
    );
  }, [layout.viewportOffsets, stories.length]);

  useLayoutEffect(() => {
    setRange((current) => {
      const next = clampRange(current.start, stories.length);
      return current.start === next.start && current.end === next.end ? current : next;
    });
    updateRange();
  }, [stories.length, updateRange]);

  useLayoutEffect(() => {
    if (!pinnedRange) return;
    setRange((current) =>
      current.start === pinnedRange.start && current.end === pinnedRange.end
        ? current
        : pinnedRange,
    );
  }, [pinnedRange]);

  useEffect(() => {
    const onScroll = () => {
      if (frame.current !== null) return;
      let ran = false;
      const id = requestAnimationFrame(() => {
        ran = true;
        frame.current = null;
        updateRange();
      });
      if (!ran) frame.current = id;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [updateRange]);

  const onStoryHeight = useCallback((id: string, height: number) => {
    if (heights.current.get(id) === height) return;
    heights.current.set(id, height);
    setLayoutVersion((version) => version + 1);
  }, []);
  const onDayHeight = useCallback((day: string, height: number) => {
    if (dayHeights.current.get(day) === height) return;
    dayHeights.current.set(day, height);
    setLayoutVersion((version) => version + 1);
  }, []);
  const onStoryFocus = useCallback(
    (index: number) => {
      if (index >= renderedRange.end - 12 || index < renderedRange.start + 12) {
        const next = rangeForIndex(index, stories.length);
        setRange((current) =>
          current.start === next.start && current.end === next.end ? current : next,
        );
      }
    },
    [renderedRange.end, renderedRange.start, stories.length],
  );

  const renderStory = (index: number) => {
    const story = stories[index]!;
    return (
      <StoryItem
        key={story.hn_id}
        story={story}
        index={index}
        total={stories.length}
        measure={stories.length > MAX_RENDERED_STORIES}
        ranked={ranked}
        feedPosition={ranked ? (initialPage - 1) * 10 + index + 1 : undefined}
        onHeight={onStoryHeight}
        onFocus={onStoryFocus}
      />
    );
  };

  if (!groupByDay) {
    const before = layout.storyOffsets[renderedRange.start]!;
    const after = layout.totalHeight - layout.storyOffsets[renderedRange.end]!;
    const list = (
      <>
        <StorySpacer height={before} />
        {Array.from({ length: renderedRange.end - renderedRange.start }, (_, offset) =>
          renderStory(renderedRange.start + offset),
        )}
        <StorySpacer height={after} />
      </>
    );
    return (
      <div ref={root} className="windowed-story-feed">
        {ranked ? (
          <ol
            className="story-list"
            start={initialPage > 1 ? (initialPage - 1) * 10 + 1 : undefined}
            onClickCapture={onStoryTitleClickCapture}
          >
            {list}
          </ol>
        ) : (
          <ul className="story-list">{list}</ul>
        )}
      </div>
    );
  }

  const activeGroups = groups.filter(
    (group) => group.start < renderedRange.end && group.end > renderedRange.start,
  );
  const firstGroup = activeGroups[0]!;
  const lastGroup = activeGroups.at(-1)!;
  const groupStart = (group: Group) =>
    layout.viewportOffsets[group.start]! -
    (dayHeights.current.get(group.day) ?? ESTIMATED_DAY_HEADING_HEIGHT);
  const groupEnd = (group: Group) =>
    layout.viewportOffsets[group.end - 1]! +
    (layout.storyOffsets[group.end]! - layout.storyOffsets[group.end - 1]!);

  return (
    <div ref={root} className="windowed-story-feed">
      <FeedSpacer height={groupStart(firstGroup)} />
      {activeGroups.map((group) => {
        const start = Math.max(group.start, renderedRange.start);
        const end = Math.min(group.end, renderedRange.end);
        const before = layout.storyOffsets[start]! - layout.storyOffsets[group.start]!;
        const after = layout.storyOffsets[group.end]! - layout.storyOffsets[end]!;
        return (
          <section key={group.day} aria-labelledby={`day-${group.day}`}>
            <MeasuredDayHeading
              day={group.day}
              measure={stories.length > MAX_RENDERED_STORIES}
              onHeight={onDayHeight}
            >
              <h2 id={`day-${group.day}`}>
                <time dateTime={group.day}>{dayLabel(group.day)}</time>
              </h2>
            </MeasuredDayHeading>
            <ul className="story-list">
              <StorySpacer height={before} />
              {Array.from({ length: end - start }, (_, offset) => renderStory(start + offset))}
              <StorySpacer height={after} />
            </ul>
          </section>
        );
      })}
      <FeedSpacer height={layout.totalHeight - groupEnd(lastGroup)} />
    </div>
  );
}

function MeasuredDayHeading({
  day,
  measure,
  onHeight,
  children,
}: {
  day: string;
  measure: boolean;
  onHeight: (day: string, height: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!measure) return;
    const element = ref.current;
    if (!element) return;
    const performMeasure = () => {
      const height = element.getBoundingClientRect().height;
      if (height > 0) onHeight(day, height);
    };
    performMeasure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(performMeasure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [day, measure, onHeight]);
  return (
    <div ref={ref} className="feed-bar">
      {children}
    </div>
  );
}
