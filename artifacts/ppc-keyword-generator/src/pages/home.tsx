import { useState, useRef, useEffect } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, Check, BarChart3, Activity, Download, ChevronRight, AlertCircle, ArrowRight, Layers, Target, Coins, ShieldAlert, Zap } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useGenerateKeywords } from "@workspace/api-client-react";
import { KeywordResult, KeywordType } from "@workspace/api-client-react/src/generated/api.schemas";
import { useToast } from "@/hooks/use-toast";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const formSchema = z.object({
  title: z.string().min(2, "Product title is required and must be at least 2 characters."),
  brand: z.string().optional(),
  category: z.string().optional(),
  priceRange: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function Home() {
  const { toast } = useToast();
  const generateMutation = useGenerateKeywords();
  
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      brand: "",
      category: "",
      priceRange: "",
    },
  });

  const [copiedKeyword, setCopiedKeyword] = useState<string | null>(null);

  const onSubmit = (data: FormValues) => {
    generateMutation.mutate({
      data: {
        title: data.title,
        brand: data.brand || undefined,
        category: data.category || undefined,
        priceRange: data.priceRange || undefined,
      }
    });
  };

  const copyToClipboard = (text: string, description: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKeyword(text);
      toast({
        title: "Copied to clipboard",
        description: `${description} copied.`,
        duration: 2000,
      });
      setTimeout(() => setCopiedKeyword(null), 2000);
    });
  };

  const copyGroup = (keywords: { value: string }[], groupName: string) => {
    const text = keywords.map(k => k.value).join("\n");
    copyToClipboard(text, `All ${groupName} keywords`);
  };

  const copyAll = (result: KeywordResult) => {
    const text = result.keywords.map(k => k.value).join("\n");
    copyToClipboard(text, "All generated keywords");
  };

  const exportCSV = (result: KeywordResult) => {
    const header = "Keyword,Type\n";
    const rows = result.keywords.map(k => `"${k.value.replace(/"/g, '""')}","${k.type}"`).join("\n");
    const csvContent = header + rows;
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "ppc_keywords.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const result = generateMutation.data;
  
  const highIntent = result?.keywords.filter(k => k.type === "High Intent") || [];
  const core = result?.keywords.filter(k => k.type === "Core") || [];
  const longTail = result?.keywords.filter(k => k.type === "Long Tail") || [];

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col font-sans selection:bg-primary/30 selection:text-primary-foreground">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground shadow-[0_0_15px_rgba(245,158,11,0.3)]">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-semibold text-lg tracking-tight leading-none text-foreground">PPC Keywords</h1>
              <p className="text-xs text-muted-foreground mt-0.5 tracking-wide">High-converting targeting generation</p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left Column: Form */}
        <div className="lg:col-span-4 space-y-6 lg:sticky lg:top-24">
          <Card className="bg-card/40 border-border/50 shadow-lg shadow-black/20">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" />
                Product Details
              </CardTitle>
              <CardDescription>
                Provide ASIN details to generate targeted campaigns.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Product Title *</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="e.g. Wireless Bluetooth Earbuds with Noise Cancellation..." 
                            className="min-h-[100px] resize-none bg-background/50 border-border/50 focus-visible:ring-primary/50" 
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="brand"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                            <ShieldAlert className="w-3 h-3" />
                            Brand
                          </FormLabel>
                          <FormControl>
                            <Input placeholder="Optional" className="bg-background/50 border-border/50 h-9 text-sm" {...field} />
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
                          <FormLabel className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                            <Layers className="w-3 h-3" />
                            Category
                          </FormLabel>
                          <FormControl>
                            <Input placeholder="Optional" className="bg-background/50 border-border/50 h-9 text-sm" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="priceRange"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                          <Coins className="w-3 h-3" />
                          Price Range
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="$20-$30" className="bg-background/50 border-border/50 h-9 text-sm" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button 
                    type="submit" 
                    className="w-full mt-4 h-10 shadow-lg shadow-primary/20 transition-all hover:shadow-primary/40 active:scale-[0.98]"
                    disabled={generateMutation.isPending}
                  >
                    {generateMutation.isPending ? (
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                        Generating targets...
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 font-medium">
                        <Zap className="w-4 h-4" />
                        Generate Keywords
                      </div>
                    )}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Results */}
        <div className="lg:col-span-8 min-h-[500px]">
          <AnimatePresence mode="wait">
            {!result && !generateMutation.isPending && !generateMutation.isError && (
              <motion.div
                key="empty"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="h-full flex flex-col items-center justify-center text-center p-12 rounded-xl border border-dashed border-border bg-card/10"
              >
                <div className="w-16 h-16 rounded-2xl bg-secondary/50 flex items-center justify-center mb-6 shadow-inner">
                  <BarChart3 className="w-8 h-8 text-muted-foreground" />
                </div>
                <h2 className="text-xl font-medium text-foreground mb-2">Ready to generate targets</h2>
                <p className="text-muted-foreground max-w-md mx-auto leading-relaxed">
                  Paste your product title and details to extract a curated list of high-intent keywords and competitor ASINs tailored for Amazon Sponsored Products.
                </p>
              </motion.div>
            )}

            {generateMutation.isPending && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-full flex flex-col items-center justify-center text-center p-12"
              >
                <div className="relative w-20 h-20 mb-8">
                  <div className="absolute inset-0 border-4 border-primary/20 rounded-full"></div>
                  <div className="absolute inset-0 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Target className="w-6 h-6 text-primary animate-pulse" />
                  </div>
                </div>
                <h3 className="text-lg font-medium text-foreground">Analyzing Product Graph...</h3>
                <p className="text-sm text-muted-foreground mt-2">Extracting search volumes, intent signals, and competitor nodes.</p>
              </motion.div>
            )}

            {generateMutation.isError && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="p-6 rounded-lg bg-destructive/10 border border-destructive/20 flex gap-4"
              >
                <AlertCircle className="w-6 h-6 text-destructive shrink-0" />
                <div>
                  <h3 className="font-medium text-destructive">Generation Failed</h3>
                  <p className="text-sm text-destructive/80 mt-1">
                    {generateMutation.error?.error || "An unexpected error occurred while generating keywords."}
                  </p>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="mt-4 border-destructive/20 text-destructive hover:bg-destructive/20"
                    onClick={() => form.handleSubmit(onSubmit)()}
                  >
                    Try Again
                  </Button>
                </div>
              </motion.div>
            )}

            {result && !generateMutation.isPending && (
              <motion.div
                key="results"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ staggerChildren: 0.1 }}
                className="space-y-8"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-medium">Targeting Output</h2>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => copyAll(result)} className="h-8 gap-2 bg-card">
                      <Copy className="w-3.5 h-3.5" />
                      Copy All
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => exportCSV(result)} className="h-8 gap-2 bg-card">
                      <Download className="w-3.5 h-3.5" />
                      CSV
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-6">
                  {/* High Intent */}
                  <KeywordGroup 
                    title="High Intent" 
                    description="Highest conversion probability. Exact match priority."
                    keywords={highIntent}
                    colorClass="border-primary text-primary"
                    bgClass="bg-primary/10"
                    onCopyGroup={() => copyGroup(highIntent, "High Intent")}
                    copiedKeyword={copiedKeyword}
                    copyToClipboard={copyToClipboard}
                  />

                  {/* Core */}
                  <KeywordGroup 
                    title="Core Keywords" 
                    description="Volume drivers. Phrase and broad match targeting."
                    keywords={core}
                    colorClass="border-blue-500 text-blue-400"
                    bgClass="bg-blue-500/10"
                    onCopyGroup={() => copyGroup(core, "Core")}
                    copiedKeyword={copiedKeyword}
                    copyToClipboard={copyToClipboard}
                  />

                  {/* Long Tail */}
                  <KeywordGroup 
                    title="Long-Tail Keywords" 
                    description="Lower CPCs, highly specific shopper intent."
                    keywords={longTail}
                    colorClass="border-emerald-500 text-emerald-400"
                    bgClass="bg-emerald-500/10"
                    onCopyGroup={() => copyGroup(longTail, "Long-Tail")}
                    copiedKeyword={copiedKeyword}
                    copyToClipboard={copyToClipboard}
                  />

                  {/* Competitor ASINs */}
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="mt-4"
                  >
                    <Card className="bg-card/40 border-border/50 overflow-hidden">
                      <div className="p-4 bg-muted/30 border-b border-border/50 flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium">Competitor ASINs</h3>
                            <Badge variant="secondary" className="text-xs bg-background">
                              {result.competitor_asins.length} targets
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">For Product Targeting (PAT) campaigns.</p>
                        </div>
                        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => {
                          const text = result.competitor_asins.join("\n");
                          copyToClipboard(text, "All ASINs");
                        }}>
                          Copy List
                        </Button>
                      </div>
                      <div className="p-4 flex flex-wrap gap-2">
                        {result.competitor_asins.map((asin, i) => (
                          <div 
                            key={i} 
                            className="group flex items-center bg-background border border-border rounded-md overflow-hidden hover:border-primary/50 transition-colors"
                          >
                            <button
                              onClick={() => copyToClipboard(asin, "ASIN")}
                              className="px-3 py-1.5 text-sm font-mono flex items-center gap-2 hover:bg-muted transition-colors focus:outline-none"
                            >
                              {asin}
                              {copiedKeyword === asin ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3 text-muted-foreground group-hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity" />}
                            </button>
                            <div className="w-px h-full bg-border" />
                            <a
                              href={`https://www.amazon.com/dp/${asin}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-2.5 py-1.5 hover:bg-muted text-muted-foreground hover:text-primary transition-colors"
                              title="View on Amazon"
                            >
                              <ArrowRight className="w-3.5 h-3.5 -rotate-45" />
                            </a>
                          </div>
                        ))}
                      </div>
                    </Card>
                  </motion.div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

function KeywordGroup({ 
  title, 
  description, 
  keywords, 
  colorClass, 
  bgClass,
  onCopyGroup,
  copiedKeyword,
  copyToClipboard
}: { 
  title: string, 
  description: string, 
  keywords: { value: string }[], 
  colorClass: string,
  bgClass: string,
  onCopyGroup: () => void,
  copiedKeyword: string | null,
  copyToClipboard: (text: string, desc: string) => void
}) {
  if (keywords.length === 0) return null;
  
  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <Card className="bg-card/40 border-border/50">
        <div className="p-4 flex items-center justify-between border-b border-border/50 bg-muted/10">
          <div>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${bgClass.replace('/10', '')} shadow-[0_0_8px_currentColor] ${colorClass}`} />
              <h3 className="font-medium text-sm">{title}</h3>
              <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 font-mono">
                {keywords.length}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1 ml-4">{description}</p>
          </div>
          <Button variant="ghost" size="sm" className="h-8 text-xs gap-1.5 text-muted-foreground hover:text-foreground" onClick={onCopyGroup}>
            <Copy className="w-3.5 h-3.5" />
            Copy
          </Button>
        </div>
        <div className="p-4 flex flex-wrap gap-2">
          {keywords.map((k, i) => (
            <button
              key={i}
              onClick={() => copyToClipboard(k.value, "Keyword")}
              className="group relative flex items-center px-3 py-1.5 bg-background border border-border rounded-md text-sm hover:border-primary/50 transition-all active:scale-95 text-left"
            >
              <span className="pr-6">{k.value}</span>
              <div className="absolute right-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground group-hover:text-primary">
                {copiedKeyword === k.value ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
              </div>
            </button>
          ))}
        </div>
      </Card>
    </motion.div>
  );
}
