import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const statii = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/statii" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    category: z.enum(["vinetki", "gtp", "grazhdanska", "globi", "sobstvenost"]),
    /** Инструментът, към който статията фунелира (href) */
    tool: z.string().default("/"),
    toolLabel: z.string().default("Провери колата си безплатно"),
    faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
  }),
});

export const collections = { statii };
