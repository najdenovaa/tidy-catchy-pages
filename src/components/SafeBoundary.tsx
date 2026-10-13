import { Component, type ReactNode } from "react";

interface Props { children: ReactNode; onReset?: () => void; title?: string }
interface State { error: Error | null }

/** Ошибка в одном блоке не должна ронять всю страницу: показываем сообщение и кнопку сброса. */
export default class SafeBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error) { console.error("SafeBoundary:", error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="rounded-lg border border-amber-500/50 bg-amber-500/5 p-3 text-xs space-y-2">
        <p className="font-semibold">{this.props.title ?? "Блок не удалось отобразить"}</p>
        <p className="text-muted-foreground">Вероятно, сохранён результат прошлой версии расчёта. Нажмите «Расчёт» заново.</p>
        {this.props.onReset && (
          <button className="underline" onClick={() => { this.setState({ error: null }); this.props.onReset?.(); }}>Сбросить сохранённый результат</button>
        )}
      </div>
    );
  }
}
