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
const confirmedReady = {};    // { roomCode: Set(socketIds) }
const writingPhase = {};      // { roomCode: { startTime, submissions: { socketId: backstory } } }
const backstories = {};       // { room: { socket.id: "story text" } }
const votes = {}; // { room: { targetId: [score, score, ...] } }

function getPlayerRoom(socketId) {
  for (const room in rooms) {
    if (rooms[room].some(p => p.id === socketId)) {
      return room;
    }
  }
  return null;
}

io.on("connection", socket => {
  const playerName = socket.data?.name || "Unknown";
  
  // Player joins a room
  socket.on("joinRoom", ({ name, room }) => {
    // Store in socket context
    socket.data.name = name;
    socket.data.room = room;

    socket.join(room);
    if (!rooms[room]) rooms[room] = [];
    if (!rooms[room].some(p => p.id === socket.id)) {
      rooms[room].push({
        id: socket.id,
        name,
        ready: false,
        answers: {
          race: "",
          class: "",
          flair: "",
          nameBackground: ""
        }
      });
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
    const room = getPlayerRoom(socket.id);
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

  // Player confirms traits are ready
  socket.on("confirmTraitsReady", () => {
    const room = getPlayerRoom(socket.id);
    if (!confirmedReady[room]) confirmedReady[room] = new Set();
    confirmedReady[room].add(socket.id);

    const allConfirmed = rooms[room].length > 0 && 
                        confirmedReady[room].size === rooms[room].length;

    if (allConfirmed) {
      io.to(room).emit("beginBackstory", {
        timer: 15 * 60 // in seconds
      });
    }
  });

  // Start the backstory writing phase
  socket.on("startBackstoryPhase", ({ room }) => {
    writingPhase[room] = {
      startTime: Date.now(),
      submissions: {}
    };
    io.to(room).emit("beginBackstory", {
      deadline: Date.now() + 15 * 60 * 1000 // 15 minutes
    });
  });

  // Submit backstory
  socket.on("submitBackstory", ({ story }) => {
  const room = getPlayerRoom(socket.id);
  if (!room) return;

  // Save to writingPhase tracking
  if (!writingPhase[room]) writingPhase[room] = { submissions: {} };
  writingPhase[room].submissions[socket.id] = story;

  // Save to final backstories (used in presentation)
  if (!backstories[room]) backstories[room] = {};
  backstories[room][socket.id] = story;

  const total = rooms[room]?.length || 0;
  const submittedCount = Object.keys(writingPhase[room].submissions).length;

  io.to(room).emit("playerSubmitted", {
    id: socket.id,
    count: submittedCount,
  });

  if (submittedCount === total) {
    const ordered = shuffle([...rooms[room]]);
    io.to(room).emit("startPresentation", {
      order: ordered.map(p => ({
        id: p.id,
        name: p.name,
        story: backstories[room][p.id]
      }))
    });
  }
});


  // Track submitted votes for presentation phase part 
  socket.on("submitVote", ({ targetId, score }) => {
  const room = getPlayerRoom(socket.id);
  if (!room) return;

  if (!votes[room]) votes[room] = {};
  if (!votes[room][targetId]) votes[room][targetId] = [];

  votes[room][targetId].push(score);

  // Check if all votes are in
  const totalPlayers = rooms[room]?.length || 0;
  const expectedVotes = totalPlayers * (totalPlayers - 1); // everyone votes for everyone else once

  const totalVotes = Object.values(votes[room]).reduce((sum, arr) => sum + arr.length, 0);
  if (totalVotes >= expectedVotes) {
    const leaderboard = Object.entries(votes[room]).map(([id, scores]) => {
      const player = rooms[room].find(p => p.id === id);
      return {
        name: player?.name || "Unknown",
        avgScore: (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)
      };
    }).sort((a, b) => b.avgScore - a.avgScore);

    io.to(room).emit("showLeaderboard", leaderboard);
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

//  Trait Assignment Function
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

function shuffle(array) {
  return array.sort(() => Math.random() - 0.5);
}

server.listen(3000, () => {
  console.log("✅ Server running at http://localhost:3000");
});
