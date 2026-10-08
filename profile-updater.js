/**
 * profile-updater.js — injects GitBot's latest activity into a profile README.
 *
 * Scans the owner's public repos for the most recent comment written by the bot
 * and rewrites the block between <!-- bot-status --> and <!-- /bot-status -->.
 *
 * Env:
 *   GITHUB_TOKEN  token with read access to the repos (Actions' GITHUB_TOKEN works for public repos)
 *   PROFILE_USER  GitHub username whose repos are scanned (default: gyuv)
 *   BOT_LOGIN     the app's bot login, e.g. "my-gitbot[bot]" (required)
 *   README_PATH   path to the README to update (default: README.md)
 *   MAX_REPOS     how many recently-pushed repos to scan (default: 30)
 */
import { readFile, writeFile } from "node:fs/promises";

const TOKEN = process.env.GITHUB_TOKEN;
const USER = process.env.PROFILE_USER || "gyuv";
const BOT_LOGIN = process.env.BOT_LOGIN;
const README_PATH = process.env.README_PATH || "README.md";
const MAX_REPOS = Number(process.env.MAX_REPOS || 30);
const START = "<!-- bot-status -->";
const END = "<!-- /bot-status -->";

if (!BOT_LOGIN) {
  console.error("BOT_LOGIN is required (e.g. 'my-gitbot[bot]').");
  process.exit(1);
}

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "gitbot-profile-updater",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

function describe(comment, repo) {
  const isPR = comment.html_url.includes("/pull/");
  const number = comment.issue_url.split("/").pop();
  const body = comment.body;
  let verb;
  if (body.includes("has been merged")) verb = `Celebrated a merged PR 🚀`;
  else if (isPR) verb = `Welcomed a pull request 🎉`;
  else if (body.startsWith("⭐") || body.startsWith("💫")) verb = `Logged a new star ⭐`;
  else verb = `Responded to an issue 👀`;
  return `${verb} in [${repo}#${number}](${comment.html_url})`;
}

function relativeTime(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} days ago`;
}

async function findLatestActivity() {
  const repos = await gh(`/users/${USER}/repos?sort=pushed&per_page=${MAX_REPOS}&type=owner`);
  let latest = null;
  for (const repo of repos) {
    if (repo.archived) continue;
    let comments;
    try {
      comments = await gh(`/repos/${repo.full_name}/issues/comments?sort=created&direction=desc&per_page=50`);
    } catch (err) {
      console.warn(`Skipping ${repo.full_name}: ${err.message}`);
      continue;
    }
    const mine = comments.find((c) => c.user?.login === BOT_LOGIN);
    if (mine && (!latest || mine.created_at > latest.comment.created_at)) {
      latest = { comment: mine, repo: repo.name };
    }
  }
  return latest;
}

async function main() {
  const latest = await findLatestActivity();
  const status = latest
    ? `🤖 **GitBot status:** online ✨ — Last action: ${describe(latest.comment, latest.repo)} · _${relativeTime(latest.comment.created_at)}_ 🐾`
    : `🤖 **GitBot status:** online ✨ — All quiet! Monitoring ${USER}'s repos. Status: secure 💖`;

  const readme = await readFile(README_PATH, "utf8");
  const start = readme.indexOf(START);
  if (start === -1) throw new Error(`No ${START} marker in ${README_PATH}`);
  const endIdx = readme.indexOf(END, start);
  const before = readme.slice(0, start + START.length);
  const after = endIdx === -1 ? readme.slice(start + START.length) : readme.slice(endIdx + END.length);
  const updated = `${before}\n${status}\n${END}${after}`;

  if (updated === readme) {
    console.log("README already up to date.");
    return;
  }
  await writeFile(README_PATH, updated);
  console.log(`Updated ${README_PATH}: ${status}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
