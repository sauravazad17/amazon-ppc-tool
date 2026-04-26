import { useState, useEffect, useMemo } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { 
  Copy, 
  Check, 
  Download, 
  Layers, 
  Target, 
  Zap, 
  Sparkles, 
  ExternalLink, 
  RotateCcw, 
  AlertCircle,
  Search,
  LayoutDashboard
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

const ASIN_REGEX = /^B0[A-Z0-9]{8}$/;

const formSchema = z.object({
  title: z.string().optional(),
  asin: z.string().optional(),
  brand: z.string().optional(),
  category: z.string().optional(),
  priceRange: z.string().optional(),
}).superRefine((data, ctx) => {
  if (!data.title && !data.asin) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At least one of Product Title or ASIN must be provided",
      path: ["title"],
    });
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At least one of Product Title or ASIN must be provided",
      path: ["asin"],
    });
  }
  if (data.asin && !ASIN_REGEX.test(data.asin)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Invalid ASIN format (e.g., B07FZ8S74R)",
      path: ["asin"],
    });
  }
});

type FormValues = z.infer<typeof formSchema>;

const LOADING_PHRASES = [
  "Analyzing product…",
  "Generating keywords…",
  "Fetching competitor ASINs…",
  "Optimizing results…",
];

export default function Home() {
  const { toast } = useToast();
  const mutation = useGenerateKeywords();
  const [loadingPhraseIndex, setLoadingPhraseIndex] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      asin: "",
      brand: "",
      category: "",
      priceRange: "",
    },
  });

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (mutation.isPending) {
      interval = setInterval(() => {
        setLoadingPhraseIndex((prev) => (prev + 1) % LOADING_PHRASES.length);
      }, 1500);
    }
    return () => clearInterval(interval);
  }, [mutation.isPending]);

  const onSubmit = (data: FormValues) => {
    mutation.mutate({
      data: {
        title: data.title || undefined,
        asin: data.asin || undefined,
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

  const copyToClipboard = async (text: string, id: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      toast({
        title: "Copied!",
        description: `${label} copied to clipboard.`,
      });
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
    if (!mutation.data) return;
    const { keywords } = mutation.data;
    const csvContent = [
      "type,keyword",
      ...keywords.map((k) => `"${k.type}","${k.value}"`),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.setAttribute("href", url);
    link.setAttribute("download", `amazon-ppc-keywords-${timestamp}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyAllKeywords = () => {
    if (!mutation.data) return;
    const text = mutation.data.keywords.map((k) => k.value).join("\n");
    copyToClipboard(text, "all-keywords", "All keywords");
  };

  const errorMessage = useMemo(() => {
    if (!mutation.error) return null;
    return (mutation.error as any)?.response?.data?.error || (mutation.error as Error)?.message;
  }, [mutation.error]);

  return (
    <div className="min-h-screen bg-[#020617] text-slate-50 font-sans selection:bg-blue-500/30">
      {/* Background Texture */}
      <div className="fixed inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none opacity-20" />

      {/* Top Bar */}
      <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md">
        <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center shadow-lg shadow-blue-900/20">
              <Zap className="w-6 h-6 text-white fill-current" />
            </div>
            <div>
              <h1 className="font-bold text-xl tracking-tight leading-none">Amazon PPC Keywords</h1>
              <p className="text-xs text-slate-400 mt-1">AI-powered keyword research for Amazon sellers</p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Live Amazon search</span>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto p-6 grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-8 relative z-10">
        {/* Left Column: Form */}
        <aside className="lg:sticky lg:top-24 self-start">
          <Card className="bg-slate-900/50 border-slate-800 shadow-xl backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <Search className="w-4 h-4 text-blue-400" />
                Product Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-300">Product Title</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder='e.g. "Stainless Steel Insulated Water Bottle 32oz with Straw"'
                            className="bg-slate-950 border-slate-800 focus:ring-blue-500 min-h-[100px] resize-none"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage className="text-rose-400" />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="asin"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-300">ASIN</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="B07FZ8S74R"
                            className="bg-slate-950 border-slate-800 focus:ring-blue-500 uppercase"
                            {...field}
                            onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                          />
                        </FormControl>
                        <FormDescription className="text-slate-500 text-[11px]">
                          Paste an ASIN to auto-fetch title from Amazon.
                        </FormDescription>
                        <FormMessage className="text-rose-400" />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="brand"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-300">Brand (Optional)</FormLabel>
                        <FormControl>
                          <Input className="bg-slate-950 border-slate-800 focus:ring-blue-500" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="category"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-300">Category (Optional)</FormLabel>
                        <FormControl>
                          <Input className="bg-slate-950 border-slate-800 focus:ring-blue-500" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="priceRange"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-300">Price Range (Optional)</FormLabel>
                        <FormControl>
                          <Input placeholder="$20-$30" className="bg-slate-950 border-slate-800 focus:ring-blue-500" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button
                    type="submit"
                    disabled={mutation.isPending}
                    className="w-full h-11 bg-blue-600 hover:bg-blue-500 text-white font-bold transition-all active:scale-[0.98] shadow-lg shadow-blue-600/20"
                    data-testid="btn-generate"
                  >
                    {mutation.isPending ? (
                      <div className="flex items-center gap-3">
                        <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                        <span>{LOADING_PHRASES[loadingPhraseIndex]}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 fill-current" />
                        Generate Keywords
                      </div>
                    )}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </aside>

        {/* Right Column: Results */}
        <section className="min-h-[600px]">
          <AnimatePresence mode="wait">
            {!mutation.data && !mutation.isPending && !mutation.isError && (
              <motion.div
                key="empty"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="h-full flex flex-col items-center justify-center p-12 border-2 border-dashed border-slate-800 rounded-2xl bg-slate-900/20"
              >
                <div className="w-20 h-20 rounded-3xl bg-slate-800/50 flex items-center justify-center mb-8">
                  <LayoutDashboard className="w-10 h-10 text-slate-500" />
                </div>
                <h2 className="text-2xl font-bold mb-3">Intelligence Dashboard</h2>
                <p className="text-slate-400 max-w-md text-center leading-relaxed mb-8">
                  Our AI analyzes millions of search patterns to find the highest converting targets for your product.
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  <Badge variant="outline" className="px-4 py-2 border-orange-500/20 bg-orange-500/5 text-orange-400 text-sm">
                    <Target className="w-3.5 h-3.5 mr-2" /> High Intent
                  </Badge>
                  <Badge variant="outline" className="px-4 py-2 border-blue-500/20 bg-blue-500/5 text-blue-400 text-sm">
                    <Layers className="w-3.5 h-3.5 mr-2" /> Core Keywords
                  </Badge>
                  <Badge variant="outline" className="px-4 py-2 border-emerald-500/20 bg-emerald-500/5 text-emerald-400 text-sm">
                    <Sparkles className="w-3.5 h-3.5 mr-2" /> Long Tail
                  </Badge>
                </div>
              </motion.div>
            )}

            {mutation.isPending && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-8"
              >
                <div className="p-6 bg-slate-900/50 border border-slate-800 rounded-xl">
                  <Skeleton className="h-4 w-48 mb-3 bg-slate-800" />
                  <Skeleton className="h-8 w-full bg-slate-800" />
                </div>
                <div className="grid grid-cols-1 gap-6">
                  {[1, 2, 3].map((i) => (
                    <Card key={i} className="bg-slate-900/50 border-slate-800">
                      <CardHeader className="flex flex-row items-center justify-between pb-4">
                        <Skeleton className="h-6 w-32 bg-slate-800" />
                        <Skeleton className="h-8 w-20 bg-slate-800" />
                      </CardHeader>
                      <CardContent className="flex flex-wrap gap-3">
                        {[1, 2, 3, 4, 5, 6].map((j) => (
                          <Skeleton key={j} className="h-10 w-24 rounded-full bg-slate-800" />
                        ))}
                      </CardContent>
                    </Card>
                  ))}
                  <Card className="bg-slate-900/50 border-slate-800">
                    <CardContent className="pt-6 space-y-4">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <Skeleton key={i} className="h-12 w-full bg-slate-800 rounded-lg" />
                      ))}
                    </CardContent>
                  </Card>
                </div>
              </motion.div>
            )}

            {mutation.isError && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                <Alert variant="destructive" className="bg-rose-500/10 border-rose-500/20 text-rose-400">
                  <AlertCircle className="h-5 w-5" />
                  <AlertTitle>Generation Failed</AlertTitle>
                  <AlertDescription className="mt-2 text-rose-400/80">
                    {errorMessage}
                  </AlertDescription>
                </Alert>
                <Button 
                  onClick={() => form.handleSubmit(onSubmit)()}
                  variant="outline"
                  className="border-slate-800 hover:bg-slate-800"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Retry Generation
                </Button>
              </motion.div>
            )}

            {mutation.data && !mutation.isPending && (
              <motion.div
                key="results"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-8"
              >
                {/* Results Toolbar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <LayoutDashboard className="w-5 h-5 text-blue-400" />
                    Targeting Analysis
                  </h2>
                  <div className="flex items-center gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={copyAllKeywords}
                      className="border-slate-800 bg-slate-900 hover:bg-slate-800 h-9"
                    >
                      <Copy className="w-3.5 h-3.5 mr-2" />
                      Copy All
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={exportCSV}
                      className="border-slate-800 bg-slate-900 hover:bg-slate-800 h-9"
                    >
                      <Download className="w-3.5 h-3.5 mr-2" />
                      Export CSV
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={handleReset}
                      className="text-slate-400 hover:text-white h-9"
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-2" />
                      Reset
                    </Button>
                  </div>
                </div>

                {/* Resolved Title Banner */}
                <div className="p-5 bg-gradient-to-r from-blue-600/10 to-transparent border border-blue-500/20 rounded-xl flex items-center justify-between gap-4">
                  <div className="flex-1 overflow-hidden">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-blue-400 mb-1">Generating keywords for:</p>
                    <h3 className="text-lg font-medium text-slate-100 truncate">{mutation.data.resolvedTitle}</h3>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => copyToClipboard(mutation.data!.resolvedTitle, "resolved-title", "Product title")}
                    className="shrink-0 text-blue-400 hover:bg-blue-500/10"
                  >
                    {copiedId === "resolved-title" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>

                {/* Keyword Groups */}
                <div className="grid grid-cols-1 gap-6">
                  <KeywordGroup
                    title="High Intent"
                    icon={Target}
                    color="orange"
                    keywords={mutation.data.keywords.filter(k => k.type === "High Intent")}
                    copiedId={copiedId}
                    onCopyKeyword={(val, id) => copyToClipboard(val, id, "Keyword")}
                    onCopyAll={(text) => copyToClipboard(text, "group-high", "High intent group")}
                  />
                  <KeywordGroup
                    title="Core Keywords"
                    icon={Layers}
                    color="blue"
                    keywords={mutation.data.keywords.filter(k => k.type === "Core")}
                    copiedId={copiedId}
                    onCopyKeyword={(val, id) => copyToClipboard(val, id, "Keyword")}
                    onCopyAll={(text) => copyToClipboard(text, "group-core", "Core group")}
                  />
                  <KeywordGroup
                    title="Long-Tail Keywords"
                    icon={Sparkles}
                    color="emerald"
                    keywords={mutation.data.keywords.filter(k => k.type === "Long Tail")}
                    copiedId={copiedId}
                    onCopyKeyword={(val, id) => copyToClipboard(val, id, "Keyword")}
                    onCopyAll={(text) => copyToClipboard(text, "group-long", "Long tail group")}
                  />

                  {/* Competitor ASINs */}
                  <Card className="bg-slate-900/50 border-slate-800 overflow-hidden">
                    <CardHeader className="flex flex-row items-center justify-between border-b border-slate-800/50 bg-slate-800/20 py-4">
                      <CardTitle className="text-sm font-bold flex items-center gap-2">
                        <Search className="w-4 h-4 text-slate-400" />
                        Competitor ASINs
                      </CardTitle>
                      {mutation.data.competitor_asins.length > 0 && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="text-xs h-7 text-slate-400"
                          onClick={() => copyToClipboard(mutation.data!.competitor_asins.join("\n"), "asin-list", "ASIN list")}
                        >
                          <Copy className="w-3 h-3 mr-2" />
                          Copy List
                        </Button>
                      )}
                    </CardHeader>
                    <CardContent className="pt-6">
                      {mutation.data.competitor_asins.length === 0 ? (
                        <p className="text-center py-6 text-slate-500 text-sm">
                          Could not fetch competitor ASINs from Amazon — try again in a moment.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {mutation.data.competitor_asins.map((asin, idx) => (
                            <div 
                              key={asin} 
                              className="group flex items-center justify-between p-3 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-700 transition-colors"
                            >
                              <div className="flex items-center gap-4">
                                <span className="w-6 h-6 rounded bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-400">
                                  {idx + 1}
                                </span>
                                <span className="font-mono text-sm tracking-widest text-slate-300">{asin}</span>
                              </div>
                              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-slate-400 hover:text-white"
                                  onClick={() => copyToClipboard(asin, `asin-${idx}`, "ASIN")}
                                  data-testid={`btn-copy-asin-${idx}`}
                                >
                                  {copiedId === `asin-${idx}` ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-slate-400 hover:text-white"
                                  asChild
                                >
                                  <a href={`https://www.amazon.com/dp/${asin}`} target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="w-3.5 h-3.5" />
                                  </a>
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </main>
    </div>
  );
}

interface KeywordGroupProps {
  title: string;
  icon: any;
  color: "orange" | "blue" | "emerald";
  keywords: { value: string }[];
  copiedId: string | null;
  onCopyKeyword: (val: string, id: string) => void;
  onCopyAll: (text: string) => void;
}

const colorMap = {
  orange: "text-orange-400 border-orange-500/20 bg-orange-500/5",
  blue: "text-blue-400 border-blue-500/20 bg-blue-500/5",
  emerald: "text-emerald-400 border-emerald-500/20 bg-emerald-500/5",
};

const iconColorMap = {
  orange: "text-orange-500",
  blue: "text-blue-500",
  emerald: "text-emerald-500",
};

function KeywordGroup({ title, icon: Icon, color, keywords, copiedId, onCopyKeyword, onCopyAll }: KeywordGroupProps) {
  return (
    <Card className="bg-slate-900/50 border-slate-800 overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between border-b border-slate-800/50 bg-slate-800/20 py-4">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Icon className={cn("w-4 h-4", iconColorMap[color])} />
          {title}
          <Badge variant="secondary" className="bg-slate-800 text-slate-400 ml-2 border-slate-700">
            {keywords.length}
          </Badge>
        </CardTitle>
        <Button 
          variant="ghost" 
          size="sm" 
          className="text-xs h-7 text-slate-400"
          onClick={() => onCopyAll(keywords.map(k => k.value).join("\n"))}
        >
          <Copy className="w-3 h-3 mr-2" />
          Copy All
        </Button>
      </CardHeader>
      <CardContent className="pt-6">
        <div className="flex flex-wrap gap-2">
          {keywords.map((keyword, idx) => {
            const id = `kw-${title}-${idx}`;
            return (
              <motion.button
                key={keyword.value}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.03 }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => onCopyKeyword(keyword.value, id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-full border text-sm transition-all",
                  colorMap[color],
                  "hover:border-white/20 hover:bg-white/5"
                )}
                data-testid={`chip-keyword-${idx}`}
              >
                <span>{keyword.value}</span>
                {copiedId === id ? (
                  <Check className="w-3 h-3 text-emerald-500" />
                ) : (
                  <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100" />
                )}
              </motion.button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
