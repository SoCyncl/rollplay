const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// Game state storage
const rooms = {};             // { roomCode: [{ id, name, ready, answers }] }
const answers = {};           // { roomCode: { socketId: { race, class, flair, cname } } }
const submitted = {};         // { roomCode: Set of socket IDs }
const globalAssigned = {};    // { roomCode: { socketId: { result, chooseOwn } } }
const finalTraits = {};       // { roomCode: { socketId: finalTraits } }
const confirmedReady = {};    // { roomCode: Set of socket IDs }
const writingPhase = {};      // { roomCode: { startTime, submissions: { socketId: backstory } } }

// Helper function to find a player's room
function getPlayerRoom(socketId) {
  for (const room in rooms) {
    if (rooms[room].some(p => p.id === socketId)) {
      return room;
    }
  }
  return null;
}

io.on("connection", (socket) => {
  console.log(`New connection: ${socket.id}`);

  // Player joins a room
  socket.on("joinRoom", ({ name, room }) => {
    if (!name || !room) {
      socket.emit("error", "Name and room are required");
      return;
    }

    socket.data.name = name;
    socket.data.room = room;

    socket.join(room);
    
    // Initialize room if it doesn't exist
    if (!rooms[room]) {
      rooms[room] = [];
      answers[room] = {};
      submitted[room] = new Set();
    }

    // Add player if not already in room
    if (!rooms[room].some(p => p.id === socket.id)) {
      rooms[room].push({
        id: socket.id,
        name,
        ready: false,
        answers: {
          race: "",
          class: "",
          flair: "",
          cname: ""
        }
      });
    }

    io.to(room).emit("roomUpdate", rooms[room]);
    console.log(`${name} joined room ${room}`);
  });

  // Player marks themselves ready
  socket.on("playerReady", ({ name, room }) => {
    const player = rooms[room]?.find(p => p.id === socket.id);
    if (player) {
      player.ready = true;
      io.to(room).emit("roomUpdate", rooms[room]);

      // Check if all players are ready
      const allReady = rooms[room].every(p => p.ready);
      if (allReady && rooms[room].length > 1) {
        io.to(room).emit("allPlayersReady");
      }
    }
  });

  // Player submits their character
  socket.on("characterSubmitted", ({ room, answers: ans }) => {
    if (!answers[room]) answers[room] = {};
    if (!submitted[room]) submitted[room] = new Set();

    // Update player's answers
    answers[room][socket.id] = ans;
    submitted[room].add(socket.id);

    // Update player record in room
    const player = rooms[room]?.find(p => p.id === socket.id);
    if (player) {
      player.answers = ans;
    }

    // Notify player their submission was received
    socket.emit("submissionReceived");

    // Check if all players have submitted
    const allSubmitted = submitted[room].size === rooms[room]?.length;
    if (allSubmitted) {
      assignRandomTraits(room);
    }
  });

  // Player finalizes their trait choices
  socket.on("traitsFinalized", (finalResult) => {
    const room = getPlayerRoom(socket.id);
    if (!room) return;

    if (!finalTraits[room]) finalTraits[room] = {};
    finalTraits[room][socket.id] = finalResult;

    // Check if all players have finalized
    const allDone = rooms[room].every(p => finalTraits[room][p.id]);
    if (allDone) {
      io.to(room).emit("allTraitsFinalized");
    }
  });

  // Player confirms they're ready to begin backstory writing
  socket.on("confirmTraitsReady", () => {
    const room = getPlayerRoom(socket.id);
    if (!room) return;

    if (!confirmedReady[room]) confirmedReady[room] = new Set();
    confirmedReady[room].add(socket.id);

    // Check if all players are ready
    const allConfirmed = confirmedReady[room].size === rooms[room]?.length;
    if (allConfirmed) {
      // Prepare writing phase
      writingPhase[room] = {
        startTime: Date.now(),
        submissions: {}
      };

      // Send each player their assigned traits
      rooms[room].forEach(player => {
        const assignedTraits = globalAssigned[room]?.[player.id]?.result || {};
        io.to(player.id).emit("beginBackstory", {
          traits: assignedTraits,
          deadline: Date.now() + 15 * 60 * 1000 // 15 minutes
        });
      });
    }
  });

  // Player submits their backstory
  socket.on("submitBackstory", ({ room, backstory }) => {
    if (!writingPhase[room]) return;

    // Store the submission
    writingPhase[room].submissions[socket.id] = backstory;

    // Notify room
    io.to(room).emit("playerSubmitted", {
      id: socket.id,
      count: Object.keys(writingPhase[room].submissions).length
    });

    // Check if all players have submitted
    const allSubmitted = Object.keys(writingPhase[room].submissions).length === rooms[room]?.length;
    if (allSubmitted) {
      io.to(room).emit("allBackstoriesSubmitted", writingPhase[room].submissions);
    }
  });

  // Handle disconnections
  socket.on("disconnect", () => {
    const room = getPlayerRoom(socket.id);
    if (!room) return;

    // Remove player from room
    rooms[room] = rooms[room].filter(p => p.id !== socket.id);

    // Clean up other data
    if (answers[room]) delete answers[room][socket.id];
    if (submitted[room]) submitted[room].delete(socket.id);
    if (confirmedReady[room]) confirmedReady[room].delete(socket.id);
    if (finalTraits[room]) delete finalTraits[room][socket.id];
    if (writingPhase[room]?.submissions) delete writingPhase[room].submissions[socket.id];

    // Notify remaining players
    if (rooms[room].length > 0) {
      io.to(room).emit("roomUpdate", rooms[room]);
    } else {
      // Clean up empty room
      delete rooms[room];
      delete answers[room];
      delete submitted[room];
      delete confirmedReady[room];
      delete finalTraits[room];
      delete writingPhase[room];
    }

    console.log(`${socket.id} disconnected from room ${room}`);
  });
});

