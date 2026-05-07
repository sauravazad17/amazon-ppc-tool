import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { z } from "zod";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Copy,
  Check,
  Download,
  Zap,
  ExternalLink,
  RotateCcw,
  AlertCircle,
  Search,
  ChevronDown,
  ChevronUp,
  Layers,
  Target,
  BarChart3,
  Sparkles,
  TrendingUp,
  Star,
  CheckSquare,
  Square,
  Package,
  Tag,
  Clock,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useGenerateKeywords } from "@workspace/api-client-react";
import type { CompetitorTarget } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const ASIN_REGEX = /B0[A-Z0-9]{8}/g;

const formSchema = z.object({
  asinsRaw: z.string().default(""),
  title: z.string().default(""),
}).superRefine((data, ctx) => {
  const asins = data.asinsRaw.toUpperCase().match(ASIN_REGEX) || [];
  if (asins.length === 0 && data.title.length < 4) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Enter at least one valid ASIN or a product title (min 4 chars)",
      path: ["asinsRaw"],
    });
  }
});

type FormValues = z.infer<typeof formSchema>;

const LOADING_PHRASES = [
  "Reading product from Amazon…",
  "Distilling product type and attributes…",
  "Generating high-intent keywords…",
  "Searching for live competitor ASINs…",
  "Curating and ranking targets…",
];

