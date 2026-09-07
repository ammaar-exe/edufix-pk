/**
 * POST /api/[subject]/notes — always-on, retrieval-grounded CAIE study notes.
 *
 * The subject is derived EXCLUSIVELY from the route param (context-isolation
 * boundary, rules.md §2). The request body never supplies the subject. All
 * CAIE content is retrieved from the knowledge base; nothing is authored here.
 */

import { z } from "zod";

import { isSubjectId, getSubject, type SubjectId } from "@/lib/subjects";
import { getTopicOptions } from "@/lib/kb/topics";
import { getEffectiveTaxonomy, hasSubTopicMap, slugToQueryKeywords } from "@/lib/kb/subtopics";
import { searchKnowledgeBase, type VectorSearchResult } from "@/lib/rag/search";
import { groqChat } from "@/lib/ai/groq";
import {
  buildNotesSystemPrompt,
  buildNotesUserPrompt,
  NOTES_MAX_TOKENS,
  NOTES_MAX_TOKENS_GEOGRAPHY,
  INSUFFICIENT_CONTEXT_SENTENCE,
  type NotesContextChunk,
} from "@/lib/prompts";
import type {
  NoteCitation,
  NotesApiResponse,
  NotesErrorCode,
  NotesPayload,
} from "@/lib/notes/types";

export const runtime = "nodejs";
export const maxDuration = 60; // Free-tier Groq generations can take 30-60s
export const dynamic = "force-dynamic";

/**
 * Retrieval depth: 10 chunks (dense-context directive).
 */
const TOP_K = 10;

/**
 * History (2059/01) strict chapter-isolation retrieval tuning — Issue 2.
 *
 * The LIVE match_kb_chunks RPC is the loose variant: for a requested sub_topic it
 * admits `slug OR general% OR untagged`, so the whole general2059 pool (1857,
 * every other era, geography, syllabus meta-text) competes with — and crowds out
 * — the on-topic chunks within the RPC's LIMIT. To enforce true chapter/topic
 * isolation without a DB migration, the route fetches a WIDE candidate pool and
 * then keeps ONLY chunks tagged exactly the requested slug.
 *
 * 50 is the RPC's hard `match_top_k` cap (larger values are clamped server-side),
 * and 0.40 is permissive enough that all 19 History sub-topics still recover >=1
 * on-topic chunk at pool=50 (verified), while the exact-slug post-filter
 * guarantees ZERO cross-era chunks reach the model.
 */
const HISTORY_CANDIDATE_POOL = 50;
const HISTORY_STRICT_THRESHOLD = 0.4;

/** Request body contract validated with zod v4. */
const bodySchema = z.object({
  paperCode: z.string().trim().min(1),
  topicId: z.string().trim().min(1),
  topicLabel: z.string().trim().min(1).optional(),
});

const STATUS_BY_CODE: Record<NotesErrorCode, number> = {
  INVALID_SUBJECT: 400,
  INVALID_BODY: 400,
  UNKNOWN_TOPIC: 400,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
  RETRIEVAL_FAILED: 502,
};

function jsonError(code: NotesErrorCode, message: string): Response {
  const body: NotesApiResponse = { ok: false, error: { code, message } };
  return Response.json(body, { status: STATUS_BY_CODE[code] });
}

function jsonOk(data: NotesPayload): Response {
  const body: NotesApiResponse = { ok: true, data };
  return Response.json(body, { status: 200 });
}

/** Detect Groq 429 / quota / rate-limit conditions from an unknown error. */
function isRateLimitError(err: unknown): boolean {
  if (typeof err === "object" && err !== null) {
    const status = (err as { status?: unknown }).status;
    if (status === 429) return true;
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && /rate.?limit|quota/i.test(code)) return true;
  }
  const message = err instanceof Error ? err.message : String(err);
  return /\b429\b|rate.?limit|quota|too many requests/i.test(message);
}

/** Strip a whole-response ```markdown fence if the model added one, then trim. */
function cleanMarkdown(raw: string): string {
  const text = raw.trim();
  const fence = text.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
  return (fence?.[1] ?? text).trim();
}

