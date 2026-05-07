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
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
  "Selecting brand-diverse competitors…",
];

export default function Home() {
  const { toast } = useToast();
  const mutation = useGenerateKeywords();
  const [loadingPhraseIndex, setLoadingPhraseIndex] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showTitleInput, setShowTitleInput] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  // selectedTargets: Set of "userAsin|competitorAsin" keys. Default = all selected.
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      asinsRaw: "",
      title: "",
    },
  });

  const asinsRaw = useWatch({ control: form.control, name: "asinsRaw" });
  
  const asinStats = useMemo(() => {
    if (!asinsRaw) return { valid: 0, invalid: 0 };
    const tokens = asinsRaw.split(/[\s,]+/).filter(Boolean);
    const matches = asinsRaw.toUpperCase().match(ASIN_REGEX) || [];
    return {
      valid: matches.length,
      invalid: Math.max(0, tokens.length - matches.length)
    };
  }, [asinsRaw]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (mutation.isPending) {
      setLoadingPhraseIndex(0);
      startTimeRef.current = performance.now();
      interval = setInterval(() => {
        setLoadingPhraseIndex((prev) => (prev + 1) % LOADING_PHRASES.length);
      }, 2500);
    } else if (mutation.isSuccess && startTimeRef.current) {
      const endTime = performance.now();
      setDuration((endTime - startTimeRef.current) / 1000);
      startTimeRef.current = null;
    }
    return () => clearInterval(interval);
  }, [mutation.isPending, mutation.isSuccess]);

  const onSubmit = (data: FormValues) => {
    const parsedAsins = data.asinsRaw.toUpperCase().match(ASIN_REGEX);
    mutation.mutate({
      data: {
        asins: parsedAsins,
        title: data.title || undefined,
      },
    });
  };

  const handleReset = () => {
    form.reset();
    mutation.reset();
    setDuration(null);
    setSelectedTargets(new Set());
  };

  // Initialize all targets as selected when results arrive
  useEffect(() => {
    if (!mutation.data?.items) return;
    const allKeys = new Set<string>();
    mutation.data.items.forEach(item => {
      const base = item.asin || "title";
      (item.competitor_targets ?? []).forEach(t => {
        allKeys.add(`${base}|${t.asin}|${t.category}`);
      });
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
      const uniqueMatches = Array.from(new Set(matches));
      form.setValue("asinsRaw", uniqueMatches.join("\n"));
    }
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 700);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Failed to copy",
        description: "Please try again.",
      });
    }
  };

  const exportCSV = () => {
    if (!mutation.data?.items) return;
    
    let csvRows = ["ASIN,Keyword/Target"];
    
    const escape = (val: string) => {
      if (val.includes(",") || val.includes("\"")) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };

    mutation.data.items.forEach(item => {
      const asinVal = item.asin || "(title)";

      // Keywords in order
      const types = ["High Intent", "Core", "Long Tail"] as const;
      types.forEach(type => {
        item.keywords
          .filter(k => k.type === type)
          .forEach(k => {
            csvRows.push(`${asinVal},${escape(k.value)}`);
          });
      });

      // Only selected competitor targets
      (item.competitor_targets ?? []).forEach(target => {
        const key = `${asinVal}|${target.asin}|${target.category}`;
        if (selectedTargets.has(key)) {
          csvRows.push(`${asinVal},${target.asin}`);
        }
      });
    });

    const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16).replace(/-/g, "");
    link.setAttribute("href", url);
    link.setAttribute("download", `amazon-ppc-export-${timestamp}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyAllKeywords = () => {
    if (!mutation.data?.items) return;
    const allKws = mutation.data.items.flatMap(item => item.keywords.map(k => k.value));
    const uniqueKws = Array.from(new Set(allKws)).join("\n");
    copyToClipboard(uniqueKws, "copy-all");
    toast({ title: "Copied all keywords", description: "All keywords across products copied to clipboard." });
  };

  const totalKws = mutation.data?.items.reduce((acc, item) => acc + (item.keywords?.length || 0), 0) || 0;
  const totalTargets = mutation.data?.items.reduce((acc, item) => acc + (item.competitor_targets?.length || 0), 0) || 0;
  const selectedTargetsCount = selectedTargets.size;

  return (
    <TooltipProvider>
      <div className="relative min-h-screen w-full overflow-x-hidden font-sans text-slate-900 selection:bg-violet-300/50 flex flex-col">
        {/* Animated colorful background */}
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-violet-50 via-sky-50 to-rose-50" />
        <div className="absolute -z-10 top-[-200px] left-[-200px] w-[500px] h-[500px] rounded-full bg-violet-300/40 blur-3xl animate-pulse" />
        <div className="absolute -z-10 top-[20%] right-[-150px] w-[400px] h-[400px] rounded-full bg-cyan-300/40 blur-3xl animate-pulse" style={{ animationDuration: "5s" }} />
        <div className="absolute -z-10 bottom-[-150px] left-[30%] w-[450px] h-[450px] rounded-full bg-pink-300/40 blur-3xl animate-pulse" style={{ animationDuration: "7s" }} />

        {/* Top Bar */}
        <header className="sticky top-0 z-50 border-b border-white/40 bg-white/70 backdrop-blur-xl shrink-0 shadow-sm">
          <div className="max-w-screen-2xl mx-auto px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AnimatedLogo />
              <div className="hidden sm:block">
                <h1 className="font-bold text-base tracking-tight leading-none bg-gradient-to-r from-violet-600 via-blue-600 to-cyan-600 bg-clip-text text-transparent">
                  New ASIN AK14 Keyword Research
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r from-emerald-100 to-teal-100 border border-emerald-200 shadow-sm">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Live Amazon search</span>
            </div>
          </div>
        </header>

        <main className="max-w-screen-2xl mx-auto w-full flex-1 grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-0">
          {/* Left Sidebar */}
          <aside className="lg:h-[calc(100vh-4rem)] lg:sticky lg:top-16 border-r border-white/50 bg-white/80 backdrop-blur-xl overflow-y-auto px-5 py-6 shadow-[8px_0_40px_rgba(91,33,182,0.06)]">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-violet-500">Input panel</p>
                  <h2 className="text-lg font-semibold text-slate-900">Enter ASINs</h2>
                  <p className="text-xs text-slate-500">Fixed on the left for fast research.</p>
                </div>
                <FormField
                  control={form.control}
                  name="asinsRaw"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between mb-1.5">
                        <FormLabel className="text-xs font-bold text-slate-700 uppercase tracking-wider">Amazon ASINs</FormLabel>
                        <div className="text-[10px] font-medium flex items-center gap-1.5">
                          <span className={cn(asinStats.valid > 0 ? "text-emerald-600 font-bold" : "text-slate-400")}>{asinStats.valid} valid</span>
                          <span className="text-slate-300">|</span>
                          <span className={cn(asinStats.invalid > 0 ? "text-rose-600 font-bold" : "text-slate-400")}>{asinStats.invalid} invalid</span>
                        </div>
                      </div>
                      <FormControl>
                        <Textarea
                          placeholder="B07FZ8S74R, B0BDHWDR12..."
                          className="bg-white border-slate-200 focus-visible:ring-violet-500 focus-visible:border-violet-300 min-h-[140px] font-mono text-xs resize-none shadow-sm text-slate-900 placeholder:text-slate-400"
                          onPaste={handlePaste}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription className="text-[10px] text-slate-500 mt-1.5">Paste up to 15 ASINs (auto-formatted)</FormDescription>
                      <FormMessage className="text-rose-600 text-[11px]" />
                    </FormItem>
                  )}
                />

                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => setShowTitleInput(!showTitleInput)}
                    className="text-[11px] text-violet-600 hover:text-violet-700 font-semibold flex items-center gap-1 transition-colors"
                  >
                    {showTitleInput ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    Use a product title instead
                  </button>
                  
                  {showTitleInput && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      className="overflow-hidden"
                    >
                      <FormField
                        control={form.control}
                        name="title"
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Textarea
                                placeholder="Enter full product title..."
                                className="bg-white border-slate-200 focus-visible:ring-violet-500 focus-visible:border-violet-300 min-h-[96px] text-xs shadow-sm text-slate-900 placeholder:text-slate-400"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage className="text-rose-600 text-[11px]" />
                          </FormItem>
                        )}
                      />
                    </motion.div>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={mutation.isPending}
                  className="w-full h-auto py-3 whitespace-normal bg-gradient-to-r from-violet-600 via-blue-600 to-cyan-600 hover:from-violet-700 hover:via-blue-700 hover:to-cyan-700 text-white font-bold transition-all shadow-lg shadow-violet-500/30 hover:shadow-xl hover:shadow-violet-500/40 hover:-translate-y-0.5 border-0 rounded-xl"
                  data-testid="btn-generate"
                >
                  {mutation.isPending ? (
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span className="text-xs">{LOADING_PHRASES[loadingPhraseIndex]}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 fill-current" />
                      Generate Keywords
                    </div>
                  )}
                </Button>
              </form>
            </Form>
          </aside>

          {/* Right Content Area */}
          <section className="min-w-0 bg-gradient-to-br from-white/30 via-white/10 to-transparent">
            <AnimatePresence mode="wait">
              {!mutation.data && !mutation.isPending && (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="h-full flex flex-col items-center justify-center p-12 text-center"
                >
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", duration: 0.6 }}
                    className="relative w-20 h-20 mb-6"
                  >
                    <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-violet-400 via-blue-400 to-cyan-400 blur-xl opacity-40 animate-pulse" />
                    <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-white to-violet-50 border border-violet-200 flex items-center justify-center shadow-xl">
                      <Search className="w-9 h-9 text-violet-500" />
                    </div>
                  </motion.div>
                  <h2 className="text-2xl font-bold text-slate-900 mb-1">Ready to Analyze</h2>
                  <p className="text-sm text-slate-500 mb-6">Enter ASINs to start generating</p>
                  <div className="space-y-3 max-w-md text-left">
                    {[
                      { color: "from-violet-500 to-fuchsia-500", text: <><span className="text-slate-900 font-semibold">Distills</span> long Amazon titles into the real product type.</> },
                      { color: "from-blue-500 to-cyan-500", text: <><span className="text-slate-900 font-semibold">30 conversion-grade</span> keywords per ASIN.</> },
                      { color: "from-amber-500 to-orange-500", text: <><span className="text-slate-900 font-semibold">5 Higher Price</span> competitor targets per ASIN.</> },
                      { color: "from-emerald-500 to-teal-500", text: <><span className="text-slate-900 font-semibold">5 Lower Rating</span> competitor targets per ASIN.</> },
                    ].map((row, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.1 + i * 0.08 }}
                        className="flex items-start gap-3"
                      >
                        <div className={cn("w-6 h-6 rounded-full bg-gradient-to-br shadow-sm flex items-center justify-center shrink-0 mt-0.5", row.color)}>
                          <Check className="w-3 h-3 text-white" strokeWidth={3} />
                        </div>
                        <p className="text-sm text-slate-600">{row.text}</p>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}

              {mutation.isPending && (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="p-8 space-y-6"
                >
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-10 w-64 bg-white/60" />
                    <Skeleton className="h-8 w-48 bg-white/60" />
                  </div>
                  <div className="space-y-4">
                    {[1, 2].map(i => (
                      <div key={i} className="p-4 bg-white/60 rounded-xl border border-white/80 space-y-6 shadow-sm">
                        <div className="flex justify-between">
                          <div className="space-y-2">
                            <Skeleton className="h-4 w-24 bg-slate-200" />
                            <Skeleton className="h-6 w-96 bg-slate-200" />
                          </div>
                          <Skeleton className="h-4 w-32 bg-slate-200" />
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                          <Skeleton className="h-40 bg-slate-100" />
                          <Skeleton className="h-40 bg-slate-100" />
                          <Skeleton className="h-40 bg-slate-100" />
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {mutation.data && (
                <motion.div
                  key="results"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col h-full"
                >
                  {/* Sticky Results Toolbar */}
                  <div className="sticky top-16 z-40 bg-white/80 backdrop-blur-xl border-b border-white/60 px-6 py-3 flex items-center justify-between shadow-sm">
                    <div className="flex items-center gap-4 text-xs">
                      <div className="flex flex-col">
                        <span className="text-slate-500 uppercase tracking-tighter text-[9px] font-bold">Products</span>
                        <span className="font-mono tabular-nums text-slate-900 font-semibold">{mutation.data.items.length}</span>
                      </div>
                      <div className="w-px h-6 bg-slate-200" />
                      <div className="flex flex-col">
                        <span className="text-slate-500 uppercase tracking-tighter text-[9px] font-bold">Keywords</span>
                        <span className="font-mono tabular-nums text-violet-600 font-semibold">{totalKws}</span>
                      </div>
                      <div className="w-px h-6 bg-slate-200" />
                      <div className="flex flex-col">
                        <span className="text-slate-500 uppercase tracking-tighter text-[9px] font-bold">Targets</span>
                        <span className="font-mono tabular-nums text-rose-600 font-semibold">{totalTargets}</span>
                      </div>
                      {totalTargets > 0 && (
                        <>
                          <div className="w-px h-6 bg-slate-200" />
                          <div className="flex flex-col">
                            <span className="text-slate-500 uppercase tracking-tighter text-[9px] font-bold">Selected</span>
                            <span className="font-mono tabular-nums text-violet-600 font-semibold">{selectedTargetsCount}</span>
                          </div>
                        </>
                      )}
                      {duration !== null && (
                        <>
                          <div className="w-px h-6 bg-slate-200" />
                          <div className="flex flex-col">
                            <span className="text-slate-500 uppercase tracking-tighter text-[9px] font-bold">Search Time</span>
                            <span className="text-slate-700 font-mono tabular-nums">{duration.toFixed(1)}s</span>
                          </div>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" className="h-8 text-xs border-slate-200 bg-white hover:bg-violet-50 hover:border-violet-300 hover:text-violet-700 text-slate-700 px-2.5 shadow-sm" onClick={copyAllKeywords} data-testid="btn-copy-all">
                        {copiedId === "copy-all" ? <Check className="w-3 h-3 mr-1.5 text-emerald-600" /> : <Copy className="w-3 h-3 mr-1.5" />}
                        Copy all
                      </Button>
                      <Button variant="outline" size="sm" className="h-8 text-xs border-slate-200 bg-white hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 text-slate-700 px-2.5 shadow-sm" onClick={exportCSV} data-testid="btn-export-csv">
                        <Download className="w-3 h-3 mr-1.5" />
                        Export
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 text-xs text-slate-500 hover:text-rose-600 hover:bg-rose-50 px-2.5" onClick={handleReset} data-testid="btn-reset">
                        <RotateCcw className="w-3 h-3 mr-1.5" />
                        Reset
                      </Button>
                    </div>
                  </div>

                  <div className="p-6 space-y-3">
                    {mutation.data.items.length === 1 ? (
                      <ResultCard item={mutation.data.items[0]} index={0} selectedTargets={selectedTargets} onToggleTarget={toggleTarget} />
                    ) : (
                      <Accordion type="single" collapsible defaultValue="item-0" className="space-y-3">
                        {mutation.data.items.map((item, idx) => (
                          <AccordionItem key={idx} value={`item-${idx}`} className="border-none">
                            <AccordionTrigger className="flex p-3 bg-white/70 hover:bg-white rounded-lg border border-white shadow-sm transition-all [&[data-state=open]]:rounded-b-none [&[data-state=open]]:border-b-0 hover:no-underline group">
                              <div className="flex items-center gap-3 text-left min-w-0 pr-4">
                                <span className="font-mono text-[13px] text-white font-bold tracking-widest bg-gradient-to-r from-violet-600 to-blue-600 px-2.5 py-0.5 rounded shadow-sm">
                                  {item.asin || "TITLE"}
                                </span>
                              </div>
                            </AccordionTrigger>
                            <AccordionContent className="bg-white/70 border border-white border-t-0 rounded-b-lg p-0 shadow-sm">
                              <ResultCard item={item} index={idx} noBorder selectedTargets={selectedTargets} onToggleTarget={toggleTarget} />
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        </main>
      </div>
    </TooltipProvider>
  );
}

function AnimatedLogo() {
  return (
    <div className="relative w-10 h-10 shrink-0">
      {/* Outer glow */}
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-500 via-blue-500 to-cyan-500 blur-md opacity-60 animate-pulse" />
      {/* Rotating gradient ring */}
      <motion.div
        className="absolute inset-0 rounded-2xl"
        style={{
          background: "conic-gradient(from 0deg, #8b5cf6, #3b82f6, #06b6d4, #ec4899, #8b5cf6)",
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
      />
      {/* Inner core */}
      <div className="absolute inset-[3px] rounded-[14px] bg-gradient-to-br from-white via-violet-50 to-white flex items-center justify-center overflow-hidden">
        {/* Subtle inner shine */}
        <div className="absolute inset-0 bg-gradient-to-tr from-violet-100/0 via-blue-100/40 to-transparent" />
        <motion.div
          animate={{ scale: [1, 1.15, 1], rotate: [0, -8, 8, 0] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        >
          <Sparkles className="relative w-5 h-5 text-violet-600 fill-violet-500/30" strokeWidth={2.2} />
        </motion.div>
      </div>
      {/* Orbiting accent dot */}
      <motion.div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 pointer-events-none"
        animate={{ rotate: 360 }}
        transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
      >
        <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.8)]" />
      </motion.div>
    </div>
  );
}

function ResultCard({ item, index, noBorder, selectedTargets, onToggleTarget }: {
  item: any;
  index: number;
  noBorder?: boolean;
  selectedTargets: Set<string>;
  onToggleTarget: (key: string) => void;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copy = (val: string, id: string) => {
    navigator.clipboard.writeText(val);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 700);
  };

  if (item.error) {
    return (
      <Card className={cn("bg-rose-50 border-rose-200 shadow-sm", noBorder && "border-none shadow-none bg-transparent")}>
        <CardContent className="p-4">
          <div className="flex gap-3">
            <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
            <div className="space-y-1">
              <h4 className="text-sm font-bold text-rose-700">Failed to process {item.asin || "product"}</h4>
              <p className="text-xs text-rose-600">{item.error}</p>
              <Badge variant="outline" className="mt-2 border-rose-300 text-rose-700 bg-rose-100 text-[10px]">SKIPPED</Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const targets: CompetitorTarget[] = item.competitor_targets ?? [];
  const higherPrice = targets.filter((t: CompetitorTarget) => t.category === "higher_price");
  const lowerRating = targets.filter((t: CompetitorTarget) => t.category === "lower_rating");
  const userAsin = item.asin || "title";

  return (
    <Card className={cn("bg-white border-white shadow-md shadow-violet-100/40 overflow-hidden", noBorder && "border-none shadow-none bg-transparent")}>
      {/* Header Block */}
      <div className="flex items-stretch border-b border-slate-100 gap-3 p-3 bg-gradient-to-r from-violet-50/60 via-blue-50/40 to-cyan-50/60">
        <div className="shrink-0 w-20 h-20 sm:w-24 sm:h-24 rounded-lg bg-white border border-slate-200 overflow-hidden flex items-center justify-center shadow-sm">
          {item.image ? (
            <img src={item.image} alt={item.title} className="w-full h-full object-contain" loading="lazy"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <Search className="w-6 h-6 text-slate-300" />
          )}
        </div>
        <div className="flex-1 min-w-0 flex flex-col justify-center gap-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[13px] text-white font-bold tracking-widest bg-gradient-to-r from-violet-600 to-blue-600 px-2.5 py-0.5 rounded shadow-sm">
              {item.asin || "N/A"}
            </span>
            {item.detectedBrand && (
              <Badge className="bg-white text-slate-700 border-slate-200 text-[10px] py-0 h-5 font-medium shadow-sm">
                {item.detectedBrand}
              </Badge>
            )}
            {item.price != null && (
              <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] py-0 h-5 font-semibold shadow-sm">
                ${item.price.toFixed(2)}
              </Badge>
            )}
            {item.rating != null && (
              <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] py-0 h-5 font-semibold shadow-sm flex items-center gap-0.5">
                <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />{item.rating.toFixed(1)}
              </Badge>
            )}
            {item.asin && (
              <a href={`https://www.amazon.com/dp/${item.asin}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-violet-600 transition-colors whitespace-nowrap ml-auto">
                View on Amazon <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          <h3 className="text-sm font-semibold text-slate-900 leading-snug break-words">{item.title}</h3>
        </div>
      </div>

      <CardContent className="p-4 space-y-4">
        {/* Keywords Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <KeywordSection label="High Intent" icon={<Zap className="w-3 h-3 text-amber-600 fill-amber-400" />}
            accentColor="amber" keywords={item.keywords.filter((k: any) => k.type === "High Intent")}
            itemIndex={index} sectionIdx={0} onCopy={copy} copiedId={copiedId} />
          <KeywordSection label="Core Keywords" icon={<Layers className="w-3 h-3 text-blue-600" />}
            accentColor="blue" keywords={item.keywords.filter((k: any) => k.type === "Core")}
            itemIndex={index} sectionIdx={1} onCopy={copy} copiedId={copiedId} />
          <KeywordSection label="Long-Tail" icon={<BarChart3 className="w-3 h-3 text-emerald-600" />}
            accentColor="emerald" keywords={item.keywords.filter((k: any) => k.type === "Long Tail")}
            itemIndex={index} sectionIdx={2} onCopy={copy} copiedId={copiedId} />
        </div>

        {/* Competitor Targets — Two Buckets */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Target className="w-3.5 h-3.5 text-rose-600" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-800">Competitor Targets</span>
            <span className="text-[10px] text-slate-400 font-medium">(check to include in CSV export)</span>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {/* Higher Price */}
            <TargetBucket
              label="Higher Price"
              icon={<TrendingUp className="w-3.5 h-3.5 text-orange-600" />}
              headerClass="bg-gradient-to-r from-orange-50 to-amber-50 border-orange-100"
              cardClass="border-orange-100 hover:border-orange-300"
              badgeClass="bg-orange-100 text-orange-700"
              targets={higherPrice}
              userAsin={userAsin}
              selectedTargets={selectedTargets}
              onToggleTarget={onToggleTarget}
              onCopy={copy}
              copiedId={copiedId}
              itemIndex={index}
              bucketKey="hp"
            />
            {/* Lower Rating */}
            <TargetBucket
              label="Lower Rating"
              icon={<Star className="w-3.5 h-3.5 text-blue-600" />}
              headerClass="bg-gradient-to-r from-blue-50 to-sky-50 border-blue-100"
              cardClass="border-blue-100 hover:border-blue-300"
              badgeClass="bg-blue-100 text-blue-700"
              targets={lowerRating}
              userAsin={userAsin}
              selectedTargets={selectedTargets}
              onToggleTarget={onToggleTarget}
              onCopy={copy}
              copiedId={copiedId}
              itemIndex={index}
              bucketKey="lr"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TargetBucket({ label, icon, headerClass, cardClass, badgeClass, targets, userAsin, selectedTargets, onToggleTarget, onCopy, copiedId, itemIndex, bucketKey }: {
  label: string;
  icon: React.ReactNode;
  headerClass: string;
  cardClass: string;
  badgeClass: string;
  targets: CompetitorTarget[];
  userAsin: string;
  selectedTargets: Set<string>;
  onToggleTarget: (key: string) => void;
  onCopy: (val: string, id: string) => void;
  copiedId: string | null;
  itemIndex: number;
  bucketKey: string;
}) {
  const allSelected = targets.length > 0 && targets.every(t => selectedTargets.has(`${userAsin}|${t.asin}|${t.category}`));

  const toggleAll = () => {
    targets.forEach(t => {
      const key = `${userAsin}|${t.asin}|${t.category}`;
      if (allSelected) {
        if (selectedTargets.has(key)) onToggleTarget(key);
      } else {
        if (!selectedTargets.has(key)) onToggleTarget(key);
      }
    });
  };

  return (
    <div className={cn("border rounded-xl overflow-hidden shadow-sm", headerClass.includes("orange") ? "border-orange-100" : headerClass.includes("blue") ? "border-blue-100" : "border-rose-100")}>
      <div className={cn("flex items-center justify-between px-3 py-2 border-b", headerClass)}>
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-800">{label}</span>
          <span className="text-[10px] font-mono tabular-nums font-bold text-slate-500">({targets.length})</span>
        </div>
        {targets.length > 0 && (
          <button onClick={toggleAll} className="text-[10px] text-slate-500 hover:text-slate-800 font-semibold flex items-center gap-1 transition-colors">
            {allSelected ? <CheckSquare className="w-3.5 h-3.5 text-violet-600" /> : <Square className="w-3.5 h-3.5" />}
            {allSelected ? "Deselect all" : "Select all"}
          </button>
        )}
      </div>

      {targets.length > 0 ? (
        <div className="divide-y divide-slate-100 bg-white">
          {targets.map((t, idx) => {
            const key = `${userAsin}|${t.asin}|${t.category}`;
            const isSelected = selectedTargets.has(key);
            const copyId = `target-${bucketKey}-${itemIndex}-${idx}`;
            return (
              <div key={`${t.asin}-${t.category}`}
                className={cn("flex items-center gap-2.5 px-3 py-2 group transition-colors",
                  isSelected ? "bg-white" : "bg-slate-50/50"
                )}>
                {/* Checkbox */}
                <button onClick={() => onToggleTarget(key)} className="shrink-0 text-slate-400 hover:text-violet-600 transition-colors">
                  {isSelected
                    ? <CheckSquare className="w-4 h-4 text-violet-600" />
                    : <Square className="w-4 h-4" />}
                </button>
                {/* Product image */}
                <div className="shrink-0 w-9 h-9 rounded-md bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center">
                  {t.image ? (
                    <img src={t.image} alt={t.title} className="w-full h-full object-contain"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                  ) : (
                    <Search className="w-4 h-4 text-slate-300" />
                  )}
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono text-[11px] font-bold text-slate-800 tracking-wider">{t.asin}</span>
                    {t.price != null && (
                      <span className={cn("text-[10px] font-bold px-1.5 py-0 rounded-full", badgeClass)}>
                        ${t.price.toFixed(2)}
                      </span>
                    )}
                    {t.rating != null && (
                      <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0 rounded-full flex items-center gap-0.5">
                        <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />{t.rating.toFixed(1)}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-600 line-clamp-2 leading-tight">{t.title}</p>
                </div>
                {/* Action buttons — slightly bigger */}
                <div className="flex items-center gap-1.5 shrink-0 opacity-50 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => onCopy(t.asin, copyId)}
                    className="w-6 h-6 flex items-center justify-center rounded hover:bg-violet-50 text-slate-400 hover:text-violet-600 transition-colors">
                    {copiedId === copyId ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <a href={`https://www.amazon.com/dp/${t.asin}`} target="_blank" rel="noopener noreferrer"
                    className="w-6 h-6 flex items-center justify-center rounded hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="p-4 bg-white">
          <p className="text-[11px] text-slate-400 italic text-center">No targets found for this category.</p>
        </div>
      )}
    </div>
  );
}

function KeywordSection({ label, icon, accentColor, keywords, itemIndex, sectionIdx, onCopy, copiedId }: any) {
  const accentMap: Record<string, { header: string; border: string; numColor: string; copyHover: string }> = {
    amber:   { header: "bg-gradient-to-r from-amber-50 to-orange-50 border-amber-100",     border: "border-amber-100",   numColor: "text-amber-600",   copyHover: "hover:text-amber-600" },
    blue:    { header: "bg-gradient-to-r from-blue-50 to-sky-50 border-blue-100",          border: "border-blue-100",    numColor: "text-blue-600",    copyHover: "hover:text-blue-600" },
    emerald: { header: "bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-100",   border: "border-emerald-100", numColor: "text-emerald-600", copyHover: "hover:text-emerald-600" },
  };
  const c = accentMap[accentColor] ?? accentMap.blue;

  return (
    <div className={cn("bg-white border rounded-lg overflow-hidden shadow-sm", c.border)}>
      <div className={cn("flex items-center justify-between px-3 py-2 border-b", c.header)}>
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-800">{label}</span>
          <span className={cn("text-[10px] font-mono tabular-nums font-bold", c.numColor)}>{keywords.length}</span>
        </div>
        <button
          onClick={() => onCopy(keywords.map((k: any) => k.value).join("\n"), `sec-${itemIndex}-${sectionIdx}`)}
          className={cn("text-slate-400 transition-colors", c.copyHover)}
          aria-label="Copy all"
        >
          {copiedId === `sec-${itemIndex}-${sectionIdx}` ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
      <ul className="divide-y divide-slate-100">
        {keywords.map((kw: any, idx: number) => {
          const id = `kw-${itemIndex}-${sectionIdx}-${idx}`;
          const isCopied = copiedId === id;
          return (
            <li key={idx}>
              <button
                onClick={() => onCopy(kw.value, id)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors group",
                  "hover:bg-slate-50",
                )}
                data-testid={`row-kw-${itemIndex}-${idx}`}
              >
                <span className={cn("text-[10px] font-mono tabular-nums w-4 shrink-0 font-bold", c.numColor)}>
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <span className="text-xs text-slate-700 flex-1 break-words">{kw.value}</span>
                {isCopied ? (
                  <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                ) : (
                  <Copy className="w-3 h-3 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

