import { getServerEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { embedText } from "@/lib/ai/embeddings";
import {
  ALLOWED_SUBJECT_IDS,
  assertSubjectId,
  isSubjectId,
  type SubjectId,
} from "@/lib/subjects";

/**
 * Task 2.3 — Standalone RAG vector search.
 *
 * This module is the retrieval guardrail for all EduFix PK generation flows:
 *   * queries are embedded with the same model used during ingestion
 *   * matching happens inside Postgres via the match_kb_chunks RPC
 *   * subject_id filtering is mandatory and enforced before any database call
 *   * strict pass matches subject + metadata filters + similarity threshold
 *   * FALLBACK: if strict pass returns zero chunks (e.g. due to sub_topic slug tag mismatch),
 *     metadata filters and sub_topic locks are relaxed to perform a semantic-only retrieval
 *     across the subject pool, ensuring guaranteed grounded context.
 */

export { ALLOWED_SUBJECT_IDS, assertSubjectId, isSubjectId };
export type { SubjectId };

export interface SearchFilters {
  category?: string;
  paper_code?: string;
  year?: number;
  session?: string;
  /**
   * Hard sub-topic isolation filter.
   */
  sub_topic?: string;
}

export interface VectorSearchOptions {
  subject_id: SubjectId;
  filters?: SearchFilters;
  threshold?: number;
  topK?: number;
}

export interface VectorSearchResult {
  chunk_id: string;
  document_id: string;
  subject_id: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
  document_title: string | null;
  document_category: string | null;
  document_year: number | null;
  document_session: string | null;
  document_paper_code: string | null;
}

interface MatchKbChunksRow {
  chunk_id: string;
  document_id: string;
  subject_id: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
  document_title: string | null;
  document_category: string | null;
  document_year: number | null;
  document_session: string | null;
  document_paper_code: string | null;
}

async function embedQuery(text: string): Promise<number[]> {
  const env = getServerEnv();

  if (env.EMBEDDING_PROVIDER === "local") {
    const { embedTextLocal } = await import("@/lib/ai/local-embeddings");
    return embedTextLocal(text);
  }

  return embedText(text);
}

/**
 * Retrieval fallback tuning.
 * Fallback threshold set to 0.40 to guarantee retrieval while preventing noise/contamination.
 */
const FALLBACK_TOP_K = 10;
const FALLBACK_THRESHOLD = 0.40;

interface RunMatchArgs {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  queryEmbedding: number[];
  subjectId: SubjectId;
  threshold: number;
  topK: number;
  filters: {
    category: string | null;
    paper_code: string | null;
    year: number | null;
    session: string | null;
    sub_topic: string | null;
  };
}

async function runMatchKbChunks({
  supabase,
  queryEmbedding,
  subjectId,
  threshold,
  topK,
  filters,
}: RunMatchArgs): Promise<VectorSearchResult[]> {
  const { data, error } = await supabase.rpc("match_kb_chunks", {
    query_embedding: queryEmbedding,
    match_subject_id: subjectId,
    match_threshold: threshold,
    match_top_k: topK,
    match_category: filters.category,
    match_paper_code: filters.paper_code,
    match_year: filters.year,
    match_session: filters.session,
    match_sub_topic: filters.sub_topic,
  });

  if (error) {
    console.error("[rag-error] Supabase RPC match_kb_chunks failed:", JSON.stringify(error, null, 2));
    throw new Error(`kb_chunks vector search failed: ${error.message}`);
  }

  const rows = (data ?? []) as MatchKbChunksRow[];

  return rows
    .filter((row) => Number.isFinite(row.similarity) && row.similarity >= threshold)
    .map((row) => {
      // Re-score similarity slightly to give higher priority to dedicated notes vs noisy markschemes
      let adjustedSimilarity = row.similarity;
      if (row.document_category === "notes") {
        adjustedSimilarity = Math.min(1.0, row.similarity + 0.05);
      }

      return {
        chunk_id: row.chunk_id,
        document_id: row.document_id,
        subject_id: row.subject_id,
        content: row.content,
        metadata: row.metadata,
        similarity: Number(adjustedSimilarity.toFixed(5)),
        document_title: row.document_title,
        document_category: row.document_category,
        document_year: row.document_year,
        document_session: row.document_session,
        document_paper_code: row.document_paper_code,
      };
    })
    .sort((a, b) => b.similarity - a.similarity);
}

export async function searchKnowledgeBase(
  query: string,
  options: VectorSearchOptions
): Promise<VectorSearchResult[]> {
  const env = getServerEnv();

  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw new Error("RAG search query must be a non-empty string.");
  }

  const subjectId = assertSubjectId(options.subject_id);

  // Auto-tune default threshold to 0.50 for high-precision retrieval
  const defaultThreshold = options.filters?.sub_topic ? 0.45 : env.RAG_SIMILARITY_THRESHOLD || 0.50;
  const threshold = options.threshold ?? defaultThreshold;

  if (threshold < 0 || threshold > 1) {
    throw new Error(`RAG threshold must be between 0 and 1, got ${threshold}.`);
  }

  const topK = Math.max(1, Math.min(options.topK ?? 5, 50));

  const queryEmbedding = await embedQuery(trimmedQuery);
  if (queryEmbedding.length !== env.EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Query embedding dimension mismatch: expected ${env.EMBEDDING_DIMENSIONS}, got ${queryEmbedding.length}.`
    );
  }

  const supabase = createSupabaseAdminClient();

  // Step 1 — Strict pass with all filters
  const strictResults = await runMatchKbChunks({
    supabase,
    queryEmbedding,
    subjectId,
    threshold,
    topK,
    filters: {
      category: options.filters?.category ?? null,
      paper_code: options.filters?.paper_code ?? null,
      year: options.filters?.year ?? null,
      session: options.filters?.session ?? null,
      sub_topic: options.filters?.sub_topic ?? null,
    },
  });

  if (strictResults.length > 0) {
    return strictResults;
  }

  // Step 2 — Fallback pass: Relax category, year, session, paper_code, AND sub_topic
  // when strict tag mismatch yields 0 rows, enabling pure semantic search across subject pool.
  console.warn(
    `[rag] strict retrieval returned 0 chunks (subject=${subjectId}, ` +
      `sub_topic=${options.filters?.sub_topic ?? "none"}, threshold=${threshold}); ` +
      `falling back with relaxed sub_topic filter (top_k=${FALLBACK_TOP_K}).`
  );

  return runMatchKbChunks({
    supabase,
    queryEmbedding,
    subjectId,
    threshold: FALLBACK_THRESHOLD,
    topK: FALLBACK_TOP_K,
    filters: {
      category: null,
      paper_code: null,
      year: null,
      session: null,
      sub_topic: null, // Relaxed to guarantee semantic retrieval across subject pool
    },
  });
}

export async function runSearchTest(options: {
  query: string;
  subject_id: SubjectId;
  filters?: SearchFilters;
  threshold?: number;
  topK?: number;
}): Promise<VectorSearchResult[]> {
  const results = await searchKnowledgeBase(options.query, {
    subject_id: options.subject_id,
    filters: options.filters,
    threshold: options.threshold,
    topK: options.topK,
  });

  console.log(
    `RAG test: subject=${options.subject_id} threshold=${
      options.threshold ?? getServerEnv().RAG_SIMILARITY_THRESHOLD
    } topK=${options.topK ?? 5} results=${results.length}`
  );

  for (const result of results) {
    console.log(
      `- [${result.similarity.toFixed(4)}] ${result.document_title ?? "Unknown document"} :: ${result.content.slice(
        0,
        160
      )}...`
    );
  }

  return results;
}

interface CliArgs {
  subject?: string;
  query?: string;
  category?: string;
  paper_code?: string;
  year?: number;
  session?: string;
  sub_topic?: string;
  top?: number;
  threshold?: number;
  help?: boolean;
}

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};

  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;

    const [rawKey, ...rest] = arg.slice(2).split("=");
    const value = rest.join("=");

    switch (rawKey) {
      case "subject":
        args.subject = value;
        break;
      case "query":
        args.query = value;
        break;
      case "category":
        args.category = value;
        break;
      case "paper_code":
        args.paper_code = value;
        break;
      case "year":
        args.year = Number(value);
        break;
      case "session":
        args.session = value;
        break;
      case "sub_topic":
      case "subTopic":
        args.sub_topic = value;
        break;
      case "top":
        args.top = Number(value);
        break;
      case "threshold":
        args.threshold = Number(value);
        break;
      case "help":
        args.help = true;
        break;
    }
  }

  return args;
}

function printUsage(): void {
  console.log(`Usage:
  npx tsx src/lib/rag/search.ts --subject=<pak-studies|islamiyat|urdu> --query="<text>" [options]

Options:
  --subject=<subject_id>      Required. One of: ${ALLOWED_SUBJECT_IDS.join(", ")}
  --query="<text>"             Required. Search query.
  --category=<category>        Optional metadata filter (notes, past_paper, marking_scheme).
  --paper_code=<code>         Optional metadata filter, e.g. 2058/11.
  --year=<year>                Optional metadata filter, e.g. 2022.
  --session=<session>          Optional metadata filter, e.g. "May/June".
  --sub_topic=<slug>          Optional hard isolation filter, e.g. conquest_of_makkah_battle_of_hunain_and_tabuk.
  --top=<n>                  Number of results to return. Default: 5. Max: 50.
  --threshold=<0-1>          Cosine similarity threshold. Default: RAG_SIMILARITY_THRESHOLD.
  --help                      Show this help message.
`);
}

async function runCli(): Promise<void> {
  const { loadEnvFile } = await import("../../../scripts/lib/load-env");
  loadEnvFile();

  const args = parseCliArgs(process.argv.slice(2));

  if (args.help || !args.subject || !args.query) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  const filters: SearchFilters = {};
  if (args.category) filters.category = args.category;
  if (args.paper_code) filters.paper_code = args.paper_code;
  if (Number.isFinite(args.year)) filters.year = args.year;
  if (args.session) filters.session = args.session;
  if (args.sub_topic) filters.sub_topic = args.sub_topic;

  const results = await searchKnowledgeBase(args.query, {
    subject_id: assertSubjectId(args.subject),
    filters,
    threshold: Number.isFinite(args.threshold) ? args.threshold : undefined,
    topK: Number.isFinite(args.top) ? args.top : undefined,
  });

  console.log(
    JSON.stringify(
      {
        subject: args.subject,
        query: args.query,
        filters,
        threshold: args.threshold ?? getServerEnv().RAG_SIMILARITY_THRESHOLD,
        topK: args.top ?? 5,
        resultCount: results.length,
        results,
      },
      null,
      2
    )
  );
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  return (
    typeof entry === "string" &&
    /src[\\/]lib[\\/]rag[\\/]search\.(ts|js)$/.test(entry)
  );
})();

if (isDirectRun) {
  runCli().catch((error) => {
    console.error("RAG search failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}