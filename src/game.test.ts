import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { io as connect, type Socket } from "socket.io-client";

import { createGameServer } from "./server.js";
import type {
  ChatMessage,
  ClientToServerEvents,
  RoomView,
  ServerToClientEvents,
  StrokeSegment,
} from "./shared/protocol.js";

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** A connected test client that records everything the server sends it. */
type Client = {
  socket: ClientSocket;
  state: () => RoomView;
  messages: ChatMessage[];
  segments: StrokeSegment[];
  sessionPlayerId: () => string | null | undefined;
};

const server = createGameServer({ corsOrigins: [] });
let url = "";
const sockets: ClientSocket[] = [];

before(async () => {
  await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
  url = `http://localhost:${(server.httpServer.address() as AddressInfo).port}`;
});

after(async () => {
  for (const socket of sockets) socket.disconnect();
  await server.close();
});

const until = async (condition: () => boolean, label: string) => {
  const deadline = Date.now() + 2_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${label}`);
    await sleep(10);
  }
};

const connectClient = async (sessionId: string): Promise<Client> => {
  const socket: ClientSocket = connect(url, { auth: { sessionId }, transports: ["websocket"], forceNew: true });
  sockets.push(socket);

  let latest: RoomView | undefined;
  let sessionPlayerId: string | null | undefined;
  const messages: ChatMessage[] = [];
  const segments: StrokeSegment[] = [];
  socket.on("room:state", (view) => (latest = view));
  socket.on("session:init", ({ playerId }) => (sessionPlayerId = playerId));
  socket.on("chat:message", (message) => messages.push(message));
  socket.on("draw:points", (segment) => segments.push(segment));

  await until(() => sessionPlayerId !== undefined, `${sessionId} session:init`);
  return {
    socket,
    state: () => {
      assert.ok(latest, "no room state received yet");
      return latest;
    },
    messages,
    segments,
    sessionPlayerId: () => sessionPlayerId,
  };
};

const createRoom = async (client: Client, name: string) => {
  const result = await client.socket.emitWithAck("room:create", { name });
  assert.ok(result.ok, "room:create failed");
  return result;
};

const joinRoom = async (client: Client, code: string, name: string) => {
  const result = await client.socket.emitWithAck("room:join", { code, name });
  assert.ok(result.ok, "room:join failed");
  return result;
};

describe("a full turn", () => {
  test("drawer picks a word, guesser scores, word never leaks", async () => {
    const alice = await connectClient("alice-session-0001");
    const bob = await connectClient("bob-session-000001");

    const { code, playerId: aliceId } = await createRoom(alice, "Alice");
    const { playerId: bobId } = await joinRoom(bob, code.toLowerCase(), "Bob");
    await until(() => alice.state().players.length === 2, "bob visible to alice");

    const notHost = await bob.socket.emitWithAck("game:start");
    assert.deepEqual(notHost, { ok: false, error: "Only the host can start the game." });

    assert.deepEqual(await alice.socket.emitWithAck("game:start"), { ok: true });
    await until(() => alice.state().wordChoices?.length === 3, "alice gets word choices");
    await until(() => bob.state().phase === "choosing", "bob sees choosing phase");
    assert.equal(bob.state().drawerId, aliceId);
    assert.equal(bob.state().wordChoices, null, "choices are private to the drawer");

    alice.socket.emit("game:choose-word", { index: 0 });
    await until(() => alice.state().phase === "drawing", "drawing phase");
    const word = alice.state().word;
    assert.ok(word);
    await until(() => bob.state().phase === "drawing", "bob sees drawing phase");
    assert.equal(bob.state().word, null, "guessers never receive the word");
    assert.equal(bob.state().hint?.length, word.length);

    // Only the drawer may draw; the drawer's own strokes are not echoed back.
    alice.socket.emit("draw:points", { id: "s1", color: "#000000", size: 4, points: [0.1, 0.1, 0.2, 0.2] });
    bob.socket.emit("draw:points", { id: "s2", color: "#000000", size: 4, points: [0.5, 0.5] });
    await until(() => bob.segments.length === 1, "bob receives the stroke");
    await sleep(50);
    assert.equal(alice.segments.length, 0);

    bob.socket.emit("chat:send", { text: "definitely not it" });
    await until(() => alice.messages.some((m) => m.kind === "player" && m.text === "definitely not it"), "wrong guess broadcast");

    bob.socket.emit("chat:send", { text: word.toUpperCase() });
    await until(() => bob.state().phase === "turnEnd", "turn ends when everyone guessed");

    const result = bob.state().turnResult;
    assert.equal(result?.word, word);
    assert.equal(result?.reason, "allGuessed");
    assert.ok((result?.gains[bobId] ?? 0) > 200, "a fast guess earns most of the points");
    assert.equal(result?.gains[aliceId], 50);
    const leaked = [...alice.messages, ...bob.messages].some(
      (m) => m.kind === "player" && m.text.toLowerCase() === word,
    );
    assert.equal(leaked, false, "the correct guess is never shown in chat");
  });
});

describe("sessions", () => {
  test("a refresh resumes the same seat", async () => {
    const carol = await connectClient("carol-session-0001");
    const { code, playerId } = await createRoom(carol, "Carol");
    carol.socket.disconnect();

    const again = await connectClient("carol-session-0001");
    assert.equal(again.sessionPlayerId(), playerId);
    await until(() => again.state().code === code, "state resent on resume");
    assert.equal(again.state().players[0]?.connected, true);
  });

  test("the host leaving mid-game hands over the room and ends the game", async () => {
    const dave = await connectClient("dave-session-00001");
    const erin = await connectClient("erin-session-00001");
    const { code } = await createRoom(dave, "Dave");
    const { playerId: erinId } = await joinRoom(erin, code, "Erin");
    await dave.socket.emitWithAck("game:start");
    await until(() => erin.state().phase === "choosing", "game started");

    dave.socket.emit("room:leave");
    await until(() => erin.state().phase === "lobby", "back to lobby");
    assert.equal(erin.state().hostId, erinId);
    assert.equal(erin.state().players.length, 1);
  });

  test("rejects a malformed session id", async () => {
    const socket: ClientSocket = connect(url, { auth: { sessionId: "x" }, transports: ["websocket"], forceNew: true });
    sockets.push(socket);
    const error = await new Promise<Error>((resolve) => socket.once("connect_error", resolve));
    assert.equal(error.message, "Invalid session");
  });
});
