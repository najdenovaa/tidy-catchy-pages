"""Publish DB-IP Lite city and ASN records as compressed address-range shards."""
import argparse
import csv
from datetime import datetime, timedelta, timezone
import gzip
from ipaddress import ip_address
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile


ROWS_PER_SHARD = 16_000


def build_shards(source, directory, kind):
    indexes = {f"{kind}-4": [], f"{kind}-6": []}
    batch = []
    current = None
    previous = {}

    def write_batch():
        ranges = indexes[current]
        name = f"{current}-{len(ranges):04d}"
        with ZipFile(directory / f"{name}.zip", "w", ZIP_DEFLATED, compresslevel=5) as archive:
            archive.writestr("rows.json", json.dumps(batch, ensure_ascii=False, separators=(",", ":")))
        ranges.append([batch[0][0], batch[-1][1], name])
        batch.clear()

    with gzip.open(source, "rt", encoding="utf-8", newline="") as input_file:
        for start, end, *values in csv.reader(input_file):
            if kind == "city":
                _, country, region, city, *_ = values
                if country in ("", "ZZ") and not region and not city:
                    continue
                payload = [country, region, city]
            else:
                asn, organization, *_ = values
                if not asn.isdecimal() or int(asn) == 0:
                    continue
                payload = [int(asn), organization]

            first, last = ip_address(start), ip_address(end)
            begin, finish = int(first), int(last)
            if first.version != last.version or begin > finish:
                raise ValueError(f"Invalid {kind} address range")
            if begin <= previous.get(first.version, -1):
                raise ValueError(f"Overlapping or unsorted {kind} address ranges")
            previous[first.version] = finish
            family = f"{kind}-{first.version}"
            if batch and (family != current or len(batch) == ROWS_PER_SHARD):
                write_batch()
            current = family
            width = first.max_prefixlen // 4
            batch.append([f"{begin:0{width}x}", f"{finish:0{width}x}", *payload])
    if not batch:
        raise ValueError(f"Empty {kind} reference file")
    write_batch()
    return indexes


def download_sources(directory):
    month = datetime.now(timezone.utc).date().replace(day=1)
    for release in (month.strftime("%Y-%m"), (month - timedelta(days=1)).strftime("%Y-%m")):
        try:
            for kind in ("city", "asn"):
                subprocess.run([
                    "curl", "--fail", "--silent", "--show-error", "--location",
                    "--retry", "1", "--max-time", "75",
                    f"https://download.db-ip.com/free/dbip-{kind}-lite-{release}.csv.gz",
                    "--output", str(directory / f"{kind}.csv.gz"),
                ], check=True)
            return release
        except subprocess.CalledProcessError:
            pass
    raise RuntimeError("Could not download DB-IP Lite reference data")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--source-dir", type=Path, help="Build from local city.csv.gz and asn.csv.gz")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory() as temp:
        source_dir = args.source_dir or Path(temp)
        release = "local" if args.source_dir else download_sources(source_dir)
        shards = {}
        for kind in ("city", "asn"):
            shards.update(build_shards(source_dir / f"{kind}.csv.gz", args.output, kind))
        (args.output / "catalog.json").write_text(
            json.dumps({"release": release, "shards": shards}), encoding="utf-8",
        )
        print(f"Built {sum(map(len, shards.values()))} IP reference shards ({release})")


if __name__ == "__main__":
    main()
