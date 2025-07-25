const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public")); // Make sure your HTML file is in a 'public' folder

const rooms = {}; // { ROOM_CODE: [{ id, name, ready }] }

io.on("connection", socket => {
  socket.on("joinRoom", ({ name, room }) => {
    socket.join(room);
    if (!rooms[room]) rooms[room] = [];
    if (!rooms[room].some(p => p.id === socket.id)) {
      rooms[room].push({ id: socket.id, name, ready: false });
    }
    io.to(room).emit("roomUpdate", rooms[room]);
  });

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

  socket.on("disconnect", () => {
    for (let room in rooms) {
      rooms[room] = rooms[room].filter(p => p.id !== socket.id);
      io.to(room).emit("roomUpdate", rooms[room]);
    }
  });
});


server.listen(3000, () => console.log("Server running on http://localhost:3000"));

