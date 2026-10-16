export type ReadingEvent =
  | "article_reading_start"
  | "article_section_available"
  | "article_section_view"
  | "article_section_engaged"
  | "article_section_time"
  | "article_reading_checkpoint"
  | "article_theme_toggle"
  | "article_source_action";

export type SectionType =
  | "opening"
  | "brief"
  | "key_points"
  | "discussion"
  | "theme_heading"
  | "theme_body"
  | "pending"
  | "related";

export type ReadingContext = {
  reading_version: 1;
  story_id: string;
  content_revision: string;
  layout_variant: string;
  copy_variant: string;
  category: string;
  summary_status: string;
};

export type ReadingFields = {
  section_id?: string;
  section_type?: SectionType;
  section_position?: number;
  section_words?: number;
  visible_ms?: number;
  active_ms?: number;
  last_section?: string;
  furthest_section?: string;
  checkpoint_reason?: "interval" | "hidden" | "blur" | "pagehide" | "route";
  checkpoint_sequence?: number;
  source_kind?: "original" | "hn_thread" | "hn_comment" | "citation";
  action?: "open" | "close" | "click";
};

export type ReadingSink = (name: ReadingEvent, fields?: ReadingFields, once?: string) => void;
