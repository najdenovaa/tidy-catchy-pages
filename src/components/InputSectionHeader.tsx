import {ChevronRight,ChevronDown} from "lucide-react";
export default function SectionHeader({ title, isOpen, onClick }: { title: string; isOpen: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-expanded={isOpen} onClick={onClick} className="w-full flex items-center gap-2 py-3 px-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
      {isOpen ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />}
      <span className="font-medium text-sm text-foreground text-left">{title}</span>
    </button>
  );
}

