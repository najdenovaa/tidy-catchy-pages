import { useState, useCallback, useRef, useEffect, DragEvent, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, FileText, Trash2, Loader2, AlertTriangle, CheckCircle, FolderOpen, Cpu, Download, FileInput, LogIn } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { exportAnalysisToDocx } from "@/lib/export-analysis-docx";
import FollowUpChat from "@/components/FollowUpChat";
import { supabase } from "@/integrations/supabase/client";
import type { WellData, DrillingFluid, SlurryInput, BufferFluid, DisplacementFluid } from "@/lib/cementing-calculations";
import type { CentralizationResult } from "@/lib/centralization-calculations";
import { runAlgorithmicAnalysis } from "@/lib/cement-analysis-engine";
import { parseDocument, type ParsedDocument } from "@/lib/document-parser";
import WellDataExtractionDialog, { type ExtractedData } from "@/components/WellDataExtractionDialog";

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
  type: "akc" | "program" | "report" | "other";
}

const ACCEPTED_EXTENSIONS = ".pdf,.docx,.doc,.txt,.xlsx,.xls,.jpg,.jpeg,.png,.bmp,.tiff,.tif,.webp";

function getMimeType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    bmp: "image/bmp", tiff: "image/tiff", tif: "image/tiff", webp: "image/webp",
    txt: "text/plain",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    doc: "application/msword",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
  };
  return map[ext] || "application/octet-stream";
}

type ExtractionDocKind = "source" | "trajectory" | "lab" | "program" | "general";

