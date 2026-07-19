/**
 * src/tags.js
 *
 * Tag name loading and probability-to-tag conversion for OppaiOracle V1.1.
 *
 * Public API:
 *   probsToTags(probs, options) -> string[]
 *
 *   - probs:   Float32Array of length 19294 (sigmoid probabilities from inference)
 *   - options: { threshold: number, maxTags: number, blacklist: Set<string> }
 *   - Returns: tag names sorted by descending probability
 *
 * Tag CSV format (selected_tags.csv):
 *   tag_id,name,category
 *   - tag_id and category are integers
 *   - name may contain commas (e.g. "breasts, large") and may be quoted
 *   - Index 0 = <PAD>, Index 1 = <UNK> — both excluded from output
 *
 * The tag name list is lazily loaded on first call and cached.
 * Override the CSV path with env var OPPAI_TAGS_PATH (for testing).
 *
 * SPEC reference: .spec/SPEC.md §7.3
 */
"use strict";

const path = require("path");
const fs = require("fs");

const DEFAULT_TAGS_PATH = path.join(__dirname, "..", "models", "V1.1", "selected_tags.csv");

let _tagNames = null; // string[] — cached after first load, indexed by tag_id

/**
 * Load tag names from selected_tags.csv.
 * Handles tag names with commas by using a regex that exploits the fact
 * that tag_id (first field) and category (last field) are always integers.
 *
 * @returns {string[]} tag names indexed by tag_id
 */
function loadTags() {
  if (_tagNames) return _tagNames;

  const tagsPath = process.env.OPPAI_TAGS_PATH || DEFAULT_TAGS_PATH;
  let csv;
  try {
    csv = fs.readFileSync(tagsPath, "utf-8");
  } catch (err) {
    throw new Error(`Failed to read tag CSV at ${tagsPath}: ${err.message}`);
  }

  // Normalize line endings
  const lines = csv.replace(/\r\n/g, "\n").trim().split("\n");
  // First line is header: tag_id,name,category
  _tagNames = new Array(lines.length - 1);

  for (let i = 1; i < lines.length; i++) {
    // Greedy (.+) captures everything between first comma and last ,digits
    const match = lines[i].match(/^(\d+),(.+),(\d+)$/);
    if (!match) continue;

    const id = parseInt(match[1], 10);
    let name = match[2];

    // Strip surrounding quotes and unescape doubled quotes
    if (name.startsWith('"') && name.endsWith('"')) {
      name = name.slice(1, -1).replace(/""/g, '"');
    }

    _tagNames[id] = name;
  }

  return _tagNames;
}

/**
 * Convert probability array to a list of tag name strings.
 *
 * @param {Float32Array} probs       sigmoid probabilities (length 19294)
 * @param {object} options
 * @param {number} options.threshold minimum probability to include
 * @param {number} options.maxTags   maximum number of tags to return
 * @param {Set<string>} [options.blacklist] tag names to exclude
 * @returns {string[]} tag names sorted by descending probability
 */
function probsToTags(probs, { threshold, maxTags, blacklist = new Set() }) {
  const tags = loadTags();

  return Array.from(probs)
    .map((p, i) => ({ i, p }))
    .filter((x) => x.i >= 2) // skip <PAD>, <UNK>
    .filter((x) => x.p >= threshold)
    .filter((x) => !blacklist.has(tags[x.i]))
    .sort((a, b) => b.p - a.p)
    .slice(0, maxTags)
    .map((x) => tags[x.i]);
}

/**
 * Reset cached tag names (for testing with different CSV files).
 */
function _resetCache() {
  _tagNames = null;
}

module.exports = {
  probsToTags,
  loadTags,
  _resetCache,
  DEFAULT_TAGS_PATH,
};
