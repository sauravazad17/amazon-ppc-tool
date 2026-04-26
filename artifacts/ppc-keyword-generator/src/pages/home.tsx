import { useState, useEffect, useMemo } from "react";
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
  Info
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

const ASIN_REGEX = /B0[A-Z0-9]{8}/g;

const formSchema = z.object({
  asinsRaw: z.string().default(""),
  title: z.string().default(""),
  brand: z.string().default(""),
  category: z.string().default(""),
  priceRange: z.string().default(""),
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
  "Fetching product titles…",
  "Generating keywords…",
  "Finding competitors…",
];

export default function Home() {
  const { toast } = useToast();
  const mutation = useGenerateKeywords();
  const [loadingPhraseIndex, setLoadingPhraseIndex] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showTitleInput, setShowTitleInput] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      asinsRaw: "",
      title: "",
      brand: "",
      category: "",
      priceRange: "",
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
      interval = setInterval(() => {
        setLoadingPhraseIndex((prev) => (prev + 1) % LOADING_PHRASES.length);
      }, 1600);
    }
    return () => clearInterval(interval);
  }, [mutation.isPending]);

  const onSubmit = (data: FormValues) => {
    const parsedAsins = data.asinsRaw.toUpperCase().match(ASIN_REGEX);
    mutation.mutate({
      data: {
        asins: parsedAsins,
        title: data.title || undefined,
        brand: data.brand || undefined,
        category: data.category || undefined,
        priceRange: data.priceRange || undefined,
      },
    });
  };

  const handleReset = () => {
    form.reset();
    mutation.reset();
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
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
                <h1 className="font-bold text-sm tracking-tight leading-none">Amazon PPC Keyword Generator</h1>
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
          <aside className="lg:h-screen lg:sticky lg:top-0 border-r border-slate-800 bg-slate-950/40 overflow-y-auto px-5 py-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="asinsRaw"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-semibold text-slate-300">Amazon ASINs</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="B07FZ8S74R, B0BDHWDR12..."
                          className="bg-slate-950 border-slate-800 focus:ring-blue-500 min-h-[120px] font-mono text-xs resize-none"
                          {...field}
                        />
                      </FormControl>
                      <div className="flex justify-between items-center pt-1">
                        <p className="text-[10px] text-slate-500">Paste up to 15 ASINs</p>
                        <div className="text-[10px] font-medium">
                          <span className="text-emerald-400">{asinStats.valid} valid</span>
                          <span className="text-slate-600 mx-1">·</span>
                          <span className="text-rose-400">{asinStats.invalid} invalid</span>
                        </div>
                      </div>
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

                <div className="space-y-4 pt-2">
                  <FormField
                    control={form.control}
                    name="brand"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-slate-400">Brand override</FormLabel>
                        <FormControl>
                          <Input className="bg-slate-950 border-slate-800 h-8 text-xs" placeholder="Optional" {...field} />
                        </FormControl>
                        <FormDescription className="text-[10px] text-slate-600">Auto-detected if blank</FormDescription>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="category"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-slate-400">Category</FormLabel>
                        <FormControl>
                          <Input className="bg-slate-950 border-slate-800 h-8 text-xs" placeholder="Optional" {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="priceRange"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-slate-400">Price range</FormLabel>
                        <FormControl>
                          <Input className="bg-slate-950 border-slate-800 h-8 text-xs" placeholder="$20-$30" {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
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
                  <h2 className="text-xl font-bold text-slate-200 mb-2">Ready to Analyze</h2>
                  <p className="text-sm text-slate-500 max-w-sm">
                    Enter Amazon ASINs on the left to generate conversion-optimized keywords and competitor targets.
                  </p>
                </motion.div>
              )}

              {mutation.isPending && (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="p-8 space-y-6"
                >
                  <div className="h-10 w-64 bg-slate-900 animate-pulse rounded" />
                  <div className="space-y-4">
                    {[1, 2].map(i => (
                      <div key={i} className="h-48 w-full bg-slate-900 animate-pulse rounded-xl border border-slate-800" />
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
                  <div className="sticky top-14 z-40 bg-slate-950/60 backdrop-blur-md border-b border-slate-800 px-6 py-3 flex items-center justify-between">
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
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" className="h-8 text-xs border-slate-800 bg-slate-900 hover:bg-slate-800" onClick={copyAllKeywords} data-testid="btn-copy-all">
                        {copiedId === "copy-all" ? <Check className="w-3 h-3 mr-1.5" /> : <Copy className="w-3 h-3 mr-1.5" />}
                        Copy all
                      </Button>
                      <Button variant="outline" size="sm" className="h-8 text-xs border-slate-800 bg-slate-900 hover:bg-slate-800" onClick={exportCSV} data-testid="btn-export-csv">
                        <Download className="w-3 h-3 mr-1.5" />
                        Export CSV
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 text-xs text-slate-500 hover:text-white" onClick={handleReset} data-testid="btn-reset">
                        <RotateCcw className="w-3 h-3 mr-1.5" />
                        New search
                      </Button>
                    </div>
                  </div>

                  <div className="p-6 space-y-4">
                    {mutation.data.items.length === 1 ? (
                      <ResultCard item={mutation.data.items[0]} index={0} />
                    ) : (
                      <Accordion type="single" collapsible defaultValue="item-0" className="space-y-3">
                        {mutation.data.items.map((item, idx) => (
                          <AccordionItem key={idx} value={`item-${idx}`} className="border-none">
                            <AccordionTrigger className="flex p-3 bg-slate-900/40 hover:bg-slate-900/60 rounded-lg border border-slate-800 transition-all [&[data-state=open]]:rounded-b-none [&[data-state=open]]:border-b-0 hover:no-underline">
                              <div className="flex items-center gap-3 text-left min-w-0 pr-4">
                                <Badge variant="outline" className="font-mono text-[10px] shrink-0 bg-slate-950 border-slate-700">
                                  {item.asin || "TITLE"}
                                </Badge>
                                <span className="text-sm font-medium truncate text-slate-300">
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
    setTimeout(() => setCopiedId(null), 1500);
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
    <Card className={cn("bg-slate-900/40 border-slate-800 overflow-hidden", noBorder && "border-none shadow-none bg-transparent")}>
      <CardContent className="p-4 space-y-6">
        {/* Header Strip */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs text-blue-400 font-bold tracking-widest">{item.asin || "N/A"}</span>
              {item.detectedBrand && (
                <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-[10px] py-0 h-4">
                  Brand: {item.detectedBrand}
                </Badge>
              )}
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <h3 className="text-sm font-semibold text-slate-100 truncate cursor-help">
                  {item.title}
                </h3>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs bg-slate-900 border-slate-800 text-xs">
                {item.title}
              </TooltipContent>
            </Tooltip>
          </div>
          {item.asin && (
            <a 
              href={`https://www.amazon.com/dp/${item.asin}`} 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-blue-400 transition-colors whitespace-nowrap"
            >
              View on Amazon <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
        </div>

        {/* Keywords Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <KeywordSection 
            label="High Intent" 
            keywords={item.keywords.filter((k: any) => k.type === "High Intent")}
            borderColor="border-amber-500/50"
            itemIndex={index}
            sectionIdx={0}
            onCopy={copy}
            copiedId={copiedId}
          />
          <KeywordSection 
            label="Core" 
            keywords={item.keywords.filter((k: any) => k.type === "Core")}
            borderColor="border-blue-500/50"
            itemIndex={index}
            sectionIdx={1}
            onCopy={copy}
            copiedId={copiedId}
          />
          <KeywordSection 
            label="Long-Tail" 
            keywords={item.keywords.filter((k: any) => k.type === "Long Tail")}
            borderColor="border-emerald-500/50"
            itemIndex={index}
            sectionIdx={2}
            onCopy={copy}
            copiedId={copiedId}
          />
        </div>

        {/* Competitor Targets */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
              <Search className="w-3 h-3" />
              Competitor Targets
            </h4>
            {item.competitor_asins.length > 0 && (
              <button 
                onClick={() => copy(item.competitor_asins.join("\n"), `targets-${index}`)}
                className="text-[10px] text-slate-500 hover:text-white flex items-center gap-1"
              >
                {copiedId === `targets-${index}` ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
                Copy all
              </button>
            )}
          </div>
          
          {item.competitor_asins.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {item.competitor_asins.map((asin: string, idx: number) => (
                <div key={asin} className="flex items-center bg-slate-950 border border-slate-800 rounded px-2 py-1 group">
                  <span className="text-[9px] font-bold text-slate-600 mr-2">{idx + 1}</span>
                  <span className="font-mono text-xs text-slate-300 tracking-wider mr-2">{asin}</span>
                  <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={() => copy(asin, `asin-${index}-${idx}`)}
                      className="text-slate-500 hover:text-blue-400"
                      data-testid={`btn-asin-${index}-${idx}`}
                    >
                      {copiedId === `asin-${index}-${idx}` ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
                    </button>
                    <a href={`https://www.amazon.com/dp/${asin}`} target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-blue-400">
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-slate-600 italic">No competitor ASINs found from Amazon search — try again.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function KeywordSection({ label, keywords, borderColor, itemIndex, sectionIdx, onCopy, copiedId }: any) {
  return (
    <div className={cn("bg-slate-950/40 border-l-2 p-2.5 rounded-r-lg space-y-3", borderColor)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
          <Badge className="bg-slate-900 text-slate-400 text-[9px] py-0 h-3.5 px-1.5 font-mono">{keywords.length}</Badge>
        </div>
        <button 
          onClick={() => onCopy(keywords.map((k: any) => k.value).join("\n"), `sec-${itemIndex}-${sectionIdx}`)}
          className="text-slate-500 hover:text-white transition-colors"
        >
          {copiedId === `sec-${itemIndex}-${sectionIdx}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {keywords.map((kw: any, idx: number) => (
          <motion.button
            key={idx}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: idx * 0.02 }}
            onClick={() => onCopy(kw.value, `kw-${itemIndex}-${sectionIdx}-${idx}`)}
            className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-400 hover:text-white hover:border-slate-700 transition-all flex items-center gap-1.5 group"
            data-testid={`chip-kw-${itemIndex}-${idx}`}
          >
            {kw.value}
            {copiedId === `kw-${itemIndex}-${sectionIdx}-${idx}` && <Check className="w-2.5 h-2.5 text-emerald-400" />}
          </motion.button>
        ))}
      </div>
    </div>
  );
}
