import type { Metadata } from "next";
import { categoryURL, type Category, type CategoryId } from "./categories";

const CATEGORY_SEARCH_COPY = {
  models_products: {
    title: "AI Models, Releases & Products",
    description:
      "Explore AI model releases, new capabilities, and products with concise article summaries and key takeaways from Hacker News discussions.",
  },
  agents_coding: {
    title: "AI Coding Agents & Assistants — Hacker News",
    description:
      "Catch up on AI coding agents, assistants, and developer tools with concise article summaries and key takeaways from Hacker News discussions.",
  },
  research_evaluation: {
    title: "AI Research, Benchmarks & Evaluation",
    description:
      "Follow AI research, benchmarks, and evaluations with concise article summaries and Hacker News discussions about the results and their limitations.",
  },
  infrastructure_efficiency: {
    title: "AI Infrastructure, Inference & Efficiency",
    description:
      "Explore AI hardware, inference, infrastructure, and running costs with concise article summaries and practical takeaways from Hacker News discussions.",
  },
  safety_privacy: {
    title: "AI Safety, Security & Privacy",
    description:
      "Follow AI safety, security, alignment, and data privacy with concise article summaries and key concerns raised in Hacker News discussions.",
  },
  industry_society: {
    title: "AI Industry, Work & Society",
    description:
      "Explore how AI affects business, jobs, creativity, and society with concise article summaries and key takeaways from Hacker News discussions.",
  },
} satisfies Record<CategoryId, { title: string; description: string }>;

export function categoryMetadata(category: Category, page: number): Metadata {
  const copy = CATEGORY_SEARCH_COPY[category.id];
  const title = `${copy.title}${page > 1 ? ` — Page ${page}` : ""}`;
  const description = `${page > 1 ? `Page ${page}: ` : ""}${copy.description}`;
  return {
    title,
    description,
    alternates: { canonical: categoryURL(category, page) },
    openGraph: {
      title: `${title} | Hacksnap`,
      description,
      url: categoryURL(category, page),
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} | Hacksnap`,
      description,
    },
  };
}
