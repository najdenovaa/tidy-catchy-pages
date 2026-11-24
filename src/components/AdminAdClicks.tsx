import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { AD_BANNERS, type AdBanner } from "@/lib/ad-banner-clicks";

const PAGE_SIZE = 50;
const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: "Asia/Yekaterinburg",
});
const numberFormat = new Intl.NumberFormat("ru-RU");

type Click = Tables<"ad_banner_clicks">;

export default function AdminAdClicks() {
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [clicks, setClicks] = useState<Click[]>([]);
  const [totals, setTotals] = useState<{ all: number; iceberg: number; sts: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    const start = page * PAGE_SIZE;
    const countBanner = (banner: AdBanner) =>
      supabase.from("ad_banner_clicks")
        .select("id", { count: "exact", head: true })
        .eq("banner", banner)
        .abortSignal(signal);

    async function load() {
      setLoading(true);
      setError(false);
      const [journal, iceberg, sts] = await Promise.all([
        supabase.from("ad_banner_clicks")
          .select("id,banner,clicked_at,ip_address", { count: "exact" })
          .order("clicked_at", { ascending: false })
          .order("id", { ascending: false })
          .range(start, start + PAGE_SIZE - 1)
          .abortSignal(signal),
        countBanner("iceberg"),
        countBanner("sts"),
      ]);

      if (signal.aborted) return;
      if (journal.error || iceberg.error || sts.error) {
        setError(true);
      } else {
        setClicks(journal.data);
        setTotals({ all: journal.count ?? 0, iceberg: iceberg.count ?? 0, sts: sts.count ?? 0 });
      }
      setLoading(false);
    }

    void load();
    return () => controller.abort();
  }, [page, revision]);

  const counters = [
    { label: "Всего кликов", count: totals?.all },
    { label: AD_BANNERS.iceberg, count: totals?.iceberg },
    { label: AD_BANNERS.sts, count: totals?.sts },
  ];
  const pages = Math.ceil((totals?.all ?? 0) / PAGE_SIZE);

  function refresh() {
    setPage(0);
    setRevision(value => value + 1);
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {counters.map(({ label, count }) => (
          <Card key={label}>
            <CardHeader className="px-4 pb-1 pt-3">
              <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3 text-2xl font-bold tabular-nums">
              {count === undefined || error ? "—" : numberFormat.format(count)}
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 px-4 py-3">
          <CardTitle className="text-base">Журнал кликов</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw className="mr-1 h-4 w-4" /> Обновить
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table aria-busy={loading}>
            <TableHeader>
              <TableRow>
                <TableHead>Дата и время (ЕКБ)</TableHead>
                <TableHead>Баннер</TableHead>
                <TableHead>IP-адрес</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={3}>Загрузка…</TableCell></TableRow>
              ) : error ? (
                <TableRow><TableCell colSpan={3} role="alert">Не удалось загрузить журнал кликов.</TableCell></TableRow>
              ) : clicks.length === 0 ? (
                <TableRow><TableCell colSpan={3}>Кликов пока нет.</TableCell></TableRow>
              ) : clicks.map(click => (
                <TableRow key={click.id}>
                  <TableCell className="whitespace-nowrap">{dateFormat.format(new Date(click.clicked_at))}</TableCell>
                  <TableCell>{AD_BANNERS[click.banner as AdBanner]}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs">{click.ip_address ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {pages > 1 && !error && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
              <Button type="button" variant="outline" size="sm" disabled={loading || page === 0}
                onClick={() => setPage(current => current - 1)}>Назад</Button>
              <span className="text-sm text-muted-foreground">Страница {page + 1} из {pages}</span>
              <Button type="button" variant="outline" size="sm" disabled={loading || page + 1 >= pages}
                onClick={() => setPage(current => current + 1)}>Далее</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