function detectExtractionDocKind(file: File): ExtractionDocKind {
  const name = file.name.toLowerCase();

  if (
    name.includes("заяв") ||
    name.includes("исход") ||
    name.includes("тз") ||
    name.includes("наряд") ||
    name.includes("заказ") ||
    name.includes("гтн") ||
    name.includes("карточ") ||
    name.includes("скважин")
  ) {
    return "source";
  }

  if (
    name.includes("инклин") ||
    name.includes("inclino") ||
    name.includes("trajectory") ||
    name.includes("survey") ||
    name.includes("зенит") ||
    name.includes("azimuth") ||
    name.includes("азимут")
  ) {
    return "trajectory";
  }

  if (
    name.includes("лаб") ||
    name.includes("labor") ||
    name.includes("protocol") ||
    name.includes("протокол") ||
    name.includes("рецепт") ||
    name.includes("design")
  ) {
    return "lab";
  }

  if (name.includes("програм")) {
    return "program";
  }

  return "general";
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseLooseNumber(value: string): number | null {
  const normalized = value.replace(/,/g, ".").replace(/[^0-9.+-]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function compressTrajectoryText(text: string, stepMeters = 100): string {
  const normalized = normalizeExtractedText(text);
  const lines = normalized.split("\n");
  const headerLines: string[] = [];
  const sampledRows: string[] = [];
  let lastAcceptedMd = -Infinity;
  let lastNumericLine = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const matches = line.match(/-?\d+(?:[.,]\d+)?/g) || [];
    if (matches.length >= 3) {
      const md = parseLooseNumber(matches[0]);
      if (md == null) continue;

      lastNumericLine = line;
      if (sampledRows.length === 0 || md - lastAcceptedMd >= stepMeters - 0.5) {
        sampledRows.push(line);
        lastAcceptedMd = md;
      }
      continue;
    }

    if (headerLines.length < 12) {
      headerLines.push(line);
    }
  }

  if (lastNumericLine && sampledRows[sampledRows.length - 1] !== lastNumericLine) {
    sampledRows.push(lastNumericLine);
  }

  if (sampledRows.length < 2) {
    return normalized;
  }

  return [
    ...headerLines,
    "Сокращенная инклинометрия для AI-извлечения: точки с шагом около 100 м (MD / угол / азимут / TVD если есть).",
    ...sampledRows,
  ].join("\n");
}

function limitTextByDocKind(text: string, kind: ExtractionDocKind): string {
  const normalized = kind === "trajectory"
    ? compressTrajectoryText(text)
    : normalizeExtractedText(text);
  const maxCharsByKind: Record<ExtractionDocKind, number> = {
    source: 32000,
    lab: 22000,
    program: 18000,
    trajectory: 12000,
    general: 14000,
  };

  return normalized.slice(0, maxCharsByKind[kind]);
}

function buildCombinedExtractionText(items: Array<{ file: File; text: string; kind: ExtractionDocKind }>): string {
  const priority: Record<ExtractionDocKind, number> = {
    source: 0,
    lab: 1,
    program: 2,
    trajectory: 3,
    general: 4,
  };

  const sorted = [...items].sort((a, b) => priority[a.kind] - priority[b.kind]);

  return sorted
    .filter((item) => item.text.trim().length > 0)
    .map((item) => {
      const titleByKind: Record<ExtractionDocKind, string> = {
        source: "Исходные данные / заявка",
        lab: "Лабораторный протокол",
        program: "Программа",
        trajectory: "Инклинометрия",
        general: "Дополнительный документ",
      };

      return `=== ${titleByKind[item.kind]}: ${item.file.name} ===\n${limitTextByDocKind(item.text, item.kind)}`;
    })
    .join("\n\n");
}

function DropZone({
  label,
  desc,
  existingFiles,
  onDrop,
  onRemove,
  uploading,
  uploadingType,
  multi = false,
  type,
}: {
  label: string;
  desc: string;
  existingFiles: UploadedFile[];
  onDrop: (files: File[]) => void;
  onRemove: (file: UploadedFile) => void;
  uploading: boolean;
  uploadingType: string | null;
  multi?: boolean;
  type: string;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: DragEvent) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length) onDrop(multi ? droppedFiles : [droppedFiles[0]]);
  };

  const isUploading = uploading && uploadingType === type;

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => !isUploading && inputRef.current?.click()}
      className={`border-2 border-dashed rounded-lg p-4 text-center space-y-2 transition-all cursor-pointer
        ${dragOver ? "border-primary bg-primary/10 scale-[1.02]" : "border-border hover:border-primary/50"}`}
    >
      <p className="text-sm font-medium">{label}</p>
      <p className="text-xs text-muted-foreground">{desc}</p>

      {isUploading && (
        <div className="flex items-center justify-center gap-2 py-2">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
          <span className="text-xs text-muted-foreground">Загрузка...</span>
        </div>
      )}

      {existingFiles.length > 0 && (
        <div className="space-y-1">
          {existingFiles.map(f => (
            <div key={f.path} className="flex items-center justify-center gap-2">
              <CheckCircle className="w-3.5 h-3.5 text-green-500" />
              <span className="text-xs truncate max-w-[150px]">{f.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(f); }}
                className="text-destructive hover:text-destructive/80"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {!isUploading && existingFiles.length === 0 && (
        <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Upload className="w-3.5 h-3.5" />
          <span>Перетащите или нажмите</span>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={ACCEPTED_EXTENSIONS}
        multiple={multi}
        onChange={(e) => {
          const chosen = Array.from(e.target.files || []);
          if (chosen.length) onDrop(multi ? chosen : [chosen[0]]);
          e.target.value = "";
        }}
        disabled={uploading}
      />
    </div>
  );
}

/** Render markdown-like report with tables, bold, headers */
function ReportRenderer({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: JSX.Element[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Detect markdown table
    if (line.includes("|") && i + 1 < lines.length && lines[i + 1]?.match(/^\|[\s\-:|]+\|/)) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].includes("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      // Parse table
      const rows = tableLines
        .filter(l => !l.match(/^\|[\s\-:|]+\|$/))
        .map(l => l.split("|").map(c => c.trim()).filter(Boolean));

      if (rows.length > 0) {
        const headers = rows[0];
        const dataRows = rows.slice(1);
        elements.push(
          <div key={`table-${i}`} className="my-3 overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  {headers.map((h, hi) => (
                    <TableHead key={hi} className="font-semibold text-xs">{renderInline(h)}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {dataRows.map((row, ri) => (
                  <TableRow key={ri}>
                    {row.map((cell, ci) => (
                      <TableCell key={ci} className="text-xs py-2">{renderInline(cell)}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        );
      }
      continue;
    }

    // Headers
    if (line.startsWith("### ")) {
      elements.push(<h4 key={i} className="text-sm font-bold mt-4 mb-1 text-primary">{renderInline(line.slice(4))}</h4>);
    } else if (line.startsWith("## ")) {
      elements.push(<h3 key={i} className="text-base font-bold mt-5 mb-2 text-foreground border-b pb-1">{renderInline(line.slice(3))}</h3>);
    } else if (line.startsWith("# ")) {
      elements.push(<h2 key={i} className="text-lg font-bold mt-5 mb-2 text-foreground">{renderInline(line.slice(2))}</h2>);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <div key={i} className="flex gap-2 text-sm ml-2 my-0.5">
          <span className="text-primary mt-0.5">•</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>
      );
    } else if (line.match(/^\d+\.\s/)) {
      const num = line.match(/^(\d+)\.\s/)?.[1];
      elements.push(
        <div key={i} className="flex gap-2 text-sm ml-2 my-0.5">
          <span className="text-primary font-semibold min-w-[1.2rem]">{num}.</span>
          <span>{renderInline(line.replace(/^\d+\.\s/, ""))}</span>
        </div>
      );
    } else if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
    } else {
      elements.push(<p key={i} className="text-sm leading-relaxed my-0.5">{renderInline(line)}</p>);
    }
    i++;
  }

  return <>{elements}</>;
}

function renderInline(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push(<strong key={key++} className="font-semibold">{match[1]}</strong>);
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

export default function AnalysisSection({
  wellData,
  drillingFluid,
  slurries,
  buffers,
  displacementFluids,
  centralizationResults,
}: AnalysisSectionProps) {
  const navigate = useNavigate();
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [rawFiles, setRawFiles] = useState<Map<string, File>>(new Map());
  const [parsedDocs, setParsedDocs] = useState<ParsedDocument[]>([]);
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [report, setReport] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [activeAnalysisJobId, setActiveAnalysisJobId] = useState<string | null>(null);
  const useOwnProgram = false;
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [aiCredits, setAiCredits] = useState<{ used: number; limit: number; freeFollowups: number } | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  // Program generation from ТЗ
  const [tzFiles, setTzFiles] = useState<File[]>([]);
  const [tzFileNames, setTzFileNames] = useState<string[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [showExtractionDialog, setShowExtractionDialog] = useState(false);
  const [showAuthDialog, setShowAuthDialog] = useState(false);

  // Get current user info and credits
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUserEmail(data.session?.user?.email ?? null);
      setUserId(data.session?.user?.id ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);
      setUserId(session?.user?.id ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Load AI credits
  const loadCredits = useCallback(async () => {
    if (!userId) { setAiCredits(null); return; }
    const { data } = await supabase
      .from("user_credits")
      .select("ai_analyses_used, ai_analyses_limit, free_followups_remaining")
      .eq("user_id", userId)
      .maybeSingle();
    if (data) {
      setAiCredits({ used: data.ai_analyses_used, limit: data.ai_analyses_limit, freeFollowups: (data as any).free_followups_remaining ?? 0 });
    } else {
      await supabase.from("user_credits").insert({ user_id: userId, ai_analyses_used: 0, ai_analyses_limit: 6, free_followups_remaining: 18 });
      setAiCredits({ used: 0, limit: 6, freeFollowups: 18 });
    }
  }, [userId]);

  useEffect(() => { loadCredits(); }, [loadCredits]);

  const aiAnalysesRemaining = aiCredits ? aiCredits.limit - aiCredits.used : 0;
  const canUseAiAnalysis = aiAnalysesRemaining > 0;
  const isAlgorithmicAllowed = useMemo(() => userEmail === "info@igchem.ru", [userEmail]);

  // Elapsed time timer
  useEffect(() => {
    if (!analyzing) {
      setElapsedSeconds(0);
      return;
    }
    const interval = setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [analyzing]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) return `${mins}:${secs.toString().padStart(2, "0")}`;
    return `${secs} сек`;
  };

  const estimatedFiles = files.length;
  const estimatedMinutes = Math.max(1, Math.ceil((estimatedFiles * 0.5) + 1));


  const uploadFile = useCallback(async (file: File, docType: "akc" | "program" | "report" | "other") => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setError("Войдите в аккаунт для загрузки файлов");
      return;
    }

    setUploading(true);
    setUploadingType(docType);
    setError("");
    try {
      const ext = file.name.split(".").pop() || "pdf";
      const path = `${session.user.id}/${docType}_${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("analysis-docs")
        .upload(path, file);

      if (uploadError) throw uploadError;

      // Store raw file for local parsing
      setRawFiles(prev => new Map(prev).set(path, file));

      setFiles(prev => {
        if (docType === "other" || docType === "akc") {
          return [...prev, { name: file.name, path, type: docType }];
        }
        const filtered = prev.filter(f => f.type !== docType);
        return [...filtered, { name: file.name, path, type: docType }];
      });
    } catch (e: any) {
      setError("Ошибка загрузки: " + e.message);
    } finally {
      setUploading(false);
      setUploadingType(null);
    }
  }, []);

  const removeFile = useCallback(async (file: UploadedFile) => {
    await supabase.storage.from("analysis-docs").remove([file.path]);
    setFiles(prev => prev.filter(f => f.path !== file.path));
  }, []);

  const fileToBase64 = async (file: UploadedFile): Promise<{ base64: string; mimeType: string; name: string } | null> => {
    const { data } = await supabase.storage.from("analysis-docs").download(file.path);
    if (!data) return null;
    const arrayBuffer = await data.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return { base64: btoa(binary), mimeType: getMimeType(file.name), name: file.name };
  };

  const waitForAnalysisJob = useCallback(async (jobId: string, getInvokeFailure?: () => string | null) => {
    const startedAt = Date.now();

    while (Date.now() - startedAt < 9 * 60 * 1000) {
      const { data, error } = await supabase
        .from("analysis_jobs")
        .select("status, report, error_message")
        .eq("id", jobId)
        .maybeSingle();

      if (error) throw error;

      if (data?.status === "completed" && data.report) {
        return data.report;
      }

      if (data?.status === "failed") {
        throw new Error(data.error_message || "Ошибка анализа");
      }

      const invokeFailure = getInvokeFailure?.();
      if (invokeFailure && Date.now() - startedAt > 15000) {
        throw new Error(invokeFailure);
      }

      await new Promise((resolve) => window.setTimeout(resolve, 3000));
    }

    throw new Error("Анализ выполняется дольше обычного. Попробуйте открыть его снова через минуту.");
  }, []);

  const runAnalysis = useCallback(async () => {
    if (!canUseAiAnalysis || !userId) {
      setError("Анализы исчерпаны. Для продолжения — обратитесь в Поддержку: https://t.me/deall_support");
      return;
    }

    setAnalyzing(true);
    setError("");
    setReport("");

    try {
      const documentFiles: Record<string, any> = {};
      const otherDocs: any[] = [];
      const akcDocs: any[] = [];

      // For each file: if it's a text-based format (PDF/DOCX/XLSX/TXT) — parse text on client
      // If it's an image — send as base64 (needed for vision analysis)
      for (const file of files) {
        if (file.type === "program" && useOwnProgram) continue;
        try {
          const rawFile = rawFiles.get(file.path);
          const mime = getMimeType(file.name);
          const isImage = mime.startsWith("image/");
          
          let fileData: any;
          
          if (isImage) {
            // Images: send as base64 for vision API
            const b64 = await fileToBase64(file);
            if (!b64) continue;
            fileData = b64;
          } else if (rawFile) {
            // Text-based docs: parse on client and send only text
            const parsed = await parseDocument(rawFile);
            const text = parsed.text?.slice(0, 60000) || "";
            const MIN_USEFUL_TEXT = 200;
            const isPdf = mime === "application/pdf";
            const isDoc = mime === "application/msword";
            
            if (text.length >= MIN_USEFUL_TEXT && !isDoc) {
              // Good client-side extraction — send text only
              fileData = { name: file.name, mimeType: mime, parsedText: text };
            } else if (isPdf || isDoc) {
              // Poor extraction or .doc — send as base64 for server-side vision extraction
              console.log(`Client parsing yielded ${text.length} chars for ${file.name}, falling back to base64`);
              const b64 = await fileToBase64(file);
              if (b64) {
                fileData = b64;
              } else if (text) {
                fileData = { name: file.name, mimeType: mime, parsedText: text };
              } else {
                continue;
              }
            } else if (text) {
              fileData = { name: file.name, mimeType: mime, parsedText: text };
            } else if (parsed.error) {
              fileData = { name: file.name, mimeType: mime, parsedText: parsed.error };
            } else {
              // No text at all — try base64 fallback
              const b64 = await fileToBase64(file);
              if (!b64) continue;
              fileData = b64;
            }
          } else {
            // Fallback: download from storage and send as base64
            const b64 = await fileToBase64(file);
            if (!b64) continue;
            fileData = b64;
          }

          if (file.type === "other") {
            otherDocs.push(fileData);
          } else if (file.type === "akc") {
            akcDocs.push(fileData);
          } else {
            documentFiles[file.type] = fileData;
          }
        } catch (fileErr) {
          console.error(`Error processing file ${file.name}:`, fileErr);
        }
      }

      if (otherDocs.length > 0) documentFiles["other"] = otherDocs;
      if (akcDocs.length > 0) documentFiles["akc"] = akcDocs;

      const calcData = {
        wellData, drillingFluid, slurries, buffers, displacementFluids, centralizationResults, useOwnProgram,
      };

      const requestBody = JSON.stringify({ documentFiles, calcData });
      const payloadSizeMB = (requestBody.length / 1024 / 1024).toFixed(1);
      console.log(`Отправка запроса анализа: ${payloadSizeMB} МБ`);

      if (requestBody.length > 5 * 1024 * 1024) {
        console.warn("Payload exceeds 5MB, may cause issues");
      }

      const { data: createdJob, error: createJobError } = await supabase
        .from("analysis_jobs")
        .insert({
          user_id: userId,
          status: "pending",
          document_names: files.map((file) => file.name),
        })
        .select("id")
        .single();

      if (createJobError || !createdJob) {
        throw new Error("Не удалось создать задачу анализа");
      }

      setActiveAnalysisJobId(createdJob.id);

      let invokeFailure: string | null = null;
      const invokePromise = supabase.functions.invoke("analyze-cement", {
        body: { jobId: createdJob.id, documentFiles, calcData },
      }).then(({ data: functionData, error: functionError }) => {
        if (functionError) {
          // Only treat as real failure if it's NOT a network/timeout error
          const msg = functionError.message || "";
          const isNetworkError = msg.includes("Failed to send") || msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("Load failed") || msg.includes("aborted") || msg.includes("timeout");
          if (!isNetworkError) {
            throw new Error(msg || "Ошибка сервера анализа");
          }
          console.warn("Edge function network/timeout error (will rely on polling):", msg);
          return null;
        }
        if (functionData?.error) {
          throw new Error(functionData.error);
        }
        return functionData;
      }).catch((invokeError: any) => {
        const msg = invokeError?.message || "Ошибка сервера анализа";
        const isNetworkError = msg.includes("Failed to send") || msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("Load failed") || msg.includes("aborted") || msg.includes("timeout");
        if (isNetworkError) {
          console.warn("Edge function network error ignored, relying on polling:", msg);
        } else {
          console.error("analyze-cement invoke error:", invokeError);
          invokeFailure = msg;
        }
        return null;
      });

      const analysisReport = await waitForAnalysisJob(createdJob.id, () => invokeFailure);
      await invokePromise;

      setReport(analysisReport);
      await loadCredits();

      if (reportRef.current) {
        window.setTimeout(() => reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
      }
    } catch (e: any) {
      const msg = e.message || "Ошибка анализа";
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("Load failed")) {
        setError("Ошибка сети при отправке данных. Возможно, файлы слишком большие. Попробуйте загрузить меньше файлов или файлы меньшего размера (до 5 МБ каждый).");
      } else {
        setError(msg);
      }
    } finally {
      setActiveAnalysisJobId(null);
      setAnalyzing(false);
    }
  }, [files, wellData, drillingFluid, slurries, buffers, displacementFluids, centralizationResults, useOwnProgram, canUseAiAnalysis, userId, loadCredits, waitForAnalysisJob]);

  const runLocalAnalysis = useCallback(async () => {
    setError("");
    setParsing(true);
    try {
      // Parse all uploaded raw files
      const filesToParse = Array.from(rawFiles.values());
      let docTexts: { name: string; text: string; error?: string; imageAnalysis?: any; ocrResult?: any }[] = [];
      
      if (filesToParse.length > 0) {
        const parsed = await Promise.all(filesToParse.map(f => parseDocument(f)));
        setParsedDocs(parsed);
        docTexts = parsed.map(p => ({ name: p.name, text: p.text, error: p.error, imageAnalysis: p.imageAnalysis, ocrResult: p.ocrResult }));
      }

      const result = runAlgorithmicAnalysis(
        wellData, drillingFluid, slurries, buffers, displacementFluids, centralizationResults, docTexts
      );
      setReport(result.markdown);
      if (reportRef.current) {
        setTimeout(() => reportRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
      }
    } catch (e: any) {
      setError("Ошибка алгоритмического анализа: " + (e.message || "Неизвестная ошибка"));
    } finally {
      setParsing(false);
    }
  }, [wellData, drillingFluid, slurries, buffers, displacementFluids, centralizationResults, rawFiles]);

  // ─── Program from ТЗ ─────────────────────────────────────────
  const handleTzUpload = useCallback(async (droppedFiles: File[]) => {
    if (!droppedFiles.length) return;
    
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setError("Войдите в аккаунт"); return; }
    if (!canUseAiAnalysis) {
      setError("Анализы исчерпаны. Обратитесь в Поддержку: https://t.me/deall_support");
      return;
    }

    // Append new files to existing
    setTzFiles(prev => [...prev, ...droppedFiles]);
    setTzFileNames(prev => [...prev, ...droppedFiles.map(f => f.name)]);
  }, [canUseAiAnalysis]);

  const removeTzFile = useCallback((index: number) => {
    setTzFiles(prev => prev.filter((_, i) => i !== index));
    setTzFileNames(prev => prev.filter((_, i) => i !== index));
  }, []);

  const runTzExtraction = useCallback(async () => {
    if (!tzFiles.length) return;
    if (!canUseAiAnalysis) {
      setError("Анализы исчерпаны. Обратитесь в Поддержку: https://t.me/deall_support");
      return;
    }

    setExtracting(true);
    setError("");

    try {
      // Parse all files and combine texts with balanced per-document limits
      const textDocs: Array<{ file: File; text: string; kind: ExtractionDocKind }> = [];
      const visionFiles: { base64: string; mimeType: string; name: string }[] = [];

      for (const file of tzFiles) {
        const parsed = await parseDocument(file);
        const rawText = normalizeExtractedText(parsed.text || "");
        const textLength = rawText.length;
        const letterCount = rawText.replace(/[^a-zA-Zа-яА-ЯёЁ0-9]/g, "").length;
        const hasGoodText = textLength > 200 && letterCount > 100;
        const kind = detectExtractionDocKind(file);

        if (textLength > 0) {
          textDocs.push({ file, text: rawText, kind });
        }

        // Для сканов и сложных PDF/изображений отправляем vision-версию,
        // но текст из остальных файлов тоже обязательно сохраняем в общем контексте.
        const mime = file.type.toLowerCase() || getMimeType(file.name);
        const isVisionCompatible = mime.startsWith("image/") || mime === "application/pdf";

        if (isVisionCompatible && !hasGoodText) {
          try {
            const ab = await file.arrayBuffer();
            const bytes = new Uint8Array(ab);
            if (bytes.byteLength < 10 * 1024 * 1024) {
              let binary = "";
              for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
              visionFiles.push({ base64: btoa(binary), mimeType: mime, name: file.name });
            }
          } catch (e) {
            console.warn("Failed to read file for vision:", file.name, e);
          }
        }
      }

      const combinedText = buildCombinedExtractionText(textDocs);

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-well-data`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ 
            file: visionFiles.length > 0 ? visionFiles[0] : null,
            files: visionFiles,
            parsedText: combinedText 
          }),
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Ошибка сервера" }));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      const result = await response.json();
      if (!result.success || !result.data) throw new Error("Не удалось распознать данные");

      setExtractedData(result.data as ExtractedData);
      setShowExtractionDialog(true);
    } catch (e: any) {
      setError("Ошибка распознавания: " + (e.message || "Неизвестная ошибка"));
    } finally {
      setExtracting(false);
    }
  }, [tzFiles, canUseAiAnalysis]);

  const handleProgramConfirm = useCallback(async (
    wd: WellData, df: DrillingFluid, sl: SlurryInput[], bf: BufferFluid[], disp: DisplacementFluid[]
  ) => {
    setShowExtractionDialog(false);

    try {
      // Deduct 1 analysis credit + add 3 followup questions using current DB values
      if (userId) {
        const { data: currentCredits } = await supabase
          .from("user_credits")
          .select("ai_analyses_used, free_followups_remaining")
          .eq("user_id", userId)
          .maybeSingle();
        
        if (currentCredits) {
          await supabase
            .from("user_credits")
            .update({
              ai_analyses_used: currentCredits.ai_analyses_used + 1,
              free_followups_remaining: currentCredits.free_followups_remaining + 3,
            })
            .eq("user_id", userId);
        }
        await loadCredits();
      }

      // Navigate to cementing program module with extracted data
      navigate("/cementing/program", {
        state: {
          fromAnalysis: true,
          wellData: wd,
          drillingFluid: df,
          slurries: sl,
          buffers: bf,
          displacementFluids: disp,
          sourceDocuments: tzFileNames,
        },
      });
    } catch (e: any) {
      setError("Ошибка: " + e.message);
    }
  }, [userId, aiCredits, loadCredits, navigate, tzFileNames]);

  const akcFiles = files.filter(f => f.type === "akc");
  const reportFiles = files.filter(f => f.type === "report");
  const otherFiles = files.filter(f => f.type === "other");
  const programFile = files.filter(f => f.type === "program");

  const hasAnyInput = files.length > 0 || (wellData.wellDepthMD > 0 && slurries.length > 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            🔬 Анализ качества цементирования
          </CardTitle>
           <p className="text-sm text-muted-foreground">
            Загрузите любые документы (программы, отчёты, геофизику, лабораторные протоколы) — система проанализирует качество цементирования. Поддерживаются PDF, Word, Excel, изображения.
           </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Upload areas — 2x2 grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DropZone
              label="📊 АКЦ / СГДТ / CBL-VDL"
              desc="Геофизика, графики, скриншоты, Word, PDF"
              existingFiles={akcFiles}
              onDrop={(dropped) => dropped.forEach(f => uploadFile(f, "akc"))}
              onRemove={removeFile}
              uploading={uploading}
              uploadingType={uploadingType}
              multi
              type="akc"
            />
            <DropZone
              label="📝 Отчёт по цементированию"
              desc="Фактические данные, рапорт"
              existingFiles={reportFiles}
              onDrop={(dropped) => dropped.forEach(f => uploadFile(f, "report"))}
              onRemove={removeFile}
              uploading={uploading}
              uploadingType={uploadingType}
              type="report"
            />
            <DropZone
              label="📋 Программа цементирования"
              desc="Загрузите программу цементирования"
              existingFiles={programFile}
              onDrop={(dropped) => dropped.forEach(f => uploadFile(f, "program"))}
              onRemove={removeFile}
              uploading={uploading}
              uploadingType={uploadingType}
              type="program"
            />
            <DropZone
              label="📁 Дополнительные материалы"
              desc="ГТИ, протоколы, лабораторные тесты и др."
              existingFiles={otherFiles}
              onDrop={(dropped) => dropped.forEach(f => uploadFile(f, "other"))}
              onRemove={removeFile}
              uploading={uploading}
              uploadingType={uploadingType}
              multi
              type="other"
            />
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

          {/* Credits info */}
          {userEmail && aiCredits && (
            <div className={`flex items-center gap-2 text-xs rounded-lg p-2.5 ${
              aiAnalysesRemaining > 0 ? 'bg-primary/5 text-primary' : 'bg-amber-500/10 text-amber-700'
            }`}>
              <Cpu className="w-3.5 h-3.5 shrink-0" />
              <span>
                <strong>Подробный анализ:</strong> осталось {aiAnalysesRemaining} из {aiCredits.limit}. К каждому анализу включено 3 вопроса в чате.
                {aiAnalysesRemaining === 0 && (
                  <> Для продолжения — обратитесь в <a href="https://t.me/deall_support" target="_blank" rel="noopener noreferrer" className="underline font-semibold hover:opacity-80">Поддержку</a>.</>
                )}
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Button
              onClick={isAlgorithmicAllowed ? runLocalAnalysis : undefined}
              disabled={!isAlgorithmicAllowed || parsing || (wellData.wellDepthMD <= 0 && rawFiles.size === 0)}
              variant="outline"
              size="lg"
              className={`w-full ${!isAlgorithmicAllowed ? 'opacity-60' : ''}`}
              title={!isAlgorithmicAllowed ? "Функция в разработке" : undefined}
            >
              {parsing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Читаю документы...
                </>
              ) : !isAlgorithmicAllowed ? (
                <>
                  <Cpu className="w-4 h-4" />
                  📐 Алгоритмический анализ (в разработке)
                </>
              ) : (
                <>
                  <Cpu className="w-4 h-4" />
                  📐 Алгоритмический анализ
                </>
              )}
            </Button>

            <Button
              onClick={canUseAiAnalysis ? runAnalysis : () => setError("Анализы исчерпаны. Для продолжения — обратитесь в Поддержку: https://t.me/deall_support")}
              disabled={analyzing || !hasAnyInput || !userEmail}
              variant={canUseAiAnalysis ? "default" : "outline"}
              size="lg"
              className={`w-full ${!canUseAiAnalysis ? 'opacity-60' : ''}`}
            >
              {analyzing ? (
                <>
              <Loader2 className="w-4 h-4 animate-spin" />
                  Анализируем...
                </>
              ) : (
              <>
                  <Cpu className="w-4 h-4" />
                  🚀 Подробный анализ {canUseAiAnalysis ? `(${aiAnalysesRemaining})` : '(лимит исчерпан)'}
                </>
              )}
            </Button>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg p-2">
            <Cpu className="w-3.5 h-3.5 shrink-0" />
            <span><strong>Алгоритмический анализ</strong> — мгновенный. <strong>Подробный анализ</strong> — глубокий, доступно {aiCredits?.limit ?? 6} анализов при регистрации, к каждому анализу включено по 3 вопроса в чате с подробным ответом. Для увеличения лимита — обратитесь в <a href="https://t.me/deall_support" target="_blank" rel="noopener noreferrer" className="underline font-semibold hover:opacity-80">Поддержку</a>.</span>
          </div>

          {analyzing && (
            <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground bg-muted/50 rounded-lg p-2.5 animate-pulse">
              <span>⏱ Прошло: <strong className="text-foreground">{formatTime(elapsedSeconds)}</strong></span>
              <span className="text-border">|</span>
              <span>Ожидаемое время: ~{estimatedMinutes} мин</span>
              {activeAnalysisJobId && (
                <>
                  <span className="text-border">|</span>
                  <span>Результат сохраняется автоматически</span>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Составление программы из ТЗ ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileInput className="w-5 h-5" />
            Составление программы цементирования
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Загрузите ТЗ, рапорт по буровым растворам, инклинометрию и другие документы — система распознает параметры и составит программу. Списывается 1 анализ + 3 вопроса.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Drop zone for adding files */}
          <div
            className={`border-2 border-dashed rounded-lg p-4 text-center space-y-2 transition-all cursor-pointer
              ${extracting ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/50"}`}
            onClick={() => {
              if (extracting) return;
              const input = document.createElement("input");
              input.type = "file";
              input.accept = ACCEPTED_EXTENSIONS;
              input.multiple = true;
              input.onchange = (e) => {
                const f = (e.target as HTMLInputElement).files;
                if (f?.length) handleTzUpload(Array.from(f));
              };
              input.click();
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const dropped = Array.from(e.dataTransfer.files);
              if (dropped.length) handleTzUpload(dropped);
            }}
          >
            <p className="text-sm font-medium">📄 Исходные данные / ТЗ</p>
            <p className="text-xs text-muted-foreground">ТЗ, рапорт по буровым растворам, таблица инклинометра, программа и др.</p>
            <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <Upload className="w-3.5 h-3.5" />
              <span>Перетащите или нажмите (можно несколько файлов)</span>
            </div>
          </div>

          {/* List of uploaded TZ files */}
          {tzFileNames.length > 0 && (
            <div className="space-y-1.5">
              {tzFileNames.map((name, i) => (
                <div key={i} className="flex items-center gap-2 text-sm bg-muted/50 rounded-md px-3 py-1.5">
                  <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="truncate flex-1">{name}</span>
                  <button
                    onClick={() => removeTzFile(i)}
                    className="text-destructive hover:text-destructive/80"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Extract & generate button */}
          {tzFileNames.length > 0 && (
            <Button
              onClick={runTzExtraction}
              disabled={extracting || !canUseAiAnalysis}
              className="w-full"
              size="lg"
            >
              {extracting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Распознаю данные из {tzFileNames.length} файл(ов)...
                </>
              ) : (
                <>
                  <Cpu className="w-4 h-4" />
                  🚀 Распознать данные и перейти к программе ({tzFileNames.length} файл(ов))
                </>
              )}
            </Button>
          )}

          {!canUseAiAnalysis && (
            <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-500/10 rounded-lg p-2.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              Анализы исчерпаны. Обратитесь в <a href="https://t.me/deall_support" target="_blank" rel="noopener noreferrer" className="underline font-semibold">Поддержку</a>.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Extraction Dialog */}
      {extractedData && (
        <WellDataExtractionDialog
          open={showExtractionDialog}
          onClose={() => setShowExtractionDialog(false)}
          extractedData={extractedData}
          onConfirm={handleProgramConfirm}
        />
      )}




      {/* Report */}
      {report && (
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  📄 Отчёт анализа качества цементирования
                </CardTitle>
                <p className="text-xs text-muted-foreground">DeAllsoft — виртуальный инженерный помощник</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportAnalysisToDocx(report)}
                className="gap-2 shrink-0"
              >
                <Download className="w-4 h-4" />
                Скачать Word
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div
              ref={reportRef}
              className="max-h-[700px] overflow-y-auto pr-2 space-y-0"
            >
              <ReportRenderer text={report} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Follow-up Q&A for analysis */}
      {report && (
        <FollowUpChat reportContext={report} />
      )}
    </div>
  );
}
