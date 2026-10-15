import test from "node:test";
import assert from "node:assert/strict";
import { profileFromUrl, parseSources, mergeCandidates, buildInstagramLead, discoverInstagramCandidates } from "../chrome-extension/background/instagram-prospector.mjs";

test("only Instagram profile URLs become candidates, never posts or external sites", () => {
  assert.equal(profileFromUrl("https://instagram.com.evil.test/person/"), null);
  assert.equal(profileFromUrl("https://www.instagram.com/p/ABC/"), null);
  assert.equal(profileFromUrl("https://www.instagram.com/explore/"), null);
  assert.equal(profileFromUrl("https://www.instagram.com/Actual.User/" ).handle, "actual.user");
});

test("mixed preset sources preserve hashtags rather than silently dropping them", () => {
  const sources = parseSources({ target: "@retail\n#franquicias", sourceType: "followers" });
  assert.deepEqual(sources.map((s) => s.type), ["followers", "hashtag"]);
  assert.throws(() => parseSources({ target: "https://outside.test/post", sourceType: "comments" }));
  assert.throws(() => parseSources({ target: "@retail", sourceType: "comments" }));
});

test("discovery traverses a followers list to 100 profiles, not the seed or a hidden 80 cap", async () => {
  let page = 0;
  const visited = [];
  const result = await discoverInstagramCandidates({ target: "@retail", sourceType: "followers", limit: 100 }, {
    navigate: async (url) => visited.push(url),
    pause: async () => {},
    inspect: async (action) => action === "open-followers" ? { opened: true } : {
      profiles: Array.from({ length: 20 }, (_, i) => ({ url: `https://www.instagram.com/user${page * 20 + i}/` })),
      ...(page++ < 9 ? {} : { error: "should not reach this page" })
    }
  });
  assert.equal(result.candidates.length, 100);
  assert.equal(result.candidates.some((c) => c.handle === "retail"), false);
  assert.equal(page, 5);
  assert.equal(visited.length, 1);
});

test("duplicate profiles merge provenance without creating duplicate intent factors", () => {
  const candidates = [];
  const rows = [{ url: "https://www.instagram.com/person/", evidence: "Quiero abrir una franquicia" }];
  mergeCandidates(candidates, rows, { type: "followers", handle: "retail", url: "seed" }, 10);
  mergeCandidates(candidates, rows, { type: "comments", url: "post" }, 10);
  mergeCandidates(candidates, rows, { type: "comments", url: "post" }, 10);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].signals.length, 2);
  assert.equal(candidates[0].evidence.length, 1);
});

test("following a franchise account and a Meta footer link do not prove intent or contact", () => {
  const lead = buildInstagramLead({ handle: "person", signals: ["Sigue a @franquicias"] }, {
    text: "Consumidor habitual", links: ["https://about.meta.com/", "https://www.instagram.com/legal/privacy/"]
  }, { requiredSignalCount: 2, requireIntentSignal: true });
  assert.equal(lead.website, "");
  assert.equal(lead.email, "");
  assert.equal(lead.status, "Insuficiente");
  assert.equal(lead.signals.length, 1);
});

test("actual comment intent plus follower relationship meets multiple factors", () => {
  const lead = buildInstagramLead({ handle: "person", signals: ["Sigue a @retail"], evidence: ["Quiero abrir una franquicia. Busco informacion para invertir."] }, {
    text: "Mi perfil", links: []
  }, { requiredSignalCount: 2, requireIntentSignal: true });
  assert.equal(lead.status, "Valido");
  assert.equal(lead.signals.filter((s) => s.startsWith("Intencion")).length, 1);
});

test("email filter searches observed addresses only and records exclusions", () => {
  const source = { handle: "person", signals: ["Sigue a @retail"] };
  const config = { emailKeywords: "brand", requiredSignalCount: 1, requireIntentSignal: false };
  const excluded = buildInstagramLead(source, { text: "No email", links: [] }, config);
  assert.equal(excluded.email, "");
  assert.equal(excluded.status, "Insuficiente");
  const matching = buildInstagramLead(source, { text: "empresa@brand.test", links: [] }, config);
  assert.equal(matching.email, "empresa@brand.test");
  assert.equal(matching.status, "Valido");
});

test("Instagram login or unavailable sources fail explicitly instead of completing with zero", async () => {
  await assert.rejects(discoverInstagramCandidates({ target: "@retail", sourceType: "followers", limit: 100 }, {
    navigate: async () => {}, pause: async () => {}, inspect: async () => ({ error: "Instagram solicita iniciar sesion en Chrome." })
  }), /iniciar sesion/);
});

test("hashtag results inspect post authors and retain evidence of the source", async () => {
  let actionCount = 0;
  const result = await discoverInstagramCandidates({ target: "#franquicias", sourceType: "hashtag", limit: 1 }, {
    navigate: async () => {}, pause: async () => {}, inspect: async (action) => {
      actionCount++;
      return action === "posts" ? { posts: ["https://www.instagram.com/p/ABC/"] }
        : { profiles: [{ url: "https://www.instagram.com/author/" }] };
    }
  });
  assert.equal(actionCount, 2);
  assert.equal(result.candidates[0].handle, "author");
  assert.deepEqual(result.candidates[0].signals, ["Publica en hashtag"]);
});

test("a loading follower list is not treated as exhausted after five empty polls", async () => {
  let calls = 0;
  const result = await discoverInstagramCandidates({ target: "@retail", sourceType: "followers", limit: 20 }, {
    navigate: async () => {}, pause: async () => {}, inspect: async (action) => {
      if (action === "open-followers") return { opened: true };
      if (calls++ < 7) return { profiles: [], loading: true };
      return { profiles: Array.from({ length: 20 }, (_, i) => ({ url: `https://www.instagram.com/person${i}/` })) };
    }
  });
  assert.equal(result.candidates.length, 20);
});
