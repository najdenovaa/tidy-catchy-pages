import { useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, FileText, Trash2, Brain, Loader2, AlertTriangle, CheckCircle, ToggleLeft, ToggleRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { WellData, DrillingFluid, SlurryInput, BufferFluid, DisplacementFluid } from "@/lib/cementing-calculations";
import type { CentralizationResult } from "@/lib/centralization-calculations";

interface AnalysisSectionProps {
  wellData: WellData;
  drillingFluid: DrillingFluid;
  slurries: SlurryInput[];
  buffers: BufferFluid[];
  displacementFluids: DisplacementFluid[];
  centralizationResults: CentralizationResult[] | null;
}

interface UploadedFile {
  name: string;
  path: string;
  type: "akc" | "program" | "report";
}

export default function AnalysisSection({
  wellData,
  drillingFluid,
  slurries,
  buffers,
  displacementFluids,
  centralizationResults,
}: AnalysisSectionProps) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [report, setReport] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [useOwnProgram, setUseOwnProgram] = useState(true); // true = данные текущего расчёта, false = сторонний файл
  const reportRef = useRef<HTMLDivElement>(null);

  const uploadFile = useCallback(async (file: File, docType: "akc" | "program" | "report") => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setError("Войдите в аккаунт для загрузки файлов");
      return;
    }

    setUploading(true);
    setError("");
    try {
      const ext = file.name.split(".").pop() || "pdf";
      const path = `${session.user.id}/${docType}_${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("analysis-docs")
        .upload(path, file);

      if (uploadError) throw uploadError;

      setFiles(prev => {
        const filtered = prev.filter(f => f.type !== docType);
        return [...filtered, { name: file.name, path, type: docType }];
      });
    } catch (e: any) {
      setError("Ошибка загрузки: " + e.message);
    } finally {
      setUploading(false);
    }
  }, []);

  const removeFile = useCallback(async (file: UploadedFile) => {
    await supabase.storage.from("analysis-docs").remove([file.path]);
    setFiles(prev => prev.filter(f => f.path !== file.path));
  }, []);

  const extractTextFromFile = async (file: UploadedFile): Promise<string> => {
    const { data } = await supabase.storage
      .from("analysis-docs")
      .download(file.path);
    if (!data) return "";
    const text = await data.text();
    // For PDF binary, we still send the raw text — the AI will extract what it can
    return text.substring(0, 20000);
  };

  const runAnalysis = useCallback(async () => {
    setAnalyzing(true);
    setError("");
    setReport("");

    try {
      // Extract text from uploaded files
      const documentTexts: Record<string, string> = {};
      for (const file of files) {
        // Skip program file if using own calc data
        if (file.type === "program" && useOwnProgram) continue;
        try {
          documentTexts[file.type] = await extractTextFromFile(file);
        } catch {
          documentTexts[file.type] = `[Файл: ${file.name} — не удалось извлечь текст]`;
        }
      }

      // If using own program — pass current calc data as program context
      const calcData = {
        wellData,
        drillingFluid,
        slurries,
        buffers,
        displacementFluids,
        centralizationResults,
        useOwnProgram,
      };

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-cement`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ documentTexts, calcData }),
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Ошибка сервера" }));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      // Stream SSE
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nlIdx: number;
        while ((nlIdx = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, nlIdx);
          buffer = buffer.slice(nlIdx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullText += content;
              setReport(fullText);
              if (reportRef.current) {
                reportRef.current.scrollTop = reportRef.current.scrollHeight;
              }
            }
          } catch {}
        }
      }
    } catch (e: any) {
      setError(e.message || "Ошибка анализа");
    } finally {
      setAnalyzing(false);
    }
  }, [files, wellData, drillingFluid, slurries, buffers, displacementFluids, centralizationResults, useOwnProgram]);

  const docTypes = [
    { type: "akc" as const, label: "📊 АКЦ / СГДТ / CBL-VDL", desc: "Геофизические данные" },
    { type: "program" as const, label: "📋 Программа цементирования", desc: "Плановый документ" },
    { type: "report" as const, label: "📝 Отчёт по цементированию", desc: "Фактические данные" },
  ];

  const hasAnyInput = files.length > 0 || (wellData.wellDepthMD > 0 && slurries.length > 0);

  return (
    <div className="space-y-4">
      {/* Upload Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Brain className="w-5 h-5 text-primary" />
            🔬 Анализ качества цементирования
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Загрузите документы геофизики и отчёты — система проанализирует качество цементирования с учётом данных вашего расчёта
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {docTypes.map(({ type, label, desc }) => {
              const existing = files.find(f => f.type === type);
              return (
                <div
                  key={type}
                  className="border-2 border-dashed border-border rounded-lg p-4 text-center space-y-2 hover:border-primary/50 transition-colors"
                >
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                  {existing ? (
                    <div className="flex items-center justify-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      <span className="text-xs truncate max-w-[120px]">{existing.name}</span>
                      <button onClick={() => removeFile(existing)} className="text-destructive hover:text-destructive/80">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted hover:bg-muted/80 text-xs font-medium transition-colors">
                      <Upload className="w-3.5 h-3.5" />
                      Загрузить
                      <input
                        type="file"
                        className="hidden"
                        accept=".pdf,.docx,.doc,.txt,.xlsx,.xls"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadFile(f, type);
                          e.target.value = "";
                        }}
                        disabled={uploading}
                      />
                    </label>
                  )}
                </div>
              );
            })}
          </div>

          {/* Calc data status */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
            <FileText className="w-4 h-4 shrink-0" />
            <span>
              Данные расчёта:{" "}
              {wellData.wellDepthMD > 0 ? (
                <span className="text-green-600 font-medium">✅ Скважина {wellData.wellDepthMD}м</span>
              ) : (
                <span className="text-amber-600">⚠️ Не заполнены</span>
              )}
              {" | "}
              {slurries.length > 0 ? (
                <span className="text-green-600 font-medium">✅ {slurries.length} раствор(ов)</span>
              ) : (
                <span className="text-amber-600">⚠️ Нет растворов</span>
              )}
              {" | "}
              {centralizationResults ? (
                <span className="text-green-600 font-medium">✅ Центрирование</span>
              ) : (
                <span className="text-muted-foreground">— Нет данных центрирования</span>
              )}
            </span>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <Button
            onClick={runAnalysis}
            disabled={!hasAnyInput || analyzing}
            className="w-full"
            size="lg"
          >
            {analyzing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Анализирую...
              </>
            ) : (
              <>
                <Brain className="w-4 h-4" />
                🚀 Запустить анализ
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Report */}
      {report && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              📄 Отчёт анализа
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              ref={reportRef}
              className="prose prose-sm dark:prose-invert max-w-none max-h-[600px] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed"
            >
              {report}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
