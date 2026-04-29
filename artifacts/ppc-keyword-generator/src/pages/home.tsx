import { useState, useEffect, useMemo, useRef } from "react";
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
  BarChart3
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useGenerateKeywords } from "@workspace/api-client-react";
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
  };

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
    
    mutation.data.items.forEach(item => {
      const asinVal = item.asin || "(title)";
      const escape = (val: string) => {
        if (val.includes(",") || val.includes("\"")) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      };

      // Keywords in order
      const types = ["High Intent", "Core", "Long Tail"] as const;
      types.forEach(type => {
        item.keywords
          .filter(k => k.type === type)
          .forEach(k => {
            csvRows.push(`${asinVal},${escape(k.value)}`);
          });
      });

      // Targets
      item.competitor_asins.forEach(target => {
        csvRows.push(`${asinVal},${target}`);
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
  const totalTargets = mutation.data?.items.reduce((acc, item) => acc + (item.competitor_asins?.length || 0), 0) || 0;

  return (
    <TooltipProvider>
      <div className="min-h-screen w-full overflow-x-hidden bg-[#020617] text-slate-50 font-sans selection:bg-blue-500/30 flex flex-col">
        {/* Top Bar */}
        <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md shrink-0">
          <div className="max-w-screen-2xl mx-auto px-6 h-14 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center shadow-lg">
                <Zap className="w-5 h-5 text-white fill-current" />
              </div>
              <div className="hidden sm:block">
                <h1 className="font-bold text-sm tracking-tight leading-none">New ASIN AK14 Keyword Research</h1>
                <p className="text-[10px] text-slate-500 mt-0.5 uppercase tracking-wider">Professional Targeting Suite</p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Live Amazon search</span>
            </div>
          </div>
        </header>

        <main className="max-w-screen-2xl mx-auto w-full flex-1 grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-0">
          {/* Left Sidebar */}
          <aside className="lg:h-[calc(100vh-3.5rem)] lg:sticky lg:top-14 border-r border-slate-800 bg-slate-950/40 overflow-y-auto px-5 py-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="asinsRaw"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between mb-1">
                        <FormLabel className="text-xs font-semibold text-slate-300">Amazon ASINs</FormLabel>
                        <div className="text-[10px] font-medium flex items-center gap-1.5">
                          <span className={cn(asinStats.valid > 0 ? "text-emerald-400" : "text-slate-500")}>{asinStats.valid} valid</span>
                          <span className="text-slate-700">|</span>
                          <span className={cn(asinStats.invalid > 0 ? "text-rose-400" : "text-slate-500")}>{asinStats.invalid} invalid</span>
                        </div>
                      </div>
                      <FormControl>
                        <Textarea
                          placeholder="B07FZ8S74R, B0BDHWDR12..."
                          className="bg-slate-950 border-slate-800 focus:ring-blue-500 min-h-[120px] font-mono text-xs resize-none"
                          onPaste={handlePaste}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription className="text-[10px] text-slate-600 mt-1">Paste up to 15 ASINs (auto-formatted)</FormDescription>
                      <FormMessage className="text-rose-400 text-[11px]" />
                    </FormItem>
                  )}
                />

                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => setShowTitleInput(!showTitleInput)}
                    className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
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
                                className="bg-slate-950 border-slate-800 focus:ring-blue-500 min-h-[80px] text-xs"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage className="text-rose-400 text-[11px]" />
                          </FormItem>
                        )}
                      />
                    </motion.div>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={mutation.isPending}
                  className="w-full h-10 bg-blue-600 hover:bg-blue-500 text-white font-bold transition-all shadow-lg"
                  data-testid="btn-generate"
                >
                  {mutation.isPending ? (
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                      <span className="text-xs">{LOADING_PHRASES[loadingPhraseIndex]}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Zap className="w-3.5 h-3.5 fill-current" />
                      Generate Keywords
                    </div>
                  )}
                </Button>
              </form>
            </Form>
          </aside>

          {/* Right Content Area */}
          <section className="min-w-0 bg-slate-950/20">
            <AnimatePresence mode="wait">
              {!mutation.data && !mutation.isPending && (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="h-full flex flex-col items-center justify-center p-12 text-center"
                >
                  <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mb-6">
                    <Search className="w-8 h-8 text-slate-600" />
                  </div>
                  <h2 className="text-xl font-bold text-slate-200 mb-4">Ready to Analyze</h2>
                  <div className="space-y-3 max-w-sm text-left">
                    <div className="flex items-start gap-3">
                      <div className="w-5 h-5 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0 mt-0.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                      </div>
                      <p className="text-sm text-slate-400"><span className="text-slate-200 font-medium">Distills</span> long Amazon titles into the real product type.</p>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-5 h-5 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0 mt-0.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                      </div>
                      <p className="text-sm text-slate-400"><span className="text-slate-200 font-medium">30 conversion-grade</span> keywords per ASIN.</p>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-5 h-5 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0 mt-0.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                      </div>
                      <p className="text-sm text-slate-400"><span className="text-slate-200 font-medium">5 competitor ASINs</span> from different brands.</p>
                    </div>
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
                    <Skeleton className="h-10 w-64 bg-slate-900" />
                    <Skeleton className="h-8 w-48 bg-slate-900" />
                  </div>
                  <div className="space-y-4">
                    {[1, 2].map(i => (
                      <div key={i} className="p-4 bg-slate-900/40 rounded-xl border border-slate-800 space-y-6">
                        <div className="flex justify-between">
                          <div className="space-y-2">
                            <Skeleton className="h-4 w-24 bg-slate-800" />
                            <Skeleton className="h-6 w-96 bg-slate-800" />
                          </div>
                          <Skeleton className="h-4 w-32 bg-slate-800" />
                        </div>
                        <Skeleton className="h-24 w-full bg-slate-800/50" />
                        <div className="grid grid-cols-3 gap-4">
                          <Skeleton className="h-40 bg-slate-800/30" />
                          <Skeleton className="h-40 bg-slate-800/30" />
                          <Skeleton className="h-40 bg-slate-800/30" />
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
                  <div className="sticky top-14 z-40 bg-slate-950/60 backdrop-blur-md border-b border-slate-800 px-6 py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-4 text-xs">
                      <div className="flex flex-col">
                        <span className="text-slate-500 uppercase tracking-tighter text-[9px] font-bold">Products</span>
                        <span className="font-mono tabular-nums">{mutation.data.items.length}</span>
                      </div>
                      <div className="w-px h-6 bg-slate-800" />
                      <div className="flex flex-col">
                        <span className="text-slate-500 uppercase tracking-tighter text-[9px] font-bold">Keywords</span>
                        <span className="font-mono tabular-nums">{totalKws}</span>
                      </div>
                      <div className="w-px h-6 bg-slate-800" />
                      <div className="flex flex-col">
                        <span className="text-slate-500 uppercase tracking-tighter text-[9px] font-bold">Targets</span>
                        <span className="font-mono tabular-nums">{totalTargets}</span>
                      </div>
                      {duration !== null && (
                        <>
                          <div className="w-px h-6 bg-slate-800" />
                          <div className="flex flex-col">
                            <span className="text-slate-500 uppercase tracking-tighter text-[9px] font-bold">Search Time</span>
                            <span className="text-slate-400 font-mono tabular-nums">{duration.toFixed(1)}s</span>
                          </div>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" className="h-7 text-xs border-slate-800 bg-slate-900 hover:bg-slate-800 px-2" onClick={copyAllKeywords} data-testid="btn-copy-all">
                        {copiedId === "copy-all" ? <Check className="w-3 h-3 mr-1.5" /> : <Copy className="w-3 h-3 mr-1.5" />}
                        Copy all
                      </Button>
                      <Button variant="outline" size="sm" className="h-7 text-xs border-slate-800 bg-slate-900 hover:bg-slate-800 px-2" onClick={exportCSV} data-testid="btn-export-csv">
                        <Download className="w-3 h-3 mr-1.5" />
                        Export
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-slate-500 hover:text-white px-2" onClick={handleReset} data-testid="btn-reset">
                        <RotateCcw className="w-3 h-3 mr-1.5" />
                        Reset
                      </Button>
                    </div>
                  </div>

                  <div className="p-6 space-y-3">
                    {mutation.data.items.length === 1 ? (
                      <ResultCard item={mutation.data.items[0]} index={0} />
                    ) : (
                      <Accordion type="single" collapsible defaultValue="item-0" className="space-y-3">
                        {mutation.data.items.map((item, idx) => (
                          <AccordionItem key={idx} value={`item-${idx}`} className="border-none">
                            <AccordionTrigger className="flex p-3 bg-slate-900/40 hover:bg-slate-900/60 rounded-lg border border-slate-800 transition-all [&[data-state=open]]:rounded-b-none [&[data-state=open]]:border-b-0 hover:no-underline group">
                              <div className="flex items-center gap-3 text-left min-w-0 pr-4">
                                <Badge variant="outline" className="font-mono text-[10px] shrink-0 bg-slate-950 border-slate-700 text-blue-400">
                                  {item.asin || "TITLE"}
                                </Badge>
                                <span className="text-sm font-medium truncate text-slate-300 group-hover:text-white transition-colors">
                                  {item.title}
                                </span>
                              </div>
                            </AccordionTrigger>
                            <AccordionContent className="bg-slate-900/20 border border-slate-800 border-t-0 rounded-b-lg p-0">
                              <ResultCard item={item} index={idx} noBorder />
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

function ResultCard({ item, index, noBorder }: { item: any, index: number, noBorder?: boolean }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copy = (val: string, id: string) => {
    navigator.clipboard.writeText(val);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 700);
  };

  if (item.error) {
    return (
      <Card className={cn("bg-rose-500/5 border-rose-500/20", noBorder && "border-none shadow-none bg-transparent")}>
        <CardContent className="p-4">
          <div className="flex gap-3">
            <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
            <div className="space-y-1">
              <h4 className="text-sm font-bold text-rose-400">Failed to process {item.asin || "product"}</h4>
              <p className="text-xs text-rose-300/80">{item.error}</p>
              <Badge variant="outline" className="mt-2 border-rose-500/30 text-rose-400 text-[10px]">SKIPPED</Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("bg-slate-900/30 border-slate-800 overflow-hidden", noBorder && "border-none shadow-none bg-transparent")}>
      {/* Header Block: Image | (ASIN, Brand, View) on top + Title below */}
      <div className="flex items-stretch border-b border-slate-800/80 gap-3 p-3">
        <div className="shrink-0 w-20 h-20 sm:w-24 sm:h-24 rounded-md bg-slate-950 border border-slate-800 overflow-hidden flex items-center justify-center">
          {item.image ? (
            <img
              src={item.image}
              alt={item.title}
              className="w-full h-full object-contain"
              loading="lazy"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <Search className="w-6 h-6 text-slate-700" />
          )}
        </div>
        <div className="flex-1 min-w-0 flex flex-col justify-center gap-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[13px] text-blue-300 font-bold tracking-widest bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
              {item.asin || "N/A"}
            </span>
            {item.detectedBrand && (
              <Badge className="bg-slate-800 text-slate-300 border-slate-700 text-[10px] py-0 h-5 font-normal">
                {item.detectedBrand}
              </Badge>
            )}
            {item.asin && (
              <a
                href={`https://www.amazon.com/dp/${item.asin}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[10px] font-medium text-slate-500 hover:text-blue-400 transition-colors whitespace-nowrap ml-auto"
              >
                View on Amazon <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          <h3 className="text-sm font-semibold text-slate-100 leading-snug break-words">
            {item.title}
          </h3>
        </div>
      </div>

      <CardContent className="p-4 space-y-4">
        {/* Keywords Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <KeywordSection
            label="High Intent"
            icon={<Zap className="w-3 h-3 text-amber-400" />}
            accentColor="amber"
            keywords={item.keywords.filter((k: any) => k.type === "High Intent")}
            itemIndex={index}
            sectionIdx={0}
            onCopy={copy}
            copiedId={copiedId}
          />
          <KeywordSection
            label="Core Keywords"
            icon={<Layers className="w-3 h-3 text-blue-400" />}
            accentColor="blue"
            keywords={item.keywords.filter((k: any) => k.type === "Core")}
            itemIndex={index}
            sectionIdx={1}
            onCopy={copy}
            copiedId={copiedId}
          />
          <KeywordSection
            label="Long-Tail"
            icon={<BarChart3 className="w-3 h-3 text-emerald-400" />}
            accentColor="emerald"
            keywords={item.keywords.filter((k: any) => k.type === "Long Tail")}
            itemIndex={index}
            sectionIdx={2}
            onCopy={copy}
            copiedId={copiedId}
          />
        </div>

        {/* Competitor Targets */}
        <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target className="w-3.5 h-3.5 text-rose-400" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-200">
                Competitor Targets
              </span>
              {item.competitor_asins.length > 0 && (
                <span className="text-[10px] font-mono tabular-nums text-slate-500">
                  ({item.competitor_asins.length})
                </span>
              )}
            </div>
            {item.competitor_asins.length > 0 && (
              <button
                onClick={() => copy(item.competitor_asins.join("\n"), `targets-${index}`)}
                className="text-[10px] text-slate-500 hover:text-white flex items-center gap-1 transition-colors"
              >
                {copiedId === `targets-${index}` ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
                Copy all
              </button>
            )}
          </div>

          {item.competitor_asins.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {item.competitor_asins.map((asin: string, idx: number) => (
                <div key={asin} className="group flex items-center justify-between gap-2 bg-slate-900/60 border border-slate-800 rounded-md px-2.5 py-1.5 hover:border-rose-500/40 hover:bg-slate-900 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[9px] font-bold text-slate-600 tabular-nums">{idx + 1}</span>
                    <span className="font-mono text-[11px] text-slate-200 tracking-wider truncate">{asin}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => copy(asin, `asin-${index}-${idx}`)}
                      className="text-slate-500 hover:text-blue-400"
                      data-testid={`btn-asin-${index}-${idx}`}
                    >
                      {copiedId === `asin-${index}-${idx}` ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
                    </button>
                    <a href={`https://www.amazon.com/dp/${asin}`} target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-blue-400">
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-slate-600 italic">No competitor ASINs found.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function KeywordSection({ label, icon, accentColor, keywords, itemIndex, sectionIdx, onCopy, copiedId }: any) {
  const accentMap: Record<string, { header: string; border: string; rowHover: string; numColor: string }> = {
    amber:   { header: "bg-amber-500/5 border-amber-500/20",   border: "border-amber-500/30",   rowHover: "hover:border-amber-500/40",   numColor: "text-amber-400/70" },
    blue:    { header: "bg-blue-500/5 border-blue-500/20",     border: "border-blue-500/30",    rowHover: "hover:border-blue-500/40",    numColor: "text-blue-400/70" },
    emerald: { header: "bg-emerald-500/5 border-emerald-500/20", border: "border-emerald-500/30", rowHover: "hover:border-emerald-500/40", numColor: "text-emerald-400/70" },
  };
  const c = accentMap[accentColor] ?? accentMap.blue;

  return (
    <div className={cn("bg-slate-950/60 border rounded-lg overflow-hidden", c.border)}>
      <div className={cn("flex items-center justify-between px-3 py-2 border-b", c.header)}>
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-100">{label}</span>
          <span className="text-[10px] font-mono tabular-nums text-slate-500">{keywords.length}</span>
        </div>
        <button
          onClick={() => onCopy(keywords.map((k: any) => k.value).join("\n"), `sec-${itemIndex}-${sectionIdx}`)}
          className="text-slate-500 hover:text-white transition-colors"
          aria-label="Copy all"
        >
          {copiedId === `sec-${itemIndex}-${sectionIdx}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
      <ul className="divide-y divide-slate-800/60">
        {keywords.map((kw: any, idx: number) => {
          const id = `kw-${itemIndex}-${sectionIdx}-${idx}`;
          const isCopied = copiedId === id;
          return (
            <li key={idx}>
              <button
                onClick={() => onCopy(kw.value, id)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors group",
                  "hover:bg-slate-900/80",
                )}
                data-testid={`row-kw-${itemIndex}-${idx}`}
              >
                <span className={cn("text-[10px] font-mono tabular-nums w-4 shrink-0", c.numColor)}>
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <span className="text-xs text-slate-200 flex-1 break-words">{kw.value}</span>
                {isCopied ? (
                  <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                ) : (
                  <Copy className="w-3 h-3 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

