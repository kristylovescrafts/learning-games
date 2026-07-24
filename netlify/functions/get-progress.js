// Reads the "progress-report" form submissions from Netlify and returns the
// structured progress snapshots the dashboard renders.
//
// Needs ONE environment variable on the site:
//   NETLIFY_TOKEN  = a Netlify personal access token (User settings > Applications)
// The site id is provided automatically by Netlify at runtime.

const API = "https://api.netlify.com/api/v1";

exports.handler = async function () {
  const token = process.env.NETLIFY_TOKEN;
  const siteId = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
  if (!token) {
    return json(500, { error: "Missing NETLIFY_TOKEN environment variable." });
  }
  const auth = { Authorization: `Bearer ${token}` };

  try {
    // find the progress-report form for this site
    const formsRes = await fetch(`${API}/sites/${siteId}/forms`, { headers: auth });
    if (!formsRes.ok) throw new Error(`forms ${formsRes.status}`);
    const forms = await formsRes.json();
    const form = forms.find((f) => f.name === "progress-report") || forms[0];
    if (!form) return json(200, { snapshots: [] });

    // newest submissions first
    const subsRes = await fetch(
      `${API}/forms/${form.id}/submissions?per_page=100`,
      { headers: auth }
    );
    if (!subsRes.ok) throw new Error(`submissions ${subsRes.status}`);
    const subs = await subsRes.json();

    const snapshots = [];
    for (const s of subs) {
      const d = s.data || {};
      // Preferred: a structured JSON payload field.
      if (d.payload) {
        try {
          const p = JSON.parse(d.payload);
          p.saved = p.saved || s.created_at;
          snapshots.push(p);
          continue;
        } catch (e) {
          /* fall through to text parse */
        }
      }
      // Fallback: parse the human-readable report text.
      if (d.report) {
        const p = parseReport(d.report, s.created_at, d.device || "");
        if (p) snapshots.push(p);
      }
    }
    return json(200, { snapshots });
  } catch (err) {
    return json(500, { error: String(err && err.message || err) });
  }
};

function json(status, obj) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(obj),
  };
}

/* -------- fallback parser for the emailed report text -------- */
function parseReport(text, when, device) {
  const app = /math progress/i.test(text) ? "mathQuest"
            : /reading progress/i.test(text) ? "twinWordQuest" : null;
  if (!app) return null;
  const blocks = text.split(/-{6,}/); // players separated by a dashed line
  const players = {};
  for (const b of blocks) {
    const nameLine = b.match(/([\u{1F000}-\u{1FAFF}\u2600-\u27BF]?)\s*([A-Z][A-Za-z]+)\s+—\s+(?:reading|math) progress/u);
    if (!nameLine) continue;
    const name = nameLine[2];
    const key = /tori/i.test(name) ? "tori" : "thomas";
    const gems = (b.match(/Gems(?: earned)?:\s*(\d+)/i) || [])[1] || 0;
    const levels = {};
    // "🔟 Friends of Ten Chart" then "played 3x · 15 right, 3 wrong (…)"
    const lineRe = /([\u{1F000}-\u{1FAFF}\u2600-\u27BF][^\n]*?)\n\s*played\s+(\d+)x[^\n]*?·\s*(\d+)\s*right,\s*(\d+)\s*wrong/gu;
    let m;
    while ((m = lineRe.exec(b))) {
      const id = labelToId(app, m[1].trim());
      if (!id) continue;
      const correct = +m[3], wrong = +m[4];
      levels[id] = { plays: +m[2], correct, wrong, total: correct + wrong, missed: {}, last: when };
    }
    players[key] = { name, avatar: nameLine[1] || "🙂", gems: +gems, levels, log: [] };
  }
  return Object.keys(players).length ? { app, saved: when, device, players } : null;
}

function labelToId(app, label) {
  const names = {
    twinWordQuest: { "Word Forest": "forest", "Word Detective City": "city",
      "Sentence Builder Beach": "beach", "Missing Letter Mountain": "mountain",
      "Spell It Space Station": "station", "Final Word Castle": "castle" },
    mathQuest: { "Friends of Ten Chart": "friendsChart", "Rainbow Pairs": "pairs",
      "Number Triangle": "triangle", "Build the Equation": "equation",
      "Teen Numbers Chart": "teensChart", "Teen Speed": "teensSpeed",
      "Doubles Chart": "doublesChart", "Doubles Speed": "doublesSpeed",
      "Hundred Chart Hops": "hundred", "Ten Hopper": "hopper", "Quick Tens": "quick" },
  };
  const map = names[app] || {};
  for (const nm in map) if (label.indexOf(nm) !== -1) return map[nm];
  return null;
}
