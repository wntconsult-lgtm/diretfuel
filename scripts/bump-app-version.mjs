import { readFileSync, writeFileSync } from "node:fs";
const file = new URL("../lib/directfuel-version.ts", import.meta.url);
const source = readFileSync(file, "utf8");
const match = source.match(/APP_VERSION = "(\d+)"/);
if (!match) throw new Error("APP_VERSION must be numeric before building a release.");
const version = String(Number(match[1]) + 1);
writeFileSync(file, source.replace(/APP_VERSION = "\d+"/, `APP_VERSION = "${version}"`));
console.log(`Building DirectFuel release ${version}`);
