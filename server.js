const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public")); // Make sure your HTML file is in a 'public' folder

const rooms = {}; // { ROOM_CODE: [{id, name}] }

io.on("connection", socket => {
  console.log("A user connected:", socket.id);

  socket.on("joinRoom", ({ name, room }) => {
    socket.join(room);
    if (!rooms[room]) rooms[room] = [];
    rooms[room].push({ id: socket.id, name });

    console.log(`${name} joined room ${room}`);
    io.to(room).emit("roomUpdate", rooms[room]); // Send updated player list
  });

  socket.on("disconnect", () => {
    for (let room in rooms) {
      rooms[room] = rooms[room].filter(p => p.id !== socket.id);
      io.to(room).emit("roomUpdate", rooms[room]);
    }
    console.log("User disconnected:", socket.id);
  });
});

server.listen(3000, () => console.log("Server running on http://localhost:3000"));
