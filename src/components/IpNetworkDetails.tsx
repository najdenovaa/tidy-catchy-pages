import { useEffect, useRef, useState } from "react";
import { ipDirectoryKey, lookupIpNetwork } from "@/lib/ip-directory";

export function IpDirectoryCredit() {
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      Геолокация приблизительная. Данные сетей и геолокации{" "}
      <a href="https://db-ip.com/" target="_blank" rel="noopener noreferrer" className="underline">DB-IP</a>.
    </p>
  );
}

export default function IpNetworkDetails({ address, fallbackLocation }: {
  address: string | null;
  fallbackLocation?: string | null;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [details, setDetails] = useState<Awaited<ReturnType<typeof lookupIpNetwork>>>(null);
  const displayAddress = address && ipDirectoryKey(address) ? address : null;

  useEffect(() => {
    setDetails(null);
    if (!displayAddress || !element.current) return;
    let active = true;
    const load = () => {
      void lookupIpNetwork(displayAddress).then(result => {
        if (active) setDetails(result);
      }).catch(() => undefined);
    };
    if (typeof IntersectionObserver !== "function") {
      load();
      return () => { active = false; };
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      load();
    });
    observer.observe(element.current);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [displayAddress]);

  return (
    <div ref={element} className="min-w-32 space-y-0.5 break-words text-xs leading-snug">
      <div className="font-mono [overflow-wrap:anywhere]">{displayAddress ?? "—"}</div>
      {(details?.location || fallbackLocation) && (
        <div className="text-muted-foreground">{details?.location || fallbackLocation}</div>
      )}
      {details?.asn && (
        <div>Сеть: {details.organization ? `${details.organization} · AS${details.asn}` : `AS${details.asn}`}</div>
      )}
    </div>
  );
}
