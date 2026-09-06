"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui";
import { useRouter } from "next/navigation";
import { ClockIcon, Trash2Icon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FeatureType = "notes" | "answer_assistant" | "answer_checker";

interface ActivityRow {
  id: string;
  feature_type: FeatureType;
  title: string;
  created_at: string;
}

const FEATURE_PATH: Record<FeatureType, string> = {
  notes: "notes",
  answer_assistant: "answer-assistant",
  answer_checker: "answer-checker",
};

const FEATURE_LABEL: Record<FeatureType, string> = {
  notes: "Notes",
  answer_assistant: "Answer Assistant",
  answer_checker: "Answer Checker",
};

const FEATURE_BADGE_CLASS: Record<FeatureType, string> = {
  notes: "bg-[#82193A] text-[#FEE3C5] border border-black",
  answer_assistant: "bg-[#FEE3C5] text-[#82193A] border border-[#82193A]",
  answer_checker: "bg-black text-[#FEE3C5] border border-black",
};

const FEATURE_ACTION_LABEL: Record<FeatureType, string> = {
  notes: "VIEW NOTES →",
  answer_assistant: "LOAD SCAFFOLD →",
  answer_checker: "VIEW REPORT →",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function getActiveSubject(): string {
  try {
    return localStorage.getItem("edufixpk:lastSubject") ?? "pakistan-studies";
  } catch {
    return "pakistan-studies";
  }
}

// ---------------------------------------------------------------------------
// ActivityLogDrawer Component
// ---------------------------------------------------------------------------

interface ActivityLogDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function ActivityLogDrawer({ open, onClose }: ActivityLogDrawerProps) {
  const router = useRouter();
  const [rows, setRows] = React.useState<ActivityRow[]>([]);
  const [loading, setLoading] = React.useState(false);

  // Fetch activities whenever the drawer opens
  React.useEffect(() => {
    if (!open) return;

    setLoading(true);
    (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData?.user?.id;

        if (!userId) {
          setRows([]);
          return;
        }

        const { data, error } = await supabase
          .from("user_activities")
          .select("id, feature_type, title, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50);

        if (error) {
          console.error("Failed to fetch activity log:", error);
          setRows([]);
        } else {
          setRows((data ?? []) as ActivityRow[]);
        }
      } catch (e) {
        console.error("Unexpected error fetching activity log:", e);
        setRows([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  function handleCardClick(row: ActivityRow) {
    const subject = getActiveSubject();
    const path = FEATURE_PATH[row.feature_type];
    router.push(`/${subject}/${path}?activityId=${row.id}`);
    onClose();
  }

  async function handleDelete(
    e: React.MouseEvent | React.KeyboardEvent,
    id: string
  ) {
    e.stopPropagation();
    // Optimistic update
    setRows((prev) => prev.filter((r) => r.id !== id));
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase
        .from("user_activities")
        .delete()
        .eq("id", id);
      if (error) {
        console.error("Failed to delete activity:", error);
      }
    } catch (e) {
      console.error("Unexpected error deleting activity:", e);
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogPrimitive.Portal>
        {/* Backdrop Overlay */}
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/40",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
            "duration-150"
          )}
        />

        {/* Drawer Panel */}
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex w-full max-w-full sm:w-[440px] flex-col",
            "bg-white border-l border-black shadow-none select-text",
            "data-[state=open]:animate-in data-[state=open]:slide-in-from-right",
            "data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right",
            "duration-200 ease-out"
          )}
        >
          {/* Header */}
          <div className="h-14 px-5 bg-[#FEE3C5] border-b border-black flex items-center justify-between flex-shrink-0">
            <div className="flex items-center space-x-2.5">
              <ClockIcon className="w-4 h-4 text-black flex-shrink-0" />
              <DialogPrimitive.Title className="font-mono text-sm font-bold tracking-wider uppercase text-black">
                My Activity
              </DialogPrimitive.Title>
            </div>
            <DialogPrimitive.Close
              aria-label="Close activity log"
              className="p-1.5 border border-black bg-white text-black hover:bg-[#82193A] hover:text-[#FEE3C5] transition-all duration-150 active:scale-95 focus:outline-none focus:ring-1 focus:ring-black"
            >
              <XIcon className="w-4 h-4" />
            </DialogPrimitive.Close>
          </div>

          {/* Editorial Context Sub-bar */}
          <div className="px-5 py-2 bg-[#FFF6EC] border-b border-black flex items-center justify-between text-[11px] font-mono text-black/75 flex-shrink-0">
            <span className="flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 bg-[#82193A]" />
              <span className="uppercase tracking-wider font-semibold">
                Supabase Persistence Active
              </span>
            </span>
            <span className="font-bold text-black">
              {loading ? "FETCHING..." : `${rows.length} ITEMS`}
            </span>
          </div>

          {/* Drawer Body / Scroll Area */}
          <ScrollAreaPrimitive.Root className="flex-1 overflow-hidden bg-white">
            <ScrollAreaPrimitive.Viewport className="h-full w-full">
              {loading ? (
                <div className="p-5 space-y-3">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="p-3.5 bg-[#FFF6EC] border border-black/20 animate-pulse"
                      style={{ animationDuration: "1.4s" }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="h-4 w-16 bg-[#82193A]/20 border border-black/20" />
                        <div className="h-3 w-12 bg-black/10" />
                      </div>
                      <div className="h-4 w-5/6 bg-black/15 mb-2" />
                      <div className="h-3 w-1/2 bg-black/10" />
                    </div>
                  ))}
                </div>
              ) : rows.length === 0 ? (
                <div className="py-16 px-4 text-center">
                  <div className="w-10 h-10 border border-black mx-auto mb-3 flex items-center justify-center bg-[#FFF6EC]">
                    <ClockIcon className="w-5 h-5 text-black/50" />
                  </div>
                  <p className="font-mono text-sm font-semibold text-[#333333]">
                    No activity yet.
                  </p>
                  <p className="text-xs font-mono text-black/50 mt-1">
                    Generated notes, scaffolds, and evaluated answers will be stored here.
                  </p>
                </div>
              ) : (
                <ul className="p-5 space-y-3">
                  {rows.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => handleCardClick(row)}
                        className="group relative w-full text-left p-3.5 bg-white border border-black/30 hover:border-black hover:bg-[#FFF6EC] transition-all duration-150 active:scale-[0.99] block cursor-pointer"
                      >
                        {/* Feature Badge & Relative Timestamp */}
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <span
                            className={cn(
                              "inline-flex items-center px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider",
                              FEATURE_BADGE_CLASS[row.feature_type]
                            )}
                          >
                            {FEATURE_LABEL[row.feature_type]}
                          </span>

                          <span className="text-[11px] font-mono text-black/60 flex-shrink-0">
                            {formatTimestamp(row.created_at)}
                          </span>
                        </div>

                        {/* Activity Title */}
                        <p className="font-serif font-bold text-sm text-black leading-snug line-clamp-2 pr-6">
                          {row.title}
                        </p>

                        {/* Action Callout */}
                        <div className="mt-2 flex items-center justify-end text-[10px] font-mono pt-1 border-t border-black/10">
                          <span className="text-[#82193A] font-semibold">
                            {FEATURE_ACTION_LABEL[row.feature_type]}
                          </span>
                        </div>

                        {/* Delete Button */}
                        <span
                          role="button"
                          aria-label="Delete activity"
                          tabIndex={0}
                          onClick={(e) => handleDelete(e, row.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              handleDelete(e, row.id);
                            }
                          }}
                          className="absolute top-3 right-3 p-1 text-black/40 hover:text-[#82193A] hover:bg-white border border-transparent hover:border-black transition-all duration-150 active:scale-95 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-black"
                        >
                          <Trash2Icon className="w-3.5 h-3.5" />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollAreaPrimitive.Viewport>
            <ScrollAreaPrimitive.Scrollbar
              orientation="vertical"
              className="flex w-1.5 touch-none select-none p-px bg-[#FFF6EC]"
            >
              <ScrollAreaPrimitive.Thumb className="relative flex-1 bg-black/40" />
            </ScrollAreaPrimitive.Scrollbar>
          </ScrollAreaPrimitive.Root>

          {/* Drawer Footer */}
          <div className="p-4 bg-[#FEE3C5] border-t border-black flex-shrink-0">
            <div className="flex items-center justify-between text-[11px] font-mono text-black/70">
              <span>STORAGE: SUPABASE DATABASE</span>
              <span className="font-bold uppercase text-[10px] text-black">
                EDUFIX PK
              </span>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}