/** CAIE-oriented query expansion terms per subject. */
const EXPANSIONS: Record<SubjectId, string> = {
  "pak-studies": "key dates chronology causes consequences significance notes",
  islamiyat: "Qur\u2019anic verses Hadith events details significance background notes",
  urdu: "vocabulary idioms \u0645\u062d\u0627\u0648\u0631\u0627\u062a grammar comprehension",
};

/**
 * Build the targeted semantic query that scopes retrieval to the chosen sub-topic.
 */
function buildQuery(
  subject: SubjectId,
  subjectName: string,
  topicLabel: string,
  slugKeywords: string
): string {
  return `${subjectName} ${topicLabel}. ${slugKeywords}. ${EXPANSIONS[subject]}`;
}

/** Prefer joined document_* columns, falling back to the chunk metadata JSONB. */
function readMeta(row: VectorSearchResult) {
  const md = row.metadata ?? {};
  const str = (value: unknown): string | null =>
    typeof value === "string" && value.length > 0 ? value : null;
  const yearRaw = row.document_year ?? md.year;
  const yearNum =
    typeof yearRaw === "number"
      ? yearRaw
      : typeof yearRaw === "string" && yearRaw.trim() !== ""
        ? Number(yearRaw)
        : NaN;
  return {
    title:
      row.document_title ?? str(md.filename) ?? str(md.title) ?? "Untitled source",
    category: row.document_category ?? str(md.category),
    paperCode: row.document_paper_code ?? str(md.paper_code),
    year: Number.isFinite(yearNum) ? yearNum : null,
    session: row.document_session ?? str(md.session),
  };
}

/** Map a retrieved chunk into the prompt's context shape with a stable id. */
function toContextChunk(row: VectorSearchResult, index: number): NotesContextChunk {
  const meta = readMeta(row);
  return {
    id: `c${index + 1}`,
    title: meta.title,
    category: meta.category,
    paperCode: meta.paperCode,
    year: meta.year,
    session: meta.session,
    text: row.content ?? "",
  };
}

/** Build the citation list (c1..cN), tolerating null document metadata. */
function toCitations(rows: VectorSearchResult[]): NoteCitation[] {
  return rows.map((row, index) => {
    const meta = readMeta(row);
    return {
      id: `c${index + 1}`,
      title: meta.title,
      category: meta.category,
      paperCode: meta.paperCode,
      year: meta.year,
      session: meta.session,
      similarity: Math.round((row.similarity ?? 0) * 1000) / 1000,
    };
  });
}

/**
 * Geography (2059/02) retrieval re-ranking — Issue 1 (diagram over-reliance).
 *
 * CAIE "Insert" booklets (category `insert`) and figure/table/graph/chart
 * captions carry STATION-SPECIFIC diagram data (e.g. one city's rainfall chart).
 * Ranked purely by cosine similarity, that localized data crowds out core
 * syllabus/textbook explanation, and the model then generalises a single
 * station's readings across all of Pakistan's climate zones.
 *
 * This demotes standalone diagram/figure/table chunks BELOW core explanatory
 * content so the TOP_K sent to the model is led by syllabus/notes/mark-scheme
 * prose. Diagrams are DEMOTED, never dropped: a sub-topic that genuinely asks
 * about a specific figure still surfaces it once core content is exhausted.
 */
const GEOGRAPHY_CORE_CATEGORIES = new Set(["notes", "syllabus"]);
const GEOGRAPHY_DIAGRAM_CATEGORIES = new Set(["insert"]);
const FIGURE_CAPTION_RE = /\b(?:fig\.?|figure|table|graph|chart|map)\s*\d+\b/i;