export default function Home() {
  const { toast } = useToast();
  const mutation = useGenerateKeywords();
  const [loadingPhraseIndex, setLoadingPhraseIndex] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showTitleInput, setShowTitleInput] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { asinsRaw: "", title: "" },
  });

  const asinsRaw = useWatch({ control: form.control, name: "asinsRaw" });

  const asinStats = useMemo(() => {
    if (!asinsRaw) return { valid: 0, invalid: 0 };
    const tokens = asinsRaw.split(/[\s,]+/).filter(Boolean);
    const matches = asinsRaw.toUpperCase().match(ASIN_REGEX) || [];
    return { valid: matches.length, invalid: Math.max(0, tokens.length - matches.length) };
  }, [asinsRaw]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (mutation.isPending) {
      setLoadingPhraseIndex(0);
      startTimeRef.current = performance.now();
      interval = setInterval(() => {
        setLoadingPhraseIndex((prev) => (prev + 1) % LOADING_PHRASES.length);
      }, 2800);
    } else if (mutation.isSuccess && startTimeRef.current) {
      setDuration((performance.now() - startTimeRef.current) / 1000);
      startTimeRef.current = null;
    }
    return () => clearInterval(interval);
  }, [mutation.isPending, mutation.isSuccess]);

  const onSubmit = (data: FormValues) => {
    const parsedAsins = data.asinsRaw.toUpperCase().match(ASIN_REGEX);
    mutation.mutate({ data: { asins: parsedAsins, title: data.title || undefined } });
  };

  const handleReset = () => {
    form.reset();
    mutation.reset();
    setDuration(null);
    setSelectedTargets(new Set());
  };

  useEffect(() => {
    if (!mutation.data?.items) return;
    const allKeys = new Set<string>();
    mutation.data.items.forEach(item => {
      const base = item.asin || "title";
      (item.competitor_targets ?? []).forEach(t => allKeys.add(`${base}|${t.asin}|${t.category}`));
    });
    setSelectedTargets(allKeys);
  }, [mutation.data]);

  const toggleTarget = useCallback((key: string) => {
    setSelectedTargets(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text");
    const matches = text.toUpperCase().match(ASIN_REGEX);
    if (matches && matches.length > 0) {
      e.preventDefault();
      const existing = form.getValues("asinsRaw");
      const existingAsins = existing.toUpperCase().match(ASIN_REGEX) || [];
      const combined = Array.from(new Set([...existingAsins, ...matches]));
      form.setValue("asinsRaw", combined.join("\n"));
    }
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 700);
    } catch {
      toast({ variant: "destructive", title: "Failed to copy", description: "Please try again." });
    }
  };

  const exportCSV = () => {
    if (!mutation.data?.items) return;
    const escape = (val: string) => (val.includes(",") || val.includes('"')) ? `"${val.replace(/"/g, '""')}"` : val;
    let csvRows = ["ASIN,Type,Keyword/Target"];
    mutation.data.items.forEach(item => {
      const asinVal = item.asin || "(title)";
      (["High Intent", "Core", "Long Tail"] as const).forEach(type => {
        item.keywords.filter(k => k.type === type).forEach(k => {
          csvRows.push(`${asinVal},${type},${escape(k.value)}`);
        });
      });
      (item.competitor_targets ?? []).forEach(target => {
        const key = `${asinVal}|${target.asin}|${target.category}`;
        if (selectedTargets.has(key)) csvRows.push(`${asinVal},${target.category},${target.asin}`);
      });
    });
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `amazon-ppc-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyAllKeywords = () => {
    if (!mutation.data?.items) return;
    const allKws = Array.from(new Set(mutation.data.items.flatMap(item => item.keywords.map(k => k.value)))).join("\n");
    copyToClipboard(allKws, "copy-all");
    toast({ title: "All keywords copied", description: "Pasted to your clipboard." });
  };

  const totalKws = mutation.data?.items.reduce((acc, item) => acc + (item.keywords?.length || 0), 0) || 0;
  const totalTargets = mutation.data?.items.reduce((acc, item) => acc + (item.competitor_targets?.length || 0), 0) || 0;

  return (
    <div className="flex flex-col min-h-screen bg-[#f4f6fb] font-sans text-slate-900">
      {/* ── Top bar ── */}
      <header className="sticky top-0 z-50 h-14 flex items-center justify-between px-6 bg-white border-b border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <div className="flex items-center gap-3">
          <SparkLogo />
          <span className="font-bold text-[15px] tracking-tight bg-gradient-to-r from-violet-600 via-blue-600 to-cyan-500 bg-clip-text text-transparent">
            New ASIN AK14 Keyword Research
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">Live Amazon Search</span>
        </div>
      </header>

      {/* ── Two-panel layout ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT PANEL — fixed input ── */}
        <aside className="w-[340px] shrink-0 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto bg-white border-r border-slate-200/80 flex flex-col shadow-[2px_0_16px_rgba(0,0,0,0.04)]">
          <div className="p-5 flex-1">
            <div className="mb-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-500 mb-0.5">Input</p>
              <h2 className="text-xl font-bold text-slate-900">Enter ASINs</h2>
              <p className="text-xs text-slate-400 mt-0.5">One per line, or paste comma-separated.</p>
            </div>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                <FormField
                  control={form.control}
                  name="asinsRaw"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between mb-1.5">
                        <FormLabel className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                          Amazon ASINs
                        </FormLabel>
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold">
                          {asinStats.valid > 0 && (
                            <span className="bg-emerald-100 text-emerald-700 rounded px-1.5 py-0.5">
                              {asinStats.valid} valid
                            </span>
                          )}
                          {asinStats.invalid > 0 && (
                            <span className="bg-rose-100 text-rose-600 rounded px-1.5 py-0.5">
                              {asinStats.invalid} invalid
                            </span>
                          )}
                        </div>
                      </div>
                      <FormControl>
                        <Textarea
                          placeholder={"B07FZ8S74R\nB0BDHWDR12\nB09XYZ1234…"}
                          className="bg-[#fafbff] border-slate-200 focus-visible:ring-violet-400 focus-visible:border-violet-300 min-h-[150px] font-mono text-[12px] resize-none text-slate-900 placeholder:text-slate-300 rounded-lg"
                          onPaste={handlePaste}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription className="text-[10px] text-slate-400 mt-1">
                        Up to 15 ASINs · auto-formatted on paste
                      </FormDescription>
                      <FormMessage className="text-rose-500 text-[11px]" />
                    </FormItem>
                  )}
                />

                {/* Optional title toggle */}
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowTitleInput(!showTitleInput)}
                    className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-600 hover:text-violet-700 transition-colors"
                  >
                    {showTitleInput ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    Use a product title instead
                  </button>
                  <AnimatePresence>
                    {showTitleInput && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <FormField
                          control={form.control}
                          name="title"
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Textarea
                                  placeholder="Enter full product title…"
                                  className="bg-[#fafbff] border-slate-200 focus-visible:ring-violet-400 min-h-[80px] text-xs rounded-lg"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage className="text-rose-500 text-[11px]" />
                            </FormItem>
                          )}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <Button
                  type="submit"
                  disabled={mutation.isPending}
                  className="w-full py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white border-0 shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 transition-all hover:-translate-y-0.5 active:translate-y-0"
                >
                  {mutation.isPending ? (
                    <span className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span className="text-xs">{LOADING_PHRASES[loadingPhraseIndex]}</span>
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <Sparkles className="w-4 h-4" />
                      Generate Keywords
                    </span>
                  )}
                </Button>
              </form>
            </Form>
          </div>

          {/* How it works */}
          <div className="px-5 pb-5">
            <div className="rounded-xl bg-slate-50 border border-slate-100 p-4 space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">How it works</p>
              {[
                { icon: <Package className="w-3.5 h-3.5 text-violet-500" />, text: "Scrapes live Amazon listing for real title & brand" },
                { icon: <Sparkles className="w-3.5 h-3.5 text-blue-500" />, text: "AI generates 30 PPC keywords in 3 categories" },
                { icon: <Target className="w-3.5 h-3.5 text-rose-500" />, text: "Finds 5+5 live competitor ASINs via Amazon search" },
              ].map((row, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <div className="mt-0.5 shrink-0">{row.icon}</div>
                  <p className="text-[11px] text-slate-500 leading-snug">{row.text}</p>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* ── RIGHT PANEL — scrollable results ── */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          <AnimatePresence mode="wait">

            {/* Empty state */}
            {!mutation.data && !mutation.isPending && (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center min-h-full py-24 px-8 text-center"
              >
                <motion.div
                  initial={{ scale: 0.85, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", duration: 0.5 }}
                  className="relative w-20 h-20 mb-8"
                >
                  <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-violet-400 to-blue-400 blur-xl opacity-30 animate-pulse" />
                  <div className="relative w-20 h-20 rounded-3xl bg-white border border-slate-200 flex items-center justify-center shadow-xl">
                    <Search className="w-8 h-8 text-violet-400" />
                  </div>
                </motion.div>
                <h2 className="text-2xl font-bold text-slate-800 mb-2">Ready to Analyze</h2>
                <p className="text-sm text-slate-400 mb-8">Enter one or more ASINs in the left panel, then click Generate.</p>
                <div className="space-y-3 max-w-xs text-left">
                  {[
                    { dot: "bg-gradient-to-br from-violet-500 to-fuchsia-500", text: <><strong className="text-slate-700">Distills</strong> long Amazon titles into the real product type.</> },
                    { dot: "bg-gradient-to-br from-blue-500 to-cyan-500",     text: <><strong className="text-slate-700">30 conversion-grade</strong> keywords per ASIN.</> },
                    { dot: "bg-gradient-to-br from-orange-400 to-amber-400",  text: <><strong className="text-slate-700">5 Higher-Price</strong> competitor targets per ASIN.</> },
                    { dot: "bg-gradient-to-br from-emerald-400 to-teal-500",  text: <><strong className="text-slate-700">5 Lower-Rating</strong> competitor targets per ASIN.</> },
                  ].map((row, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.1 + i * 0.07 }}
                      className="flex items-start gap-3"
                    >
                      <div className={cn("w-5 h-5 rounded-full bg-gradient-to-br flex items-center justify-center shrink-0 mt-0.5", row.dot)}>
                        <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                      </div>
                      <p className="text-sm text-slate-500">{row.text}</p>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Loading state */}
            {mutation.isPending && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="p-8 space-y-5"
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-5 h-5 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin" />
                  <span className="text-sm font-medium text-slate-500 animate-pulse">{LOADING_PHRASES[loadingPhraseIndex]}</span>
                </div>
                {[1, 2].map(i => (
                  <div key={i} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    <div className="p-5 border-b border-slate-100 flex gap-4">
                      <Skeleton className="w-20 h-20 rounded-xl shrink-0" />
                      <div className="flex-1 space-y-2.5 pt-1">
                        <Skeleton className="h-3 w-20" />
                        <Skeleton className="h-5 w-3/4" />
                        <Skeleton className="h-3 w-48" />
                      </div>
                    </div>
                    <div className="p-5 grid grid-cols-3 gap-4">
                      <Skeleton className="h-36 rounded-xl" />
                      <Skeleton className="h-36 rounded-xl" />
                      <Skeleton className="h-36 rounded-xl" />
                    </div>
                  </div>
                ))}
              </motion.div>
            )}

            {/* Results */}
            {mutation.data && (
              <motion.div
                key="results"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                {/* Results toolbar */}
                <div className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-200/80 px-6 py-2.5 flex items-center justify-between shadow-sm">
                  <div className="flex items-center gap-5 text-xs">
                    <StatPill label="Products" value={mutation.data.items.length} color="text-slate-700" />
                    <StatPill label="Keywords" value={totalKws} color="text-violet-600" />
                    <StatPill label="Targets" value={totalTargets} color="text-rose-500" />
                    {duration !== null && (
                      <span className="flex items-center gap-1 text-slate-400 text-[10px]">
                        <Clock className="w-3 h-3" /> {duration.toFixed(1)}s
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <ActionBtn onClick={copyAllKeywords} icon={copiedId === "copy-all" ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />} label="Copy Keywords" />
                    <ActionBtn onClick={exportCSV} icon={<Download className="w-3.5 h-3.5" />} label="Export CSV" />
                    <button
                      onClick={handleReset}
                      className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 hover:text-rose-500 transition-colors px-2 py-1.5 rounded-lg hover:bg-rose-50"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Reset
                    </button>
                  </div>
                </div>

                <div className="p-6 space-y-5">
                  {mutation.data.items.length === 1 ? (
                    <ResultCard item={mutation.data.items[0]} index={0} selectedTargets={selectedTargets} onToggleTarget={toggleTarget} />
                  ) : (
                    <Accordion type="single" collapsible defaultValue="item-0" className="space-y-4">
                      {mutation.data.items.map((item, idx) => (
                        <AccordionItem key={idx} value={`item-${idx}`} className="border-none">
                          <AccordionTrigger className="bg-white rounded-xl px-4 py-3 border border-slate-100 shadow-sm hover:bg-violet-50/40 hover:no-underline transition-colors [&[data-state=open]]:rounded-b-none [&[data-state=open]]:border-b-0">
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-xs font-bold text-white bg-gradient-to-r from-violet-600 to-blue-600 px-2.5 py-0.5 rounded-lg">
                                {item.asin || "TITLE"}
                              </span>
                              <span className="text-sm text-slate-600 truncate max-w-xs">{item.title}</span>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="border border-slate-100 border-t-0 rounded-b-xl p-0 shadow-sm overflow-hidden">
                            <ResultCard item={item} index={idx} noBorder selectedTargets={selectedTargets} onToggleTarget={toggleTarget} />
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  )}
                </div>
              </motion.div>
            )}

            {/* Error state */}
            {mutation.isError && (
              <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-center min-h-full p-12">
                <div className="text-center space-y-3">
                  <AlertCircle className="w-10 h-10 text-rose-400 mx-auto" />
                  <p className="text-slate-700 font-semibold">Something went wrong</p>
                  <p className="text-sm text-slate-400">{(mutation.error as Error)?.message || "Please try again."}</p>
                  <button onClick={handleReset} className="text-sm text-violet-600 hover:underline font-medium">Reset and try again</button>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

// ── Small helpers ──

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] uppercase tracking-widest font-bold text-slate-400">{label}</span>
      <span className={cn("font-bold tabular-nums", color)}>{value}</span>
    </div>
  );
}

function ActionBtn({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 hover:text-violet-700 bg-slate-50 hover:bg-violet-50 border border-slate-200 hover:border-violet-200 rounded-lg px-2.5 py-1.5 transition-all"
    >
      {icon} {label}
    </button>
  );
}

function SparkLogo() {
  return (
    <div className="relative w-9 h-9 shrink-0">
      <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 blur-sm opacity-50 animate-pulse" />
      <motion.div
        className="absolute inset-0 rounded-xl"
        style={{ background: "conic-gradient(from 0deg, #7c3aed, #2563eb, #06b6d4, #7c3aed)" }}
        animate={{ rotate: 360 }}
        transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
      />
      <div className="absolute inset-[2.5px] rounded-[9px] bg-white flex items-center justify-center">
        <motion.div animate={{ scale: [1, 1.12, 1] }} transition={{ duration: 2, repeat: Infinity }}>
          <Sparkles className="w-4 h-4 text-violet-600 fill-violet-500/30" strokeWidth={2.2} />
        </motion.div>
      </div>
    </div>
  );
}

// ── Result Card ──

function ResultCard({ item, index, noBorder, selectedTargets, onToggleTarget }: {
  item: any; index: number; noBorder?: boolean;
  selectedTargets: Set<string>; onToggleTarget: (key: string) => void;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copy = (val: string, id: string) => {
    navigator.clipboard.writeText(val);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 700);
  };

  if (item.error) {
    return (
      <div className={cn("bg-rose-50 border border-rose-200 rounded-2xl p-5 flex gap-3", noBorder && "border-none bg-transparent")}>
        <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-bold text-rose-700">Failed: {item.asin || "product"}</p>
          <p className="text-xs text-rose-500 mt-0.5">{item.error}</p>
        </div>
      </div>
    );
  }

  const targets: CompetitorTarget[] = item.competitor_targets ?? [];
  const higherPrice = targets.filter((t: CompetitorTarget) => t.category === "higher_price");
  const lowerRating = targets.filter((t: CompetitorTarget) => t.category === "lower_rating");
  const userAsin = item.asin || "title";

  return (
    <div className={cn("bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden", noBorder && "border-none rounded-none shadow-none")}>
      
      {/* ── Product header ── */}
      <div className="flex items-start gap-4 p-5 bg-gradient-to-r from-violet-50/60 via-blue-50/30 to-white border-b border-slate-100">
        {/* Thumbnail */}
        <div className="shrink-0 w-[88px] h-[88px] rounded-xl bg-white border border-slate-200 overflow-hidden flex items-center justify-center shadow-sm">
          {item.image
            ? <img src={item.image} alt={item.title} className="w-full h-full object-contain" loading="lazy" onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            : <Package className="w-7 h-7 text-slate-300" />
          }
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          {/* Row 1: ASIN + badges */}
          <div className="flex items-center flex-wrap gap-2 mb-2">
            <span className="font-mono text-xs font-bold text-white bg-gradient-to-r from-violet-600 to-blue-600 px-2.5 py-0.5 rounded-lg tracking-widest">
              {item.asin || "N/A"}
            </span>
            {item.detectedBrand && (
              <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 rounded-md px-2 py-0.5">
                {item.detectedBrand}
              </span>
            )}
            {/* Price — prominent */}
            {item.price != null && (
              <span className="inline-flex items-center gap-1 text-[13px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-0.5">
                <Tag className="w-3 h-3" />
                ${item.price.toFixed(2)}
              </span>
            )}
            {/* Rating — prominent */}
            {item.rating != null && (
              <span className="inline-flex items-center gap-1 text-[13px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-0.5">
                <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                {item.rating.toFixed(1)}
              </span>
            )}
            {item.asin && (
              <a
                href={`https://www.amazon.com/dp/${item.asin}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-slate-400 hover:text-violet-600 transition-colors"
              >
                View on Amazon <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          {/* Row 2: Title */}
          <p className="text-sm font-semibold text-slate-800 leading-snug line-clamp-2">{item.title}</p>
        </div>
      </div>

      {/* ── Keywords ── */}
      <div className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-3.5 h-3.5 text-violet-500" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-slate-600">Keywords</span>
          <span className="text-[10px] text-slate-400">· click any keyword to copy</span>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          <KwPanel label="High Intent" icon={<Zap className="w-3.5 h-3.5" />} color="amber"
            keywords={item.keywords.filter((k: any) => k.type === "High Intent")}
            itemIdx={index} secIdx={0} onCopy={copy} copiedId={copiedId} />
          <KwPanel label="Core Keywords" icon={<Layers className="w-3.5 h-3.5" />} color="blue"
            keywords={item.keywords.filter((k: any) => k.type === "Core")}
            itemIdx={index} secIdx={1} onCopy={copy} copiedId={copiedId} />
          <KwPanel label="Long-Tail" icon={<BarChart3 className="w-3.5 h-3.5" />} color="emerald"
            keywords={item.keywords.filter((k: any) => k.type === "Long Tail")}
            itemIdx={index} secIdx={2} onCopy={copy} copiedId={copiedId} />
        </div>
      </div>

      {/* ── Competitor Targets ── */}
      <div className="px-5 pb-5">
        <div className="flex items-center gap-2 mb-3">
          <Target className="w-3.5 h-3.5 text-rose-500" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-slate-600">Competitor Targets</span>
          <span className="text-[10px] text-slate-400">· ✓ to include in CSV export</span>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <TargetBucket
            label="Higher Price" subtitle="Target competitors charging more — shoppers may switch to your lower price"
            icon={<TrendingUp className="w-3.5 h-3.5" />} accent="orange"
            targets={higherPrice} userAsin={userAsin}
            selectedTargets={selectedTargets} onToggleTarget={onToggleTarget}
            onCopy={copy} copiedId={copiedId} itemIndex={index} bucketKey="hp"
          />
          <TargetBucket
            label="Lower Rating" subtitle="Target competitors with weaker reviews — shoppers may prefer your ratings"
            icon={<Star className="w-3.5 h-3.5" />} accent="blue"
            targets={lowerRating} userAsin={userAsin}
            selectedTargets={selectedTargets} onToggleTarget={onToggleTarget}
            onCopy={copy} copiedId={copiedId} itemIndex={index} bucketKey="lr"
          />
        </div>
      </div>
    </div>
  );
}

