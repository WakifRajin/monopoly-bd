// Database rules tests: signs in as several users against the Firebase
// emulators and checks that normal play is allowed and tampering is refused.
//
//   npm run test:rules      (needs Java and firebase-tools; see README)
//
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, signInAnonymously } from "firebase/auth";
import { getDatabase, connectDatabaseEmulator, ref, set, get, update, remove, push, runTransaction, serverTimestamp } from "firebase/database";

const NS = "monopoly-bd-default-rtdb";
let n = 0;
async function user() {
  const app = initializeApp({ apiKey: "fake", projectId: "monopoly-bd", databaseURL: `https://${NS}.asia-southeast1.firebasedatabase.app` }, `u${n++}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getDatabase(app);
  connectDatabaseEmulator(db, "127.0.0.1", 9000);
  const cred = await signInAnonymously(auth);
  return { db, uid: cred.user.uid };
}
await fetch(`http://127.0.0.1:9000/.json?ns=${NS}`, { method: "DELETE", headers: { Authorization: "Bearer owner" } });
const results = [];
async function expect(label, want, fn) {
  let ok;
  try { await fn(); ok = true; } catch (e) { ok = false; if (!/permission/i.test(String(e))) console.log("  (", label, e.message, ")"); }
  const pass = ok === want;
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${want ? "allowed" : "denied "}  ${label}${pass ? "" : `  <- was ${ok ? "allowed" : "denied"}`}`);
}
const tx = (db, path, f) => runTransaction(ref(db, path), f).then((r) => { if (!r.committed) throw new Error("not committed"); });

const H = await user(), Gu = await user(), X = await user();
const R = "ROOM01";
const room = () => ({ schemaVersion: 3, status: "lobby", hostUid: H.uid, visibility: "open", hasPassword: false,
  players: [{ uid: H.uid, name: "Host", token: "🎩", kind: "human" }], playerUids: [H.uid], members: { [H.uid]: true },
  gameState: null, revision: 0, createdAt: Date.now(), updatedAt: Date.now() });

await expect("host creates room", true, () => tx(H.db, `rooms/${R}`, (c) => (c ? undefined : room())));
await expect("host writes index entry", true, () => set(ref(H.db, `roomIndex/${R}`), { id: R, status: "lobby", visibility: "open", playerCount: 1, hostName: "Host", updatedAt: Date.now() }));
await expect("stranger writes fake index entry (no room)", false, () => set(ref(X.db, `roomIndex/FAKE01`), { id: "FAKE01", status: "lobby", visibility: "open", playerCount: 3, updatedAt: Date.now() }));
await expect("stranger overwrites real index entry", false, () => set(ref(X.db, `roomIndex/${R}`), { id: R, status: "lobby", visibility: "open", playerCount: 9, updatedAt: Date.now() }));
await expect("guest joins", true, () => tx(Gu.db, `rooms/${R}`, (c) => c && ({ ...c, players: [...c.players, { uid: Gu.uid, name: "Guest", token: "🚗", kind: "human" }], playerUids: [...c.playerUids, Gu.uid], members: { ...c.members, [Gu.uid]: true }, updatedAt: Date.now() })));
await expect("guest adds a stranger to members", false, () => update(ref(Gu.db, `rooms/${R}`), { [`members/${X.uid}`]: true }));
await expect("stranger joins by adding themselves (open lobby)", true, () => update(ref(X.db, `rooms/${R}`), { [`members/${X.uid}`]: true, updatedAt: Date.now() }));
await expect("host presence online", true, () => set(ref(H.db, `roomPresence/${R}/${H.uid}`), { online: true, at: Date.now() }));
await expect("stranger writes host's presence", false, () => set(ref(X.db, `roomPresence/${R}/${H.uid}`), { online: false, at: 0 }));
await expect("guest takes host while host online", false, () => tx(Gu.db, `rooms/${R}`, (c) => { if (!c) return c; const m = { ...c.members }; delete m[H.uid]; return { ...c, hostUid: Gu.uid, members: m }; }));
await expect("guest deletes room", false, () => remove(ref(Gu.db, `rooms/${R}`)));
// chat: the message and the sender's rate stamp go together, in server time
const say = (u, msg, key = push(ref(u.db, `rooms/${R}/chat`)).key) =>
  update(ref(u.db), { [`rooms/${R}/chat/${key}`]: { time: serverTimestamp(), ...msg }, [`chatRate/${R}/${u.uid}`]: serverTimestamp() }).then(() => ({ key }));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let hostMsg;
await expect("host posts chat", true, async () => { hostMsg = await say(H, { uid: H.uid, name: "Host", token: "🎩", color: "#e74c3c", text: "hi" }); });
await expect("guest posts chat", true, () => say(Gu, { uid: Gu.uid, name: "Guest", token: "🚗", color: "#3498db", text: "yo" }));
await expect("guest posts again at once (rate limit)", false, () => say(Gu, { uid: Gu.uid, name: "Guest", text: "spam" }));
await pause(1100);
await expect("guest posts as host", false, () => say(Gu, { uid: H.uid, name: "Host", text: "fake" }));
await expect("guest posts 301 chars", false, () => say(Gu, { uid: Gu.uid, name: "Guest", text: "x".repeat(301) }));
await expect("chat without a rate stamp", false, () => push(ref(Gu.db, `rooms/${R}/chat`), { uid: Gu.uid, name: "Guest", text: "sneak", time: Date.now() }));
await expect("guest backdates a message", false, () => update(ref(Gu.db), { [`rooms/${R}/chat/${push(ref(Gu.db, "x")).key}`]: { uid: Gu.uid, text: "old", time: 1 }, [`chatRate/${R}/${Gu.uid}`]: serverTimestamp() }));
await expect("stranger writes a rate stamp for someone else", false, () => set(ref(X.db, `chatRate/${R}/${Gu.uid}`), serverTimestamp()));
await expect("member adds an unknown room field", false, () => update(ref(Gu.db, `rooms/${R}`), { junk: "x".repeat(50) }));
await expect("guest edits host's message", false, () => set(ref(Gu.db, `rooms/${R}/chat/${hostMsg.key}/text`), "edited"));
await expect("guest game sync (whole room incl. chat)", true, () => tx(Gu.db, `rooms/${R}`, (c) => c && ({ ...c, status: "playing", gameState: { a: 1 }, revision: (c.revision || 0) + 1, updatedAt: Date.now() })));
await expect("bad status value", false, () => update(ref(Gu.db, `rooms/${R}`), { status: "hacked" }));
await expect("a member deletes a live room's index entry", false, () => remove(ref(Gu.db, `roomIndex/${R}`)));
// a dropped player's seat is reserved; they (and only they) can take it back
await expect("takeover reserves the stranger's seat", true, () => tx(Gu.db, `rooms/${R}`, (c) => { if (!c) return c; const m = { ...c.members }; delete m[X.uid]; return { ...c, members: m, reserved: { [X.uid]: { seat: 2, name: "X", at: Date.now() } }, revision: c.revision + 1, updatedAt: Date.now() }; }));
const Y = await user();
await expect("someone else joins a game in progress", false, () => tx(Y.db, `rooms/${R}`, (c) => c && ({ ...c, members: { ...c.members, [Y.uid]: true }, updatedAt: Date.now() })));
await expect("someone else claims the reserved seat", false, () => tx(Y.db, `rooms/${R}`, (c) => { if (!c) return c; return { ...c, members: { ...c.members, [Y.uid]: true }, reserved: null, updatedAt: Date.now() }; }));
await expect("the dropped player rejoins their seat", true, () => tx(X.db, `rooms/${R}`, (c) => { if (!c) return c; return { ...c, members: { ...c.members, [X.uid]: true }, reserved: null, revision: c.revision + 1, updatedAt: Date.now() }; }));
// host leaves: hands host to guest
await expect("host leaves, hands over host", true, () => tx(H.db, `rooms/${R}`, (c) => { if (!c) return c; const m = { ...c.members }; delete m[H.uid]; return { ...c, hostUid: Gu.uid, members: m, players: c.players.filter((p) => p.uid !== H.uid), revision: c.revision + 1, updatedAt: Date.now() }; }));
await expect("new host deletes room", true, () => remove(ref(Gu.db, `rooms/${R}`)));
await expect("anyone clears index of deleted room", true, () => remove(ref(X.db, `roomIndex/${R}`)));

// takeover of a disconnected host
const R2 = "ROOM02";
const H2 = await user(), G2 = await user();
await expect("host2 creates room", true, () => tx(H2.db, `rooms/${R2}`, () => ({ ...room(), hostUid: H2.uid, players: [{ uid: H2.uid, name: "H2" }], playerUids: [H2.uid], members: { [H2.uid]: true } })));
await expect("guest2 joins", true, () => update(ref(G2.db, `rooms/${R2}`), { [`members/${G2.uid}`]: true, updatedAt: Date.now() }));
await set(ref(H2.db, `roomPresence/${R2}/${H2.uid}`), { online: true, at: Date.now() });
await expect("guest2 takes over online host", false, () => tx(G2.db, `rooms/${R2}`, (c) => { if (!c) return c; const m = { ...c.members }; delete m[H2.uid]; return { ...c, hostUid: G2.uid, members: m }; }));
await set(ref(H2.db, `roomPresence/${R2}/${H2.uid}`), { online: false, at: Date.now() });
await expect("guest2 takes over disconnected host", true, () => tx(G2.db, `rooms/${R2}`, (c) => { if (!c) return c; const m = { ...c.members }; delete m[H2.uid]; return { ...c, hostUid: G2.uid, members: m, updatedAt: Date.now() }; }));

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
