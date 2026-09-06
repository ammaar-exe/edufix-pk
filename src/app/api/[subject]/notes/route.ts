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
export const maxDuration = 30; // Max execution duration for Vercel/Serverless
export const dynamic = "force-dynamic";

/**
 * Retrieval depth: 10 chunks (dense-context directive).
 */
const TOP_K = 10;

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

  // 4. Retrieve context with primary strict pass and semantic fallback.
  const query = buildQuery(
    subject,
    subjectName,
    topicLabel,
    slugToQueryKeywords(topicId)
  );

  let rows: VectorSearchResult[];
  try {
    rows = await searchKnowledgeBase(query, {
      subject_id: subject,
      topK: TOP_K,
      filters: hasSubTopicMap(subject) ? { sub_topic: topicId } : undefined,
    });
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
  const owningPaperCode =
    taxonomy.papers.find((p) => p.topics.some((t) => t.id === topicId))?.id ??
    (paperCode !== "all" ? paperCode : undefined);
  const isPakGeography = subject === "pak-studies" && owningPaperCode === "2";
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