// ── Keyword Panel ──

const KW_COLORS: Record<string, { ring: string; header: string; num: string; hover: string; icon: string }> = {
  amber:   { ring: "ring-amber-100 border-amber-100",   header: "bg-amber-50 border-b border-amber-100",   num: "text-amber-500",   hover: "hover:bg-amber-50", icon: "text-amber-500" },
  blue:    { ring: "ring-blue-100 border-blue-100",     header: "bg-blue-50 border-b border-blue-100",     num: "text-blue-500",    hover: "hover:bg-blue-50",  icon: "text-blue-500" },
  emerald: { ring: "ring-emerald-100 border-emerald-100", header: "bg-emerald-50 border-b border-emerald-100", num: "text-emerald-600", hover: "hover:bg-emerald-50", icon: "text-emerald-600" },
};

function KwPanel({ label, icon, color, keywords, itemIdx, secIdx, onCopy, copiedId }: {
  label: string; icon: React.ReactNode; color: string;
  keywords: any[]; itemIdx: number; secIdx: number;
  onCopy: (val: string, id: string) => void; copiedId: string | null;
}) {
  const c = KW_COLORS[color] ?? KW_COLORS.blue;
  const secKey = `sec-${itemIdx}-${secIdx}`;
  return (
    <div className={cn("rounded-xl border overflow-hidden", c.ring)}>
      <div className={cn("flex items-center justify-between px-3 py-2", c.header)}>
        <div className={cn("flex items-center gap-1.5", c.icon)}>{icon}
          <span className="text-[11px] font-bold text-slate-700">{label}</span>
          <span className={cn("text-[10px] font-mono font-bold ml-0.5", c.num)}>({keywords.length})</span>
        </div>
        <button
          onClick={() => onCopy(keywords.map((k: any) => k.value).join("\n"), secKey)}
          className="text-slate-300 hover:text-slate-600 transition-colors"
          title="Copy all"
        >
          {copiedId === secKey ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
      <ul className="bg-white divide-y divide-slate-50">
        {keywords.map((kw: any, i: number) => {
          const id = `kw-${itemIdx}-${secIdx}-${i}`;
          return (
            <li key={i}>
              <button
                onClick={() => onCopy(kw.value, id)}
                className={cn("w-full flex items-center gap-2 px-3 py-[7px] text-left group transition-colors", c.hover)}
              >
                <span className={cn("text-[9px] font-mono font-bold w-4 shrink-0 tabular-nums", c.num)}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-[12px] text-slate-700 flex-1 leading-snug">{kw.value}</span>
                {copiedId === id
                  ? <Check className="w-3 h-3 text-emerald-500 shrink-0" />
                  : <Copy className="w-3 h-3 text-slate-200 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                }
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Target Bucket ──

const TARGET_COLORS: Record<string, { border: string; header: string; badge: string }> = {
  orange: { border: "border-orange-100", header: "bg-gradient-to-r from-orange-50 to-amber-50 border-b border-orange-100", badge: "bg-orange-100 text-orange-700" },
  blue:   { border: "border-blue-100",   header: "bg-gradient-to-r from-blue-50 to-sky-50 border-b border-blue-100",       badge: "bg-blue-100 text-blue-700"   },
};

function TargetBucket({ label, subtitle, icon, accent, targets, userAsin, selectedTargets, onToggleTarget, onCopy, copiedId, itemIndex, bucketKey }: {
  label: string; subtitle: string; icon: React.ReactNode; accent: string;
  targets: CompetitorTarget[]; userAsin: string;
  selectedTargets: Set<string>; onToggleTarget: (key: string) => void;
  onCopy: (val: string, id: string) => void; copiedId: string | null;
  itemIndex: number; bucketKey: string;
}) {
  const c = TARGET_COLORS[accent] ?? TARGET_COLORS.blue;
  const allSelected = targets.length > 0 && targets.every(t => selectedTargets.has(`${userAsin}|${t.asin}|${t.category}`));
  const toggleAll = () => {
    targets.forEach(t => {
      const key = `${userAsin}|${t.asin}|${t.category}`;
      const has = selectedTargets.has(key);
      if (allSelected ? has : !has) onToggleTarget(key);
    });
  };

  return (
    <div className={cn("rounded-xl border overflow-hidden shadow-sm", c.border)}>
      {/* Header */}
      <div className={cn("px-3.5 py-2.5", c.header)}>
        <div className="flex items-center justify-between mb-0.5">
          <div className="flex items-center gap-1.5 font-bold text-[11px] text-slate-700 uppercase tracking-wider">
            {icon} {label}
            <span className="font-mono font-bold text-slate-500 normal-case">({targets.length})</span>
          </div>
          {targets.length > 0 && (
            <button onClick={toggleAll} className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-800 font-semibold transition-colors">
              {allSelected ? <CheckSquare className="w-3.5 h-3.5 text-violet-600" /> : <Square className="w-3.5 h-3.5" />}
              {allSelected ? "Deselect all" : "Select all"}
            </button>
          )}
        </div>
        <p className="text-[10px] text-slate-400 leading-tight">{subtitle}</p>
      </div>

      {/* Rows */}
      {targets.length > 0 ? (
        <div className="bg-white divide-y divide-slate-50">
          {targets.map((t, idx) => {
            const key = `${userAsin}|${t.asin}|${t.category}`;
            const isSelected = selectedTargets.has(key);
            const copyId = `target-${bucketKey}-${itemIndex}-${idx}`;
            return (
              <div
                key={`${t.asin}-${t.category}`}
                className={cn("flex items-center gap-2.5 px-3.5 py-2.5 group transition-colors", isSelected ? "bg-white" : "bg-slate-50/60")}
              >
                {/* Checkbox */}
                <button onClick={() => onToggleTarget(key)} className="shrink-0 text-slate-300 hover:text-violet-500 transition-colors">
                  {isSelected ? <CheckSquare className="w-4 h-4 text-violet-600" /> : <Square className="w-4 h-4" />}
                </button>
                {/* Image */}
                <div className="shrink-0 w-10 h-10 rounded-lg bg-slate-50 border border-slate-100 overflow-hidden flex items-center justify-center">
                  {t.image
                    ? <img src={t.image} alt={t.title} className="w-full h-full object-contain" onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                    : <Package className="w-4 h-4 text-slate-300" />
                  }
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="font-mono text-[11px] font-bold text-slate-800">{t.asin}</span>
                    {t.price != null && (
                      <span className={cn("text-[10px] font-bold px-1.5 py-0 rounded-full", c.badge)}>
                        ${t.price.toFixed(2)}
                      </span>
                    )}
                    {t.rating != null && (
                      <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 rounded-full flex items-center gap-0.5">
                        <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
                        {t.rating.toFixed(1)}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 line-clamp-1 leading-snug">{t.title}</p>
                </div>
                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => onCopy(t.asin, copyId)} className="w-6 h-6 flex items-center justify-center rounded hover:bg-violet-50 text-slate-400 hover:text-violet-600 transition-colors">
                    {copiedId === copyId ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <a href={`https://www.amazon.com/dp/${t.asin}`} target="_blank" rel="noopener noreferrer" className="w-6 h-6 flex items-center justify-center rounded hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white p-5 text-center">
          <p className="text-[11px] text-slate-300 italic">No targets found — results depend on Amazon live data.</p>
        </div>
      )}
    </div>
  );
}
