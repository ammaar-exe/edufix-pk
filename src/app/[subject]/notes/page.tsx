import { redirect } from "next/navigation";

import { NotesStudio } from "@/components/notes/NotesStudio";
import { getDefaultModule, isModuleVisible } from "@/lib/context-guard";
import { getEffectiveTaxonomy } from "@/lib/kb/subtopics";
import { getSubject, isSubjectId } from "@/lib/subjects";

interface NotesPageProps {
  params: Promise<{ subject: string }>;
}

export default async function NotesPage({ params }: NotesPageProps) {
  const { subject } = await params;

  // Req #2 — the Note Generator is hidden for Urdu; redirect direct /urdu/notes
  // hits to Urdu's default visible module so the feature is fully unreachable.
  if (isSubjectId(subject) && !isModuleVisible(subject, "notes")) {
    redirect(`/${subject}/${getDefaultModule(subject)}`);
  }

  const subjectInfo = getSubject(subject);
  const taxonomy = subjectInfo
    ? getEffectiveTaxonomy(subjectInfo.id)
    : undefined;

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8 bg-bisque min-h-screen text-black selection:bg-atlas selection:text-bisque">
      {/* Top Header & Metadata Panel */}
      <section className="border-b border-black/30 pb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 border border-black bg-white px-2.5 py-0.5 text-[11px] font-mono font-bold tracking-wider mb-2">
              <span className="text-black">■</span>
              <span>MODULE 1 — AI NOTES GENERATOR</span>
            </div>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-black font-serif">
              {subjectInfo?.name ?? subject} Notes
            </h1>
            <p className="mt-1 text-xs sm:text-sm font-mono text-atlas tracking-tight font-medium flex flex-wrap items-center gap-2">
              <span>
                Subject code{" "}
                <strong className="text-black font-bold">
                  {subjectInfo?.code ?? "—"}
                </strong>
              </span>
              <span>•</span>
              <span>Syllabus Taxonomy Active</span>
              <span>•</span>
              <span className="font-bold">Zero-Hallucination Protocol Active</span>
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

      {/* Main Interactive Workspace or Taxonomy Missing Notice */}
      {subjectInfo && taxonomy ? (
        <NotesStudio
          subjectId={subjectInfo.id}
          subjectName={subjectInfo.name}
          subjectCode={subjectInfo.code}
          taxonomy={taxonomy}
        />
      ) : (
        <div className="mb-6 border-2 border-atlas bg-white p-4 font-mono text-xs text-black shadow-none">
          <div className="flex items-start gap-3">
            <span className="bg-atlas text-bisque px-1.5 py-0.5 font-bold text-[10px]">
              NOTICE
            </span>
            <div>
              <p className="font-semibold text-black">
                No syllabus taxonomy is available for this subject yet.
              </p>
              <p className="mt-1 text-neutral-700">
                Run{" "}
                <code className="bg-bisque px-1.5 py-0.5 border border-black font-bold text-black">
                  npx tsx scripts/derive-topics.ts
                </code>{" "}
                to regenerate it from the syllabus source files.
              </p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}