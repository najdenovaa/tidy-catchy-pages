import { useRef, useState } from "react";
import { ArrowLeftRight, Copy, Download, FileUp, Send, X } from "lucide-react";
import type { CementingSnapshot } from "@/lib/cementing-normalizers";
import { exportCementingToMobileText, importMobileCementingText, MOBILE_EXCHANGE_WARNING, MAX_EXCHANGE_LENGTH } from "@/lib/cementing-mobile-exchange";

interface Props {
  snapshot: CementingSnapshot;
  onImport: (snapshot: CementingSnapshot) => void;
}

export default function CementingMobileExchange({ snapshot, onImport }: Props) {
  const [open, setOpen] = useState(false);
  const [incoming, setIncoming] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const outgoing = exportCementingToMobileText(snapshot);

  const send = async () => {
    setFeedback("");
    try {
      if (navigator.share) {
        await navigator.share({ title: "DeAllsoft - цементирование ОК", text: outgoing });
      } else {
        await navigator.clipboard.writeText(outgoing);
        setFeedback("Расчёт скопирован. Вставьте его в сообщение.");
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError("Не удалось открыть отправку. Нажмите «Скопировать».");
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(outgoing);
      setFeedback("Расчёт скопирован. Отправьте текст через Telegram, MAX или почту.");
      setError("");
    } catch {
      setError("Браузер не разрешил копирование. Используйте скачивание TXT.");
    }
  };

  const download = () => {
    const blob = new Blob([outgoing], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "deallsoft-cementing-mobile.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const readFile = async (file?: File) => {
    if (!file) return;
    if (file.size > MAX_EXCHANGE_LENGTH) {
      setError("Файл слишком большой для текстового обмена.");
      return;
    }
    setIncoming(await file.text());
    setError("");
  };

  const apply = () => {
    try {
      const parsed = importMobileCementingText(incoming, snapshot);
      if (!window.confirm("Заменить текущие данные цементирования параметрами из сообщения? Несовместимые расширенные настройки будут очищены. Перед продолжением проверьте результат расчёта.")) return;
      onImport(parsed);
      setFeedback("Данные из мобильного расчёта загружены. Проверьте параметры и нажмите «РАСЧЁТ».");
      setError("");
      setIncoming("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось прочитать сообщение.");
    }
  };

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setError(""); setFeedback(""); }}
        className="px-2 sm:px-3 py-2 sm:py-2.5 rounded-lg border border-border text-muted-foreground font-semibold text-[10px] sm:text-sm hover:text-primary hover:border-primary/40 transition-colors shadow-sm flex items-center gap-1"
        aria-label="Обмен расчётом с мобильным приложением">
        <ArrowLeftRight className="w-3.5 h-3.5" /><span>Обмен</span>
      </button>
      {open && <div role="dialog" aria-modal="true" aria-labelledby="exchange-heading" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-3" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
        <div className="w-full max-w-xl max-h-[90vh] overflow-auto rounded-xl bg-background border border-border shadow-2xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 id="exchange-heading" className="text-lg font-semibold">Обмен расчётами с телефоном</h2>
            <button type="button" aria-label="Закрыть" onClick={() => setOpen(false)}><X className="w-5 h-5" /></button>
          </div>
          <p className="text-sm text-muted-foreground">Не нужен интернет внутри мобильного приложения. Отправьте текст через мессенджер: получатель вставит его в «Цементирование ОК» через кнопку-конверт.</p>
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Из веба в мобильное приложение</h3>
            <div className="flex flex-wrap gap-2">
              <button className="rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm flex gap-2 items-center" onClick={send}><Send className="w-4 h-4" /> Отправить</button>
              <button className="rounded-md border px-3 py-2 text-sm flex gap-2 items-center" onClick={copy}><Copy className="w-4 h-4" /> Скопировать</button>
              <button className="rounded-md border px-3 py-2 text-sm flex gap-2 items-center" onClick={download}><Download className="w-4 h-4" /> Скачать TXT</button>
            </div>
          </section>
          <section className="space-y-2 border-t pt-3">
            <h3 className="text-sm font-semibold">Из мобильного приложения в веб</h3>
            <p className="text-xs text-muted-foreground">В мобильном приложении: конверт → «Отправить текст» или «Экспорт TXT». Вставьте полученное сообщение ниже или выберите файл.</p>
            <textarea aria-label="Текст расчёта из мобильного приложения" className="w-full min-h-32 rounded-md border bg-background p-3 text-sm" placeholder="Вставьте сообщение, содержащее [module]: cementing..." value={incoming} onChange={e => setIncoming(e.target.value)} maxLength={MAX_EXCHANGE_LENGTH} />
            <input ref={fileRef} type="file" accept=".txt,text/plain" className="hidden" onChange={e => { void readFile(e.target.files?.[0]); e.target.value = ""; }}/>
            <div className="flex flex-wrap gap-2">
              <button className="rounded-md border px-3 py-2 text-sm flex gap-2 items-center" onClick={()=>fileRef.current?.click()}><FileUp className="w-4 h-4" /> Открыть TXT</button>
              <button className="rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm disabled:opacity-50" disabled={!incoming.trim()} onClick={apply}>Загрузить параметры</button>
            </div>
          </section>
          <p className="text-xs text-amber-600 dark:text-amber-400">{MOBILE_EXCHANGE_WARNING}</p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {feedback && <p role="status" className="text-sm text-primary">{feedback}</p>}
        </div>
      </div>}
    </>
  );
}
