// Isolated, explicitly synthetic fixture data for local UI checks. Never connects to Supabase.
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readFileSync } from "node:fs";

if (!process.env.HACKSNAP_SCHEMA_SQL) throw new Error("Set HACKSNAP_SCHEMA_SQL to the offline Alembic SQL export");
const db = new PGlite();
await db.exec(readFileSync(process.env.HACKSNAP_SCHEMA_SQL, "utf8"));
const run = "00000000-0000-0000-0000-000000000001";
await db.query(`INSERT INTO hn_ingestion_runs(run_id,status,filters,finished_at)
  VALUES ($1,'succeeded','{"classify_topic":true}',now())`, [run]);
const titles = [
  "[Demo] The hidden cost of running an AI coding agent",
  "[Demo] Small models are getting surprisingly useful",
  "[Demo] What happens when the benchmark becomes the target?",
  "[Demo] An open-source toolkit for inspecting agent traces",
  "[Demo] Training data is becoming the hardest part",
  "[Demo] Running a language model on an ordinary laptop",
  "[Demo] The gap between an impressive demo and a useful tool",
  "[Demo] A different approach to long-context retrieval",
  "[Demo] Who checks the code that checks the code?",
  "[Demo] Ask HN: What are you actually using AI for?",
];
for (let i = 0; i < titles.length; i++) {
  const id = 90000001 + i;
  await db.query("INSERT INTO hn_items VALUES ($1)", [id]);
  await db.query(`INSERT INTO hacker_news_threads(hn_id,title,url,
    date_published,date_added,points,comment_count,last_seen_run_id)
    VALUES ($1,$2,$3,now(),now() - $4 * interval '1 hour',$5,$6,$7)`,
    [id,titles[i],i===9 ? `https://news.ycombinator.com/item?id=${id}` : "https://example.com", i<7 ? 1 : 30,487-i*37,162-i*12,run]);
  // Include rising, falling, flat, single-observation and absent history states.
  const observations = i === 9 ? 0 : i === 8 ? 1 : 12;
  for (let j = 0; j < observations; j++) {
    const rank = i === 7 ? i + 1 : Math.max(1, Math.round(i + 1 + (observations-j-1) * (i % 2 ? -0.3 : 1.5)));
    await db.query(`INSERT INTO hacksnap_rank_history(hn_id,rank,observed_at)
      VALUES ($1,$2,now() - $3 * interval '1 hour')`, [id,rank,observations-j-1]);
  }
  if (i === 8) continue; // pending-summary state
  await db.query(`INSERT INTO hacksnap_summaries(story_id,article_url,article_summary,article_key_points,
    discussion_summary,discussion_points,overall_takeaway,model,prompt_version,source_fingerprint,source_coverage)
    VALUES ($1,$2,$3,$4,$5,$6,$7,'demo-fixture','v1',$8,$9)`, [id,
    i===9 ? null : "https://example.com",
    i===9 ? null : "This synthetic preview article explores the difference between headline performance and the cost of using a model in production. Its central claim: the surrounding workflow matters as much as the model itself.",
    JSON.stringify(i===9 ? [] : ["Repeated attempts can outweigh the advertised price per token.", "Measuring a completed task gives a different picture from measuring a single request.", "Human review time remains part of the overall cost."]),
    "These synthetic preview comments focus on how to measure useful work. One side values cheap, fast attempts; the other argues that debugging and review erase those savings.",
    JSON.stringify([{title:"A cheap attempt is not a cheap result",summary:"The disagreement comes down to the denominator: cost per request looks attractive, but cost per accepted change includes failed attempts and review.",comment_ids:[90000101]},{title:"The workflow changes the outcome",summary:"A narrower task and better tests may explain more of the improvement than a larger model.",comment_ids:[90000102]}]),
    "The interesting number is cost per completed task, including the attempts that didn’t work.",
    "0".repeat(64),JSON.stringify({stored_comments:42,included_comments:28,comments_truncated:true,article_status:i===9?"not_applicable":"fetched"})]);
}
const server = new PGLiteSocketServer({db, port:55432, host:"127.0.0.1"});
await server.start();
console.log("Synthetic preview database ready on 127.0.0.1:55432");
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => {
  await server.stop(); await db.close(); process.exit(0);
});
