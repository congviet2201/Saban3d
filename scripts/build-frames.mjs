/**
 * Converts the raw 4K PNG render sequence into web-optimized WebP frames.
 *
 * Output (2 quality tiers, frame index 001..120):
 *   public/frames/lq/NNN.webp  ->  960x540,  used for instant first paint + fast drag
 *   public/frames/hq/NNN.webp  -> 2560x1440, streamed around the current viewpoint
 *
 * Usage:  node scripts/build-frames.mjs [sourceDir]
 */
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = path.resolve(process.argv[2] ?? path.join(ROOT, "public/261002_SEQUENCE/261002_SEQUENCE"));
const OUT_DIR = path.join(ROOT, "public/frames");
const BACKGROUND = "#021712"; // same as the canvas clear colour -> flattening is visually lossless

const TIERS = [
  { name: "lq", width: 960, height: 540, quality: 62 },
  { name: "hq", width: 2560, height: 1440, quality: 80 },
];

sharp.concurrency(1);
const PARALLEL = Math.max(1, Math.min(4, os.cpus().length - 1));

async function main() {
  const files = (await fs.readdir(SOURCE_DIR))
    .filter((f) => /\.png$/i.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (files.length === 0) throw new Error(`No PNG found in ${SOURCE_DIR}`);
  console.log(`Found ${files.length} frames in ${SOURCE_DIR}`);

  for (const t of TIERS) await fs.mkdir(path.join(OUT_DIR, t.name), { recursive: true });

  const totals = Object.fromEntries(TIERS.map((t) => [t.name, 0]));
  let next = 0;
  let done = 0;

  async function worker() {
    while (next < files.length) {
      const index = next++;
      const src = path.join(SOURCE_DIR, files[index]);
      const outName = `${String(index + 1).padStart(3, "0")}.webp`;

      // Decode the 4K PNG once, then derive every tier from the flattened raster.
      const base = sharp(src, { limitInputPixels: false }).flatten({ background: BACKGROUND });
      const buffer = await base.raw().toBuffer({ resolveWithObject: true });

      for (const t of TIERS) {
        const out = path.join(OUT_DIR, t.name, outName);
        const info = await sharp(buffer.data, { raw: buffer.info })
          .resize(t.width, t.height, { fit: "cover", kernel: "lanczos3" })
          .webp({ quality: t.quality, effort: 5, smartSubsample: true })
          .toFile(out);
        totals[t.name] += info.size;
      }

      done++;
      process.stdout.write(`\r  ${done}/${files.length}  ${files[index]} -> ${outName}   `);
    }
  }

  await Promise.all(Array.from({ length: PARALLEL }, worker));

  console.log("\nDone.");
  for (const t of TIERS) {
    console.log(`  ${t.name}: ${(totals[t.name] / 1024 / 1024).toFixed(1)} MB total, avg ${(totals[t.name] / files.length / 1024).toFixed(0)} KB/frame`);
  }

  await fs.writeFile(
    path.join(OUT_DIR, "manifest.json"),
    JSON.stringify({ totalFrames: files.length, tiers: TIERS, generatedAt: new Date().toISOString() }, null, 2)
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
