import { Link } from "react-router-dom";

export default function TermsFooter() {
  return (
    <div className="w-full border-t border-border/50 bg-card/50 py-2">
      <div className="max-w-5xl mx-auto px-4 flex items-center justify-center gap-4">
        <Link to="/terms" className="text-[10px] text-muted-foreground/60 hover:text-primary transition-colors">
          Пользовательское соглашение и Политика конфиденциальности
        </Link>
        <span className="text-[10px] text-muted-foreground/30">|</span>
        <span className="text-[10px] text-muted-foreground/40">
          Результаты носят информационный характер
        </span>
      </div>
    </div>
  );
}
