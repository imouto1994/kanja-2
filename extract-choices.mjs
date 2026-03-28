/**
 * Extract Choice Groups with Translations
 *
 * Parses all game scripts to extract player choice groups, then maps
 * each choice to its translation using the line-aligned original/translated
 * merged chunks.
 *
 * Detection pattern:
 *   - Choice item: `#1-PUSH_INT32 [N]` → `#1-CHOICE` → `#1-STR_PRIMARY ["text"]`
 *   - Index 0 starts a new group; subsequent indices continue the group.
 *
 * Output: `choices-with-translations.txt`
 *
 * Usage:
 *   node extract-choices.mjs
 */

import Encoding from "encoding-japanese";
import { readFile, writeFile } from "fs/promises";
import { glob } from "glob";
import path from "path";

const GAME_SCRIPT_DIR = "game-script";
const ORIGINAL_CHUNKS_DIR = "original-merged-chunks";
const TRANSLATED_CHUNKS_DIR = "translated-merged-chunks";
const OUTPUT_FILE = "choices-with-translations.txt";

const SECTION_SEPARATOR = "--------------------";
const HEADER_SEPARATOR = "********************";

/**
 * Read and concatenate all chunk files from a directory.
 */
async function readChunks(dir) {
  const files = (await glob(`${dir}/part-*.txt`)).sort();
  const parts = await Promise.all(files.map((f) => readFile(f, "utf-8")));
  return parts.join("\n");
}

/**
 * Parse a merged text file into a Map of { fileName → lines[] }.
 * Preserves all lines (including empty) so indices stay aligned.
 */
function parseSections(text) {
  const raw = text.split(`${SECTION_SEPARATOR}\n`);
  const sections = new Map();
  for (const block of raw) {
    const headerEnd = block.indexOf(`\n${HEADER_SEPARATOR}\n`);
    if (headerEnd === -1) continue;
    const fileName = block.slice(0, headerEnd).trim();
    const body = block.slice(headerEnd + HEADER_SEPARATOR.length + 2);
    sections.set(fileName, body.split("\n"));
  }
  return sections;
}

/**
 * Read a Shift-JIS encoded game script and return UTF-8 text.
 */
async function readGameScript(filePath) {
  const buffer = await readFile(filePath);
  const unicodeArray = Encoding.convert(buffer, {
    to: "UNICODE",
    from: "SJIS",
  });
  return Encoding.codeToString(unicodeArray);
}

/**
 * Extract choice groups from a decoded game script.
 *
 * Each choice follows the pattern:
 *   #1-PUSH_INT32 / [N] / #1-CHOICE / [label] / #1-STR_PRIMARY / ["text"]
 *
 * A PUSH_INT32 value of 0 before #1-CHOICE starts a new group.
 */
function extractChoiceGroups(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const groups = [];
  let currentGroup = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line !== "#1-CHOICE") continue;

    // Look back for the choice index (PUSH_INT32 value on the preceding line).
    let choiceIndex = -1;
    if (i >= 2 && lines[i - 2].trim() === "#1-PUSH_INT32") {
      const match = lines[i - 1].trim().match(/^\[(\d+)\]$/);
      if (match) choiceIndex = parseInt(match[1]);
    }

    if (choiceIndex === 0) {
      currentGroup = [];
      groups.push(currentGroup);
    }

    // Extract text from STR_PRIMARY two lines ahead: #1-CHOICE → [label] → #1-STR_PRIMARY → ["text"]
    if (
      currentGroup !== null &&
      i + 3 < lines.length &&
      lines[i + 2].trim() === "#1-STR_PRIMARY"
    ) {
      const match = lines[i + 3].trim().match(/^\["(.+)"\]$/);
      if (match) {
        currentGroup.push(match[1]);
      }
    }
  }

  return groups.filter((g) => g.length > 0);
}

async function main() {
  // Step 1: Read and parse the line-aligned original/translated chunks.
  const originalText = await readChunks(ORIGINAL_CHUNKS_DIR);
  const translatedText = await readChunks(TRANSLATED_CHUNKS_DIR);
  const origSections = parseSections(originalText);
  const transSections = parseSections(translatedText);

  // Step 2: Build a per-section translation lookup (original line → translated line).
  const translationMaps = new Map();
  for (const [fileName, origLines] of origSections) {
    if (!transSections.has(fileName)) continue;
    const transLines = transSections.get(fileName);
    const lineMap = new Map();
    for (let i = 0; i < origLines.length && i < transLines.length; i++) {
      if (origLines[i] && !lineMap.has(origLines[i])) {
        lineMap.set(origLines[i], transLines[i]);
      }
    }
    translationMaps.set(fileName, lineMap);
  }

  // Step 3: Read all game scripts and extract choice groups.
  const gameScripts = (await glob(`${GAME_SCRIPT_DIR}/*.txt`))
    .filter((f) => !path.basename(f).startsWith("scene2_"))
    .sort();

  const outputSections = [];
  let totalGroups = 0;
  let totalChoices = 0;
  let untranslated = 0;

  for (const filePath of gameScripts) {
    const baseName = path.basename(filePath, ".txt");
    const text = await readGameScript(filePath);
    const groups = extractChoiceGroups(text);
    if (groups.length === 0) continue;

    const transMap = translationMaps.get(baseName);
    const lines = [];

    for (let g = 0; g < groups.length; g++) {
      if (g > 0) lines.push("");
      lines.push(`Group ${g + 1}`);
      for (const choice of groups[g]) {
        totalChoices++;
        const translation = transMap?.get(choice);
        if (translation) {
          lines.push(`${choice} → ${translation}`);
        } else {
          lines.push(`${choice} → [UNTRANSLATED]`);
          untranslated++;
        }
      }
      totalGroups++;
    }

    outputSections.push(
      `${baseName}\n${HEADER_SEPARATOR}\n${lines.join("\n")}`,
    );
  }

  // Step 4: Write output file.
  const output = outputSections
    .map((s) => `${SECTION_SEPARATOR}\n${s}`)
    .join("\n");
  await writeFile(OUTPUT_FILE, output + "\n", "utf-8");

  console.log("— Summary —");
  console.log(`  Files with choices: ${outputSections.length}`);
  console.log(`  Total groups:       ${totalGroups}`);
  console.log(`  Total choices:      ${totalChoices}`);
  console.log(`  Untranslated:       ${untranslated}`);
  console.log(`  Exported to:        ${OUTPUT_FILE}`);
}

main().catch(console.error);
