const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public")); // Make sure your HTML file is in a 'public' folder

const rooms = {};       // { ROOM_CODE: [{ id, name, ready }] }
const answers = {};     // { roomCode: { socketId: { race, class, flair, cname } } }
const submitted = {};   // { roomCode: Set of socket IDs }

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

      // Check if all players are ready
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

    // Check if all players in the room have submitted
    const allSubmitted = submitted[room].size === (rooms[room]?.length || 0);
    if (allSubmitted) {
      io.to(room).emit("allSubmitted", answers[room]); // You can send full answers too
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

server.listen(3000, () => {
  console.log("✅ Server running at http://localhost:3000");
});