// Trait assignment logic
function assignRandomTraits(room) {
  if (!rooms[room] || !answers[room]) return;

  const players = rooms[room].map(p => ({
    id: p.id,
    result: { race: null, class: null, flair: null, cname: null },
    chooseOwn: {}
  }));

  const categories = ['race', 'class', 'flair', 'cname'];
  const maxUses = 2; // Maximum times a trait can be used

  // Assign traits for each category
  for (const category of categories) {
    const allEntries = [];
    
    // Collect all submissions for this category
    for (const [id, submission] of Object.entries(answers[room])) {
      if (submission[category]) {
        allEntries.push({ value: submission[category], from: id });
      }
    }

    const usageMap = new Map(); // Track how many times each trait is used

    // Assign traits to each player
    for (const player of players) {
      // 20% chance to let player choose their own trait
      if (Math.random() < 0.2) {
        player.result[category] = "CHOOSE";
        player.chooseOwn[category] = true;
        continue;
      }

      // Shuffle available traits
      const shuffled = [...allEntries].sort(() => Math.random() - 0.5);
      let picked = null;

      // Find first available trait that hasn't been used too much
      for (const entry of shuffled) {
        const key = entry.value;
        if ((usageMap.get(key) || 0) < maxUses) {
          picked = entry;
          usageMap.set(key, (usageMap.get(key) || 0) + 1);
          break;
        }
      }

      // Fallback if all traits are used up
      if (!picked) picked = shuffled[0];
      player.result[category] = picked.value;
    }
  }

  // Store assignments globally
  globalAssigned[room] = {};
  for (const player of players) {
    globalAssigned[room][player.id] = player;
  }

  // Send each player their assignments
  for (const player of players) {
    const socket = io.sockets.sockets.get(player.id);
    if (!socket) continue;

    // Prepare player names and their original submissions
    const playerNames = Object.entries(answers[room]).map(([id, sub]) => ({
      id,
      name: rooms[room].find(p => p.id === id)?.name || "Unknown",
      values: sub
    }));

    socket.emit("traitAssignment", {
      result: player.result,
      chooseOwn: player.chooseOwn,
      playerNames
    });
  }
}

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
