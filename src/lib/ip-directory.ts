type CityRow = [start: string, end: string, country: string, region: string, city: string];
type AsnRow = [start: string, end: string, asn: number, organization: string];
type ShardRange = [start: string, end: string, name: string];
type Catalog = { shards: Record<string, ShardRange[]> };

const directory = "/ip-directory";
const shards = new Map<string, Promise<(CityRow | AsnRow)[]>>();
let catalog: Promise<Catalog> | undefined;
const countries = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames("ru", { type: "region" }) : null;

function ipv4Hex(address: string): string | null {
  const octets = address.split(".");
  if (octets.length !== 4 || octets.some(value => !/^\d{1,3}$/.test(value) || Number(value) > 255)) {
    return null;
  }
  return octets.map(value => Number(value).toString(16).padStart(2, "0")).join("");
}

export function ipDirectoryKey(input: string): { version: 4 | 6; hex: string } | null {
  let address = input.trim().toLowerCase().split("/")[0];
  if (!address.includes(":")) {
    const hex = ipv4Hex(address);
    return hex ? { version: 4, hex } : null;
  }

  if (address.includes(".")) {
    const last = address.lastIndexOf(":");
    const tail = ipv4Hex(address.slice(last + 1));
    if (!tail) return null;
    address = `${address.slice(0, last + 1)}${tail.slice(0, 4)}:${tail.slice(4)}`;
  }

  const halves = address.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const omitted = 8 - left.length - right.length;
  if ((halves.length === 2 ? omitted < 1 : omitted !== 0) ||
      [...left, ...right].some(part => !/^[0-9a-f]{1,4}$/.test(part))) {
    return null;
  }
  const hex = [...left, ...Array<string>(omitted).fill("0"), ...right]
    .map(part => part.padStart(4, "0")).join("");
  return hex.startsWith("00000000000000000000ffff")
    ? { version: 4, hex: hex.slice(24) }
    : { version: 6, hex };
}

function fetchCatalog() {
  catalog ??= fetch(`${directory}/catalog.json`, { cache: "no-cache" }).then(async response => {
    if (!response.ok) throw new Error("IP directory unavailable");
    return await response.json() as Catalog;
  }).catch((error: unknown) => {
    catalog = undefined;
    throw error;
  });
  return catalog;
}

async function loadShard<Row extends CityRow | AsnRow>(shard: string): Promise<Row[]> {
  let pending = shards.get(shard);
  if (!pending) {
    pending = Promise.all([fetch(`${directory}/${shard}.zip`, { cache: "no-cache" }), import("jszip")])
      .then(async ([response, { default: JSZip }]) => {
        if (!response.ok) throw new Error("IP directory shard unavailable");
        const archive = await JSZip.loadAsync(await response.arrayBuffer());
        const data = await archive.file("rows.json")?.async("string");
        if (!data) throw new Error("Empty IP directory shard");
        return JSON.parse(data) as (CityRow | AsnRow)[];
      }).catch((error: unknown) => {
        shards.delete(shard);
        throw error;
      });
    shards.set(shard, pending);
  }
  return await pending as Row[];
}

function findAddress<Row extends CityRow | AsnRow | ShardRange>(rows: Row[], hex: string): Row | undefined {
  let low = 0;
  let high = rows.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const row = rows[mid];
    if (hex < row[0]) high = mid - 1;
    else if (hex > row[1]) low = mid + 1;
    else return row;
  }
}

export async function lookupIpNetwork(address: string) {
  const key = ipDirectoryKey(address);
  if (!key) return null;
  const { shards: indexes } = await fetchCatalog();
  const cityShard = findAddress(indexes[`city-${key.version}`] ?? [], key.hex)?.[2];
  const asnShard = findAddress(indexes[`asn-${key.version}`] ?? [], key.hex)?.[2];
  const [cities, networks] = await Promise.all([
    cityShard ? loadShard<CityRow>(cityShard) : [],
    asnShard ? loadShard<AsnRow>(asnShard) : [],
  ]);

  const city = findAddress(cities, key.hex);
  const network = findAddress(networks, key.hex);
  const country = city?.[2];
  return {
    location: [...new Set([country && country !== "ZZ" ? countries?.of(country) ?? country : "", city?.[3], city?.[4]].filter(Boolean))].join(" · "),
    organization: network?.[3] ?? "",
    asn: network?.[2],
  };
}
