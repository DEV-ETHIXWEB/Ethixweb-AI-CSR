/**
 * Builds the offline street index the address check uses.
 *
 * Source: US Census TIGER/Line "EDGES" files (public domain, free). One
 * .dbf per county. Output: a compact JSON of normalized street names per
 * ZIP, written to src/modules/conversation/domain/data/wa-street-index.json.
 * The runtime check reads that file only; nothing here runs on a call and
 * no network is needed at call time.
 *
 * Usage:
 *   curl -O https://www2.census.gov/geo/tiger/TIGER2023/EDGES/tl_2023_53033_edges.zip
 *   unzip tl_2023_53033_edges.zip '*.dbf'
 *   pnpm exec ts-node -T scripts/build-street-index.ts <edges.dbf> [<edges.dbf> ...]
 *
 * Add a county's .dbf to cover more ground; re-run to regenerate.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { streetCoreName } from "../src/modules/conversation/domain/street-name";

/** Road classes worth matching: primary, secondary, local, service drive, private road. */
const ROAD_CLASSES = new Set(["S1100", "S1200", "S1400", "S1640", "S1740"]);
const WANTED_FIELDS = new Set(["FULLNAME", "ZIPL", "ZIPR", "MTFCC"]);

interface DbfField {
  name: string;
  length: number;
  offset: number;
}

function readDbf(path: string, onRecord: (record: Record<string, string>) => void): number {
  const buffer = readFileSync(path);
  const recordCount = buffer.readUInt32LE(4);
  const headerLength = buffer.readUInt16LE(8);
  const recordLength = buffer.readUInt16LE(10);
  const fields: DbfField[] = [];
  let offset = 1;
  for (let position = 32; buffer[position] !== 0x0d; position += 32) {
    const name = buffer
      .subarray(position, position + 11)
      .toString("latin1")
      .replace(/\0.*$/, "");
    const length = buffer[position + 16] ?? 0;
    fields.push({ name, length, offset });
    offset += length;
  }
  for (let index = 0; index < recordCount; index += 1) {
    const start = headerLength + index * recordLength;
    if (buffer[start] === 0x2a) {
      continue;
    }
    const record: Record<string, string> = {};
    for (const field of fields) {
      if (WANTED_FIELDS.has(field.name)) {
        record[field.name] = buffer
          .subarray(start + field.offset, start + field.offset + field.length)
          .toString("latin1")
          .trim();
      }
    }
    onRecord(record);
  }
  return recordCount;
}

function main(): void {
  const inputs = process.argv.slice(2);
  if (inputs.length === 0) {
    console.error("usage: build-street-index.ts <edges.dbf> [<edges.dbf> ...]");
    process.exit(1);
  }
  const byZip = new Map<string, Set<string>>();
  for (const path of inputs) {
    const total = readDbf(path, (record) => {
      const fullName = record["FULLNAME"] ?? "";
      if (!fullName || !ROAD_CLASSES.has(record["MTFCC"] ?? "")) {
        return;
      }
      const core = streetCoreName(fullName);
      if (!core) {
        return;
      }
      for (const zip of [record["ZIPL"], record["ZIPR"]]) {
        if (zip && /^\d{5}$/.test(zip)) {
          const names = byZip.get(zip) ?? new Set<string>();
          names.add(core);
          byZip.set(zip, names);
        }
      }
    });
    console.log(`${path}: ${total} edges read`);
  }
  const zips: Record<string, string[]> = {};
  for (const zip of Array.from(byZip.keys()).sort()) {
    zips[zip] = Array.from(byZip.get(zip) ?? []).sort();
  }
  const output = {
    source: "US Census TIGER/Line 2023 EDGES (public domain)",
    generatedAt: new Date().toISOString().slice(0, 10),
    zips,
  };
  const target = join(__dirname, "../src/modules/conversation/domain/data/wa-street-index.json");
  writeFileSync(target, JSON.stringify(output));
  const pairs = Object.values(zips).reduce((sum, names) => sum + names.length, 0);
  console.log(`wrote ${target}: ${Object.keys(zips).length} ZIPs, ${pairs} street-in-ZIP entries`);
}

main();
