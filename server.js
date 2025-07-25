const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public")); // Your public HTML/CSS/JS

const rooms = {};             // { ROOM_CODE: [{ id, name, ready }] }
const answers = {};           // { roomCode: { socketId: { race, class, flair, cname } } }
const submitted = {};         // { roomCode: Set of socket IDs }
const globalAssigned = {};    // Assigned traits
const finalTraits = {};       // Finalized traits from players
const confirmedReady = {}; // { roomCode: Set(socketIds) }

io.on("connection", socket => {
  // Player joins a room
  socket.on("joinRoom", ({ name, room }) => {
    socket.join(room);
    if (!rooms[room]) rooms[room] = [];
    if (!rooms[room].some(p => p.id === socket.id)) {
      rooms[room].push({ id: socket.id, name, ready: false });
    }
    io.to(room).emit("roomUpdate", rooms[room]);
  });

  // Player marks themselves ready
  socket.on("playerReady", ({ name, room }) => {
    const player = rooms[room]?.find(p => p.id === socket.id);
    if (player) {
      player.ready = true;
      io.to(room).emit("roomUpdate", rooms[room]);

      const allReady = rooms[room].length > 0 && rooms[room].every(p => p.ready);
      if (allReady) {
        io.to(room).emit("startGame");
      }
    }
  });

  // Player submits their character
  socket.on("characterSubmitted", ({ room, answers: ans }) => {
    if (!answers[room]) answers[room] = {};
    if (!submitted[room]) submitted[room] = new Set();

    answers[room][socket.id] = ans;
    submitted[room].add(socket.id);

    const allSubmitted = submitted[room].size === (rooms[room]?.length || 0);
    if (allSubmitted) {
      io.to(room).emit("allSubmitted", answers[room]); // Optional: send raw answers
      assignRandomTraits(room); // 🔥 Assign traits once all submitted
    }
  });

  // Player finalizes traits
  socket.on("traitsFinalized", finalResult => {
    let room = null;
    for (const r in rooms) {
      if (rooms[r].some(p => p.id === socket.id)) {
        room = r;
        break;
      }
    }

    if (!room) return;

    if (!finalTraits[room]) finalTraits[room] = {};
    finalTraits[room][socket.id] = finalResult;

    const players = rooms[room];
    const allDone = players.every(p => finalTraits[room][p.id]);

    if (allDone) {
      io.to(room).emit("beginBackstory", {
        traits: finalTraits[room]
      });
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    for (let room in rooms) {
      const original = rooms[room].length;
      rooms[room] = rooms[room].filter(p => p.id !== socket.id);
      if (rooms[room].length !== original) {
        if (answers[room]) delete answers[room][socket.id];
        if (submitted[room]) submitted[room].delete(socket.id);
        io.to(room).emit("roomUpdate", rooms[room]);
      }
    }
  });
});

// 🔥 Trait Assignment Function
function assignRandomTraits(room) {
  const playerList = rooms[room] || [];
  const submissions = answers[room];

  const maxUses = 2;
  const players = playerList.map(p => ({
    id: p.id,
    result: { race: null, class: null, flair: null, cname: null },
    chooseOwn: {}
  }));

  const categories = ['race', 'class', 'flair', 'cname'];

  for (const category of categories) {
    const allEntries = [];

    for (const [id, submission] of Object.entries(submissions)) {
      allEntries.push({ value: submission[category], from: id });
    }

    const usageMap = new Map();

    for (const player of players) {
      if (Math.random() < 0.2) {
        player.result[category] = "CHOOSE";
        player.chooseOwn[category] = true;
        continue;
      }

      let shuffled = [...allEntries].sort(() => Math.random() - 0.5);
      let picked = null;

      for (const entry of shuffled) {
        const key = entry.value;
        if ((usageMap.get(key) || 0) < maxUses) {
          picked = entry;
          usageMap.set(key, (usageMap.get(key) || 0) + 1);
          break;
        }
      }

      if (!picked) picked = shuffled[0]; // fallback
      player.result[category] = picked.value;
    }
  }

  globalAssigned[room] = {};
  for (const player of players) {
    globalAssigned[room][player.id] = player;
  }

  for (const player of players) {
    const socketObj = io.sockets.sockets.get(player.id);
    if (!socketObj) continue;

    socketObj.emit("traitAssignment", {
      result: player.result,
      chooseOwn: player.chooseOwn,
      playerNames: Object.entries(submissions).map(([id, sub]) => ({
        id,
        name: rooms[room].find(p => p.id === id)?.name || "Unknown",
        values: sub
      }))
    });
  }
}

socket.on("confirmTraitsReady", () => {
  const room = getPlayerRoom(socket.id);
  if (!confirmedReady[room]) confirmedReady[room] = new Set();
  confirmedReady[room].add(socket.id);

  const allConfirmed =
    rooms[room].length > 0 &&
    confirmedReady[room].size === rooms[room].length;

  if (allConfirmed) {
    io.to(room).emit("beginBackstory", {
      timer: 15 * 60 // in seconds
    });
  }
});

server.listen(3000, () => {
  console.log("✅ Server running at http://localhost:3000");
});
