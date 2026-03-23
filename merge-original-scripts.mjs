/**
 * Merge Original JSON Scripts
 *
 * Reads every JSON file in `original-json/`, converts each entry into
 * the canonical text format, and writes a single `merged-original.txt`.
 *
 * JSON entries with a `name` field become two lines (speech):
 *
 *   ＃{name}
 *   「{message}」
 *
 * Entries without `name` become a single line (narration):
 *
 *   {message}
 *
 * File sections are separated by `--------------------` and each section
 * starts with the filename followed by `********************`.
 *
 * Usage:
 *   node merge-original-scripts.mjs
 */

import { glob } from "glob";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";

const INPUT_DIR = "original-json";
const OUTPUT_FILE = "merged-original.txt";

const SECTION_SEPARATOR = "--------------------";
const HEADER_SEPARATOR = "********************";

const MAX_CHUNK_LINES = 900;
const CHUNKS_DIR = "original-merged-chunks";

async function main() {
  // Step 1: Discover all JSON files in the input directory.
  const files = (await glob(`${INPUT_DIR}/*.json`)).sort();

  if (files.length === 0) {
    console.error(`No JSON files found in ${INPUT_DIR}/`);
    process.exit(1);
  }

  const sections = [];

  for (const filePath of files) {
    // Step 2: Read and parse each JSON file.
    const fileName = path.basename(filePath, ".json");
    const raw = await readFile(filePath, "utf-8");
    const entries = JSON.parse(raw);

    // Step 3: Convert each JSON entry to text lines.
    // Dialogue entries (with `name`) become ＃{name} + 「{message}」.
    // Narration entries (no `name`) become a plain {message} line.
    const lines = [];
    for (const entry of entries) {
      if (entry.name) {
        lines.push(`＃${entry.name}`);
        lines.push(`「${entry.message}」`);
      } else {
        lines.push(entry.message);
      }
    }

    // Step 4: Build the section with a filename header.
    sections.push(`${fileName}\n${HEADER_SEPARATOR}\n${lines.join("\n")}`);
  }

  // Step 5: Prepend each section with a separator and write to disk.
  const output = sections.map((s) => `${SECTION_SEPARATOR}\n${s}`).join("\n");
  await writeFile(OUTPUT_FILE, output + "\n", "utf-8");

  console.log(`${files.length} files merged into ${OUTPUT_FILE}`);

  // Step 6: Split sections into line-limited chunks.
  await rm(CHUNKS_DIR, { recursive: true, force: true });
  await mkdir(CHUNKS_DIR, { recursive: true });

  const chunks = [];
  let currentChunk = [];
  let currentLineCount = 0;

  for (const section of sections) {
    const sectionText = `${SECTION_SEPARATOR}\n${section}`;
    const sectionLineCount = sectionText.split("\n").length;

    // If adding this section exceeds the limit and we already have content,
    // flush the current chunk first.
    if (currentLineCount + sectionLineCount > MAX_CHUNK_LINES && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentLineCount = 0;
    }

    currentChunk.push(sectionText);
    currentLineCount += sectionLineCount;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunkNum = String(i + 1).padStart(3, "0");
    const chunkPath = path.join(CHUNKS_DIR, `part-${chunkNum}.txt`);
    await writeFile(chunkPath, chunks[i].join("\n") + "\n", "utf-8");
  }

  console.log(`${chunks.length} chunks written to ${CHUNKS_DIR}/`);
}

main().catch(console.error);
