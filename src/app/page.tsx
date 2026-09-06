"use client";

import { useState } from "react";
import Link from "next/link";
import { ClockIcon } from "lucide-react";

import { ActivityLogDrawer } from "@/components/activity/ActivityLogDrawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  MODULES,
  getDefaultModule,
  getVisibleModules,
  type ModuleId,
} from "@/lib/context-guard";
import { SUBJECTS } from "@/lib/subjects";

const MODULE_BLURBS: Record<ModuleId, string> = {
  notes: "Revision notes generated from past-paper content for a chosen syllabus topic.",
  "answer-assistant":
    "A structured scaffold — key points and a paragraph outline — for a past-paper question.",
  "answer-checker":
    "Submit an answer, typed or photographed, for mark-scheme feedback, a level and a grade.",
};

export default function Home() {
  const [activityOpen, setActivityOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-bisque text-black selection:bg-atlas selection:text-bisque font-sans">
      {/* Top Action Bar */}
      <header className="sticky top-0 z-40 h-16 w-full border-b border-black bg-bisque">
        <div className="mx-auto flex h-full w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="text-xl font-black uppercase tracking-tight text-atlas">
            EduFix PK
          </Link>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setActivityOpen(true)}
            className="flex items-center gap-2 border border-atlas px-3.5 py-2 font-mono text-xs font-bold uppercase text-atlas transition-colors hover:bg-atlas hover:text-bisque active:scale-[0.98]"
          >
            <ClockIcon className="size-4" />
            <span>My Activity</span>
          </Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-16 px-4 py-12 sm:px-6 lg:px-8">
        {/* Hero Section */}
        <section className="grid grid-cols-1 items-start gap-10 border-b border-black pb-12 lg:grid-cols-12 lg:gap-12" data-purpose="hero-overview">
          <div className="space-y-6 lg:col-span-6">
            <div className="inline-block border border-atlas bg-transparent px-3 py-1 font-mono text-xs font-semibold uppercase tracking-wider text-atlas">
              CAIE O Levels · Pakistan
            </div>
            <h1 className="text-4xl font-black tracking-tight text-atlas uppercase sm:text-5xl lg:text-6xl">
              EduFix PK
            </h1>
            <p className="max-w-xl text-base leading-relaxed text-black sm:text-lg">
              Past-paper-grounded AI study support for Pakistan Studies, Islamiyat,
              and Urdu. Every note, scaffold and grade is retrieved from real CAIE
              past papers and mark schemes — and if the knowledge base can&apos;t
              support an answer, EduFix says so instead of inventing one.
            </p>

            <div className="flex flex-wrap gap-4 pt-2">
              <a
                href="#subjects"
                className="hard-shadow inline-flex items-center justify-center bg-atlas px-6 py-3 font-mono text-xs font-bold uppercase tracking-wider text-bisque transition-colors hover:bg-atlas-hover active:scale-[0.98]"
              >
                Explore Subjects
              </a>
              <a
                href="#modules"
                className="hard-shadow inline-flex items-center justify-center border border-black bg-bisque px-6 py-3 font-mono text-xs font-bold uppercase tracking-wider text-black transition-colors hover:bg-black hover:text-bisque active:scale-[0.98]"
              >
                View Module Capabilities
              </a>
            </div>

            <div className="mt-6 border-t border-black pt-4">
              <div className="flex items-start gap-3">
                <span className="mt-1.5 inline-block h-2.5 w-2.5 bg-atlas"></span>
                <p className="font-mono text-xs text-black">
                  Strict Zero-Hallucination Protocol: Subject retrieval vectors isolated to Cambridge International Education official mark schemes (2015-2023).
                </p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="hard-shadow-atlas flex items-center justify-center border-2 border-black bg-bisque p-8">
              <img
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuDCuTfD85JkAHTXfTmTeNvZ0ub5bK0cQuPBS0fAyTSvVDC6NZe7y5VBWRCbHLar8OxtfJKcMKE3al8u0VFidlQDi_MdoQ_fGyxXc3JALYnIlHyj5wObfhFHOSOAR4xHKwzxiAPv-_nPo8kAUrE6P_JJdpAWWc3y0pP4SbB8CMkHwCbhkAoMJGYPpaxfZSwS6dQArDxJAX1K4m5FgbDotfpu04QW8XWTAFc8n7i70XEp7byh6H1agHM9fMUacTNbe7bXRg"
                alt="EduFix PK Logo"
                className="h-auto max-w-lg w-full object-contain"
              />
            </div>
          </div>
        </section>

        {/* Subjects Section */}
        <section id="subjects" className="scroll-mt-8 border-b border-black pb-16">
          <div className="mb-12 max-w-2xl">
            <h2 className="text-3xl font-black uppercase tracking-tight text-atlas sm:text-4xl">
              Choose a subject
            </h2>
            <p className="mt-2 text-base text-black font-normal">
              Three subjects, three modules each. Urdu renders right-to-left.
            </p>
          </div>

          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {SUBJECTS.map((subject) => (
              <Card
                key={subject.id}
                className="interactive-card hard-shadow flex flex-col justify-between border-2 border-black bg-white rounded-none p-0"
              >
                <div>
                  <CardHeader className="border-b-2 border-black bg-atlas p-4 text-bisque">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold uppercase tracking-wider">
                        CAIE Syllabus
                      </span>
                      <span className="border border-bisque bg-atlas-hover px-2 py-0.5 font-mono text-xs">
                        {subject.code}
                      </span>
                    </div>
                    <CardTitle className="text-xl font-bold uppercase tracking-tight text-bisque">
                      {subject.name}
                    </CardTitle>
                  </CardHeader>

                  <CardContent className="space-y-4 p-6">
                    <CardDescription className="text-xs text-black leading-relaxed">
                      Complete database of mark schemes and syllabus requirements isolated for {subject.name}.
                    </CardDescription>

                    {subject.dir === "rtl" ? (
                      <div className="flex items-center justify-between border border-black bg-bisque-light p-2" dir="rtl">
                        <span className="font-urdu text-sm font-bold text-atlas">اردو زبان اور تفہیم</span>
                        <Badge variant="outline" className="rounded-none border-0 bg-atlas font-mono text-[10px] text-bisque uppercase">
                          RTL Mode
                        </Badge>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2 pt-1">
                        <span className="border border-black bg-bisque-light px-2 py-0.5 font-mono text-[11px] font-medium">
                          Syllabus 2024-2026
                        </span>
                      </div>
                    )}
                  </CardContent>
                </div>

                <div className="space-y-2 p-6 pt-0">
                  {getVisibleModules(subject.id).map((module) => {
                    const isPrimary = module.id === getDefaultModule(subject.id);
                    return (
                      <Button
                        key={module.id}
                        asChild
                        variant="ghost"
                        className={
                          isPrimary
                            ? "hard-shadow-sm w-full justify-center rounded-none bg-atlas font-mono text-xs font-bold uppercase tracking-wider text-bisque hover:bg-atlas-hover hover:text-bisque"
                            : "w-full justify-center rounded-none border border-black bg-bisque font-mono text-[11px] font-bold text-black hover:bg-black hover:text-bisque"
                        }
                      >
                        <Link href={`/${subject.id}/${module.id}`}>
                          {module.label}
                        </Link>
                      </Button>
                    );
                  })}
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* Modules Explainer Section */}
        <section id="modules" className="flex flex-col gap-8">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-black uppercase tracking-tight text-atlas sm:text-4xl">
              What each module does
            </h2>
            <p className="mt-2 text-base font-normal text-black">
              Rigorous CAIE syllabus parsing designed to prevent hallucination by enforcing citation constraints.
            </p>
          </div>

          <div className="grid gap-8 sm:grid-cols-3">
            {MODULES.map((module, index) => (
              <article
                key={module.id}
                className="hard-shadow flex flex-col justify-between border-2 border-black bg-bisque-light p-6"
              >
                <div>
                  <div className="mb-4 flex items-center justify-between border-b border-black pb-3">
                    <span className="font-mono text-xs font-bold uppercase tracking-wider text-atlas">
                      Module 0{index + 1}
                    </span>
                    <span className="border border-black px-2 py-0.5 font-mono text-xs text-black">
                      {module.id === "notes" ? "Syllabus Key" : module.id === "answer-assistant" ? "Scaffolding" : "Assessment"}
                    </span>
                  </div>
                  <h3 className="mb-3 font-mono text-2xl font-black lowercase tracking-tight text-black">
                    {module.label}
                  </h3>
                  <p className="mb-6 font-normal text-sm leading-relaxed text-black">
                    {MODULE_BLURBS[module.id]}
                  </p>
                </div>

                <div className="space-y-2 border-t border-black pt-4">
                  <div className="flex items-center gap-2 font-mono text-xs">
                    <span className="h-2 w-2 bg-atlas"></span>
                    <span className="text-black">Strict Mark Scheme Grounding</span>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="hard-shadow border-2 border-black bg-white p-6">
            <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
              <div className="space-y-1">
                <span className="block font-mono text-xs font-bold uppercase tracking-wider text-atlas">
                  Strict Refusal Standard
                </span>
                <p className="max-w-2xl font-mono text-xs text-black">
                  If an inquiry falls outside verified past papers, examiner reports or syllabus limits, EduFix explicitly reports insufficient grounding rather than generating unverified content.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-black bg-bisque py-12">
        <div className="mx-auto max-w-7xl space-y-8 px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl border-l-4 border-atlas pl-4">
            <p className="text-sm font-semibold leading-relaxed text-black sm:text-base">
              EduFix PK — grounded in CAIE past papers and mark schemes. Retrieval is subject-isolated; no answer is generated without a source.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-8 border-t border-black pt-6 font-mono text-xs md:grid-cols-4">
            <div>
              <span className="mb-2 block font-bold uppercase text-atlas">Subject Coverage</span>
              <ul className="space-y-1 text-black">
                <li>Pakistan Studies (2059)</li>
                <li>Islamiyat (2058)</li>
                <li>Urdu (3248 / 3247)</li>
              </ul>
            </div>
            <div>
              <span className="mb-2 block font-bold uppercase text-atlas">Core Modules</span>
              <ul className="space-y-1 text-black">
                <li>Notes Generator</li>
                <li>Answer Assistant</li>
                <li>Mark Scheme Checker</li>
              </ul>
            </div>
            <div>
              <span className="mb-2 block font-bold uppercase text-atlas">Database Scope</span>
              <ul className="space-y-1 text-black">
                <li>Sessions: May/June & Oct/Nov</li>
                <li>Years Included: 2015-2023</li>
              </ul>
            </div>
            <div>
              <span className="mb-2 block font-bold uppercase text-atlas">Legal</span>
              <p className="text-[11px] leading-normal text-gray-800">
                Cambridge Assessment International Education (CAIE) is a registered trademark. EduFix PK is an independent preparation system.
              </p>
            </div>
          </div>
        </div>
      </footer>

      {/* Activity Log Drawer */}
      <ActivityLogDrawer
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
      />
    </div>
  );
}