/** Rank tier for one Geography chunk: 2 = core text, 1 = other CAIE text, 0 = diagram. */
function geographyChunkPriority(row: VectorSearchResult): number {
  const md = row.metadata ?? {};
  const category = String(
    row.document_category ??
      (typeof md.category === "string" ? md.category : "") ??
      ""
  ).toLowerCase();
  const content = row.content ?? "";
  const isDiagram =
    GEOGRAPHY_DIAGRAM_CATEGORIES.has(category) || FIGURE_CAPTION_RE.test(content);
  if (isDiagram) return 0;
  if (GEOGRAPHY_CORE_CATEGORIES.has(category)) return 2;
  return 1;
}

/**
 * Stable re-rank: core content first, diagrams last; within a tier the incoming
 * similarity order is preserved (rows arrive sorted by similarity DESC).
 */
function prioritiseGeographyChunks(
  rows: VectorSearchResult[]
): VectorSearchResult[] {
  return rows
    .map((row, index) => ({ row, index, priority: geographyChunkPriority(row) }))
    .sort((a, b) => b.priority - a.priority || a.index - b.index)
    .map((entry) => entry.row);
}

/** Call the model once for markdown notes. */
async function generateMarkdown(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number
): Promise<string> {
  const raw = await groqChat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    { temperature: 0.1, maxTokens }
  );
  return cleanMarkdown(raw);
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ subject: string }> }
): Promise<Response> {
  const { subject: subjectParam } = await ctx.params;

  // 1. Subject comes ONLY from the route.
  if (!isSubjectId(subjectParam)) {
    return jsonError("INVALID_SUBJECT", "Unknown subject in route.");
  }
  const subject: SubjectId = subjectParam;
  const meta = getSubject(subject);
  const subjectName = meta?.name ?? subject;
  const subjectCode = meta?.code ?? "";

  // 2. Parse + validate request body.
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonError("INVALID_BODY", "Request body must be valid JSON.");
  }
  const parsedBody = bodySchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return jsonError("INVALID_BODY", "Request body is missing required fields.");
  }
  const { paperCode, topicId } = parsedBody.data;

  // 3. Validate section + sub-topic against taxonomy.
  const taxonomy = getEffectiveTaxonomy(subject);
  if (!taxonomy) {
    return jsonError("UNKNOWN_TOPIC", "No taxonomy available for this subject.");
  }
  const paperKnown =
    paperCode === "all" || taxonomy.papers.some((p) => p.id === paperCode);
  if (!paperKnown) {
    return jsonError("UNKNOWN_TOPIC", "Unknown paper/section for this subject.");
  }
  const topic = getTopicOptions(taxonomy, paperCode).find((t) => t.id === topicId);
  if (!topic) {
    return jsonError("UNKNOWN_TOPIC", "Unknown sub-topic for this subject/paper.");
  }
  const topicLabel = topic.title;
  const sectionLabel =
    paperCode !== "all"
      ? taxonomy.papers.find((p) => p.id === paperCode)?.title
      : undefined;

  // Owning paper/section of the selected sub-topic ("1" = History, "2" =
  // Geography for Pakistan Studies), robust to paperCode === "all". Resolved
  // BEFORE retrieval so the Geography diagram de-prioritisation pass can size
  // its candidate pool; also drives the dedicated Geography prompt route.
  const owningPaperCode =
    taxonomy.papers.find((p) => p.topics.some((t) => t.id === topicId))?.id ??
    (paperCode !== "all" ? paperCode : undefined);
  const isPakGeography = subject === "pak-studies" && owningPaperCode === "2";
  const isPakHistory = subject === "pak-studies" && owningPaperCode === "1";

  // 4. Retrieve context. The sub_topic filter is the chapter/topic metadata
  //    isolation. Retrieval strategy is PAPER-AWARE because the live RPC admits
  //    the whole general2059 pool alongside any requested slug:
  //      • History (Issue 2): strict isolation — wide pool, then keep ONLY exact
  //        slug-tagged chunks so cross-era general2059 content (1857, other
  //        movements, geography, syllabus meta-text) can never enter the context.
  //      • Geography (Issue 1): keep the general pool (its climate sub-topic tags
  //        are thin and the real macro-climate text lives there), pull a wider
  //        2 × TOP_K pool, then demote station-specific diagram/insert chunks.
  //      • Other subjects: unchanged single strict pass + semantic fallback.
  const query = buildQuery(
    subject,
    subjectName,
    topicLabel,
    slugToQueryKeywords(topicId)
  );

  let rows: VectorSearchResult[];
  try {
    if (isPakHistory) {
      rows = await searchKnowledgeBase(query, {
        subject_id: subject,
        topK: HISTORY_CANDIDATE_POOL,
        threshold: HISTORY_STRICT_THRESHOLD,
        filters: { sub_topic: topicId },
      });
      // Strict chapter isolation: drop every general/other-slug chunk the loose
      // RPC admitted, keeping ONLY chunks tagged exactly this sub-topic.
      rows = rows
        .filter((row) => String((row.metadata ?? {}).sub_topic ?? "") === topicId)
        .slice(0, TOP_K);
    } else {
      rows = await searchKnowledgeBase(query, {
        subject_id: subject,
        topK: isPakGeography ? TOP_K * 2 : TOP_K,
        filters: hasSubTopicMap(subject) ? { sub_topic: topicId } : undefined,
      });
      // Geography re-rank: demote standalone figure/diagram/table/insert chunks
      // below core explanatory content, then keep the top TOP_K. Diagrams are
      // demoted, never dropped, so a genuinely figure-specific sub-topic still
      // surfaces them once core content is exhausted.
      if (isPakGeography) {
        rows = prioritiseGeographyChunks(rows).slice(0, TOP_K);
      }
    }
  } catch (err) {
    console.error("[notes] retrieval failed:", err);
    return jsonError("RETRIEVAL_FAILED", "Failed to retrieve source context.");
  }

  // 5. No context found -> return 200 with guardrail notice.
  if (rows.length === 0) {
    const payload: NotesPayload = {
      subject,
      subjectName,
      paperCode,
      sectionLabel: sectionLabel ?? null,
      topicId,
      topicLabel,
      markdown: "",
      citations: [],
      insufficientContext: true,
      notice: INSUFFICIENT_CONTEXT_SENTENCE,
      generatedAt: new Date().toISOString(),
    };
    return jsonOk(payload);
  }

  // 6. Generate markdown notes via Groq.
  const maxTokens = isPakGeography ? NOTES_MAX_TOKENS_GEOGRAPHY : NOTES_MAX_TOKENS;
  const systemPrompt = buildNotesSystemPrompt({
    subject,
    subjectName,
    subjectCode,
    subTopicDisplayName: topicLabel,
    paperCode: owningPaperCode,
  });
  const chunks = rows.map(toContextChunk);
  const userPrompt = buildNotesUserPrompt({
    subject,
    paperCode,
    sectionLabel,
    topicLabel,
    chunks,
  });

  let markdown: string;
  try {
    markdown = await generateMarkdown(systemPrompt, userPrompt, maxTokens);
    if (!markdown) {
      console.error("[notes] empty markdown on first attempt; retrying once");
      markdown = await generateMarkdown(systemPrompt, userPrompt, maxTokens);
    }
  } catch (err) {
    if (isRateLimitError(err)) {
      console.error("[notes] upstream rate limited:", err);
      return jsonError(
        "RATE_LIMITED",
        "The notes service is busy right now. Please try again shortly."
      );
    }
    console.error("[notes] generation failed:", err);
    return jsonError("UPSTREAM_ERROR", "Failed to generate notes from context.");
  }

  if (!markdown) {
    return jsonError("UPSTREAM_ERROR", "Failed to generate notes from context.");
  }

  // 7. Assemble final response payload.
  const payload: NotesPayload = {
    subject,
    subjectName,
    paperCode,
    sectionLabel: sectionLabel ?? null,
    topicId,
    topicLabel,
    markdown,
    citations: toCitations(rows),
    insufficientContext: false,
    notice: null,
    generatedAt: new Date().toISOString(),
  };

  return jsonOk(payload);
}

export function GET(): Response {
  return Response.json(
    {
      ok: false,
      error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed. Use POST." },
    },
    { status: 405, headers: { Allow: "POST" } }
  );
}