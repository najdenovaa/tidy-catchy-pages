import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Sparkles, MessageSquare } from "lucide-react";

interface CreditsSectionProps {
  used: number;
  limit: number;
  freeFollowups: number;
}

export default function CreditsSection({ used, limit, freeFollowups }: CreditsSectionProps) {
  const remaining = Math.max(0, limit - used);
  const progress = limit > 0 ? (used / limit) * 100 : 0;

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-primary" />
          Подробный анализ — баланс
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">Использовано</span>
            <span className="font-medium">{used} / {limit}</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        <div className="text-center py-2">
          <p className="text-3xl font-bold text-foreground">{remaining}</p>
          <p className="text-xs text-muted-foreground">доступно анализов</p>
        </div>

        {/* Follow-up questions */}
        <div className="border-t pt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <MessageSquare className="w-3 h-3" /> Уточняющие вопросы
            </span>
            <span className="text-lg font-bold text-foreground">{freeFollowups}</span>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Включённые текстовые вопросы по отчётам. Вопрос с вложением расходует 1 анализ.
          </p>
        </div>

        {remaining === 0 && (
          <p className="text-xs text-muted-foreground text-center">
            Анализы закончились. Для продолжения — обратитесь в{" "}
            <a href="https://t.me/deall_support" target="_blank" rel="noopener noreferrer" className="text-primary underline font-semibold">Поддержку</a>.
          </p>
        )}

        {freeFollowups === 0 && remaining > 0 && (
          <p className="text-xs text-muted-foreground text-center">
            Вопросы закончились. Для продолжения — обратитесь в{" "}
            <a href="https://t.me/deall_support" target="_blank" rel="noopener noreferrer" className="text-primary underline font-semibold">Поддержку</a>.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
