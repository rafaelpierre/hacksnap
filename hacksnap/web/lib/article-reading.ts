import type { ReadingFields, ReadingSink, SectionType } from "./reading-contract";

const SECTION_TYPES: SectionType[] = [
  "opening",
  "brief",
  "key_points",
  "discussion",
  "theme_heading",
  "theme_body",
  "pending",
  "related",
];
const IDLE_MS = 60_000;
type Section = {
  element: HTMLElement;
  fields: Required<
    Pick<ReadingFields, "section_id" | "section_type" | "section_position" | "section_words">
  >;
  total: number;
  continuous: number;
  sent: number;
  viewed: boolean;
  engaged: boolean;
};

/** Foreground visibility is a reading proxy. Totals are cumulative, never summed across checkpoints. */
export function createArticleReader(
  root: HTMLElement,
  emit: ReadingSink,
  now: () => number = () => performance.now(),
) {
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  const sections = new Map<string, Section>();
  let visible: Section[] = [];
  let previous = now();
  let lastActivity = previous;
  let active = false;
  let activeMs = 0;
  let sentActiveMs = -1;
  let lastSection = "none";
  let furthestSection = "none";
  let furthestPosition = 0;
  let sequence = 0;
  let checkpointAt = previous;

  function discover() {
    root.querySelectorAll<HTMLElement>("[data-reading-section]").forEach((element, index) => {
      const type = SECTION_TYPES.find((value) => value === element.dataset.readingSection);
      const id = element.dataset.readingId;
      if (!type || !id || !/^[a-z_]+_[1-9][0-9]*$/.test(id)) return;
      const existing = sections.get(id);
      if (existing) {
        existing.element = element;
        return;
      }
      const words = Number(element.dataset.readingWords);
      const section: Section = {
        element,
        fields: {
          section_id: id,
          section_type: type,
          section_position: index + 1,
          section_words: Number.isFinite(words) ? Math.max(0, Math.min(100_000, words)) : 0,
        },
        total: 0,
        continuous: 0,
        sent: 0,
        viewed: false,
        engaged: false,
      };
      sections.set(id, section);
      emit("article_section_available", section.fields, "available:" + id);
    });
  }

  function advance(time: number) {
    const elapsed = time - previous;
    // Suspended timers must not manufacture minutes of reading on resume.
    const credit =
      active && elapsed >= 0 && elapsed <= 1500
        ? Math.min(elapsed, Math.max(0, lastActivity + IDLE_MS - previous))
        : 0;
    previous = time;
    if (visible.length) activeMs += credit;
    for (const section of visible) {
      section.total += credit;
      section.continuous = elapsed > 1500 || !active ? 0 : section.continuous + credit;
      if (!section.viewed && section.continuous >= 1000) {
        section.viewed = true;
        emit("article_section_view", section.fields, "view:" + section.fields.section_id);
        if (section.fields.section_position > furthestPosition) {
          furthestPosition = section.fields.section_position;
          furthestSection = section.fields.section_id;
        }
      }
      if (!section.engaged && section.viewed && section.total >= 5000) {
        section.engaged = true;
        emit("article_section_engaged", section.fields, "engaged:" + section.fields.section_id);
      }
    }
  }

  function isVisible(element: HTMLElement) {
    if (!element.isConnected || element.closest('[hidden], [aria-busy="true"]')) return false;
    for (
      let parent = element.parentElement;
      parent && parent !== root;
      parent = parent.parentElement
    ) {
      if (parent.tagName === "DETAILS" && !parent.hasAttribute("open")) {
        const heading = parent.querySelector("summary");
        if (!heading?.contains(element)) return false;
      }
    }
    const rect = element.getBoundingClientRect();
    const height = Math.min(rect.bottom, win.innerHeight) - Math.max(rect.top, 0);
    const width = Math.min(rect.right, win.innerWidth) - Math.max(rect.left, 0);
    return (
      rect.height > 0 &&
      rect.width > 0 &&
      height >= Math.min(rect.height, win.innerHeight) / 2 &&
      width > 0
    );
  }

  function sample() {
    const time = now();
    advance(time);
    discover();
    active = doc.visibilityState !== "hidden" && doc.hasFocus() && time - lastActivity < IDLE_MS;
    const next = active
      ? [...sections.values()].filter((section) => isVisible(section.element))
      : [];
    for (const section of visible) {
      if (!next.includes(section)) section.continuous = 0;
    }
    visible = next;
    if (visible.length) {
      // The section nearest the upper reading area, independent of furthest progress.
      const nearest = [...visible].sort(
        (a, b) =>
          Math.abs(a.element.getBoundingClientRect().top - win.innerHeight * 0.25) -
          Math.abs(b.element.getBoundingClientRect().top - win.innerHeight * 0.25),
      )[0];
      lastSection = nearest.fields.section_id;
    }
  }

  function flush(reason: NonNullable<ReadingFields["checkpoint_reason"]>) {
    // React may have replaced the DOM before effect cleanup runs.
    if (reason === "route") advance(now());
    else sample();
    const changed = [...sections.values()].filter((section) => section.total > section.sent);
    if (!changed.length && activeMs === sentActiveMs) return;
    sequence++;
    for (const section of changed) {
      emit("article_section_time", {
        ...section.fields,
        visible_ms: Math.round(section.total),
        checkpoint_sequence: sequence,
      });
      section.sent = section.total;
    }
    emit("article_reading_checkpoint", {
      active_ms: Math.round(activeMs),
      last_section: lastSection,
      furthest_section: furthestSection,
      checkpoint_reason: reason,
      checkpoint_sequence: sequence,
    });
    sentActiveMs = activeMs;
    checkpointAt = now();
  }

  function activity() {
    advance(now());
    lastActivity = now();
    sample();
  }

  function sectionFields(element: Element): ReadingFields {
    const marker = element.closest<HTMLElement>("[data-reading-id]");
    return sections.get(marker?.dataset.readingId ?? "")?.fields ?? {};
  }

  return {
    start() {
      previous = now();
      lastActivity = previous;
      checkpointAt = previous;
      emit("article_reading_start", {}, "start");
      sample();
    },
    tick() {
      sample();
      if (now() - checkpointAt >= 15_000) flush("interval");
    },
    activity,
    flush,
    stop() {
      active = false;
      visible = [];
      for (const section of sections.values()) section.continuous = 0;
    },
    sectionFields,
    action(
      name: "article_theme_toggle" | "article_source_action",
      element: Element,
      fields: ReadingFields,
    ) {
      activity();
      emit(name, { ...sectionFields(element), ...fields });
    },
  };
}
