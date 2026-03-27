import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Sparkles, ShoppingCart, Clock, CheckCircle, XCircle, Loader2, Wallet } from "lucide-react";

interface Payment {
  id: string;
  amount: number;
  credits_purchased: number;
  status: string;
  created_at: string;
  completed_at: string | null;
}

interface CreditsSectionProps {
  used: number;
  limit: number;
  payments: Payment[];
  onBuy: (quantity: number) => void;
  buying: boolean;
}

const PRICE_PER_ANALYSIS = 399;

const PACKAGES = [
  { qty: 1, label: "1 анализ", price: 399 },
  { qty: 5, label: "5 анализов", price: 1995 },
  { qty: 10, label: "10 анализов", price: 3990 },
];

export default function CreditsSection({ used, limit, payments, onBuy, buying }: CreditsSectionProps) {
  const remaining = Math.max(0, limit - used);
  const progress = limit > 0 ? (used / limit) * 100 : 0;

  const statusBadge = (status: string) => {
    if (status === "completed") return <Badge variant="default" className="text-[10px] bg-green-600"><CheckCircle className="w-3 h-3 mr-0.5" /> Оплачен</Badge>;
    if (status === "pending") return <Badge variant="secondary" className="text-[10px]"><Clock className="w-3 h-3 mr-0.5" /> Ожидание</Badge>;
    return <Badge variant="destructive" className="text-[10px]"><XCircle className="w-3 h-3 mr-0.5" /> Отменён</Badge>;
  };

  const formatDate = (iso: string) => new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Balance card */}
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

          {remaining === 0 && (
            <p className="text-xs text-muted-foreground text-center">
              Анализы закончились. Приобретите дополнительные или{" "}
              <a href="https://t.me/your_support" target="_blank" rel="noopener noreferrer" className="text-primary underline">обратитесь в Поддержку</a>.
            </p>
          )}

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Купить анализы ({PRICE_PER_ANALYSIS}₽ / шт.)</p>
            <div className="grid grid-cols-3 gap-2">
              {PACKAGES.map(pkg => (
                <Button
                  key={pkg.qty}
                  variant="outline"
                  size="sm"
                  className="flex flex-col h-auto py-2 text-xs"
                  disabled={buying}
                  onClick={() => onBuy(pkg.qty)}
                >
                  {buying ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShoppingCart className="w-3 h-3" />}
                  <span className="font-medium">{pkg.label}</span>
                  <span className="text-muted-foreground">{pkg.price.toLocaleString("ru-RU")}₽</span>
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payment history */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-muted-foreground" />
            История покупок
          </CardTitle>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">Покупок пока нет</p>
          ) : (
            <div className="space-y-1.5 max-h-52 overflow-y-auto">
              {payments.map(p => (
                <div key={p.id} className="flex items-center justify-between px-2 py-1.5 rounded text-xs hover:bg-muted">
                  <div>
                    <p className="font-medium">{p.credits_purchased} анализ{p.credits_purchased > 1 ? (p.credits_purchased < 5 ? "а" : "ов") : ""} — {Number(p.amount).toLocaleString("ru-RU")}₽</p>
                    <p className="text-[10px] text-muted-foreground">{formatDate(p.created_at)}</p>
                  </div>
                  {statusBadge(p.status)}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
