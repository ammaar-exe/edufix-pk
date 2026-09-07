import { AnswerAssistantStudio } from "@/components/answer-assistant/AnswerAssistantStudio";
import { getSubject } from "@/lib/subjects";

interface AnswerAssistantPageProps {
  params: Promise<{ subject: string }>;
}

export default async function AnswerAssistantPage({
  params,
}: AnswerAssistantPageProps) {
  const { subject } = await params;
  const subjectInfo = getSubject(subject);

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8 bg-bisque min-h-screen text-black selection:bg-atlas selection:text-bisque">
      {/* Top Header & Metadata Panel */}
      <section className="border-b border-black/30 pb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 border border-black bg-white px-2.5 py-0.5 text-[11px] font-mono font-bold tracking-wider mb-2">
              <span className="text-black">■</span>
              <span>MODULE 2 — GUIDED ANSWERING AGENT</span>
            </div>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-black font-serif">
              {subjectInfo?.name ?? subject} Answering Assistant
            </h1>
            <p className="mt-1 text-xs sm:text-sm font-mono text-atlas tracking-tight font-medium flex flex-wrap items-center gap-2">
              <span>
                Subject code{" "}
                <strong className="text-black font-bold">
                  {subjectInfo?.code ?? "—"}
                </strong>
              </span>
              <span>•</span>
              <span>Vector Grounded: 2015–2023 Mark Schemes</span>
              <span>•</span>
              <span className="font-bold">
                Zero-Hallucination Protocol Active
              </span>
            </p>
          </div>

          {/* Active Component Badges */}
          {subjectInfo && (
            <div className="flex flex-col sm:items-end gap-1.5">
              <span className="text-[10px] font-mono uppercase text-black/70 font-bold tracking-widest">
                Active Components
              </span>
              <div className="flex gap-2 font-mono text-[11px]">
                <span className="border border-black bg-white px-2 py-0.5 font-bold text-black">
                  {subjectInfo.code}/01
                </span>
                <span className="border border-black bg-white px-2 py-0.5 font-medium text-black/80">
                  {subjectInfo.code}/02
                </span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Main Interactive Workspace / Fallback Banner */}
      {subjectInfo ? (
        <AnswerAssistantStudio key={subjectInfo.id} subjectId={subjectInfo.id} />
      ) : (
        <div className="mb-6 border-2 border-atlas bg-white p-3 flex items-start justify-between gap-4 text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className="bg-atlas text-bisque px-1.5 py-0.5 font-bold text-[10px]">
              NOTICE
            </span>
            <span className="text-black font-semibold">
              Unknown subject &ldquo;{subject}&rdquo;. Choose Pakistan Studies,
              Islamiyat or Urdu from the navigation.
            </span>
          </div>
        </div>
      )}
    </main>
  );
}
