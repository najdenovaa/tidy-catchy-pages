import { Link } from "react-router-dom";
import { BookOpen } from "lucide-react";

/** Ссылка на раздел «Справка» в шапке модулей */
export default function HelpLink({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      to="/help"
      className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs"
      title="Руководство пользователя"
    >
      <BookOpen className="w-4 h-4" />
      <span className={compact ? "hidden sm:inline" : ""}>Справка</span>
    </Link>
  );
}
