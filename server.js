const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // serves index.html etc.

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// super simple in-memory store
const rooms = {}; 
// rooms[roomId] = { players: {socketId: {name}}, messages: [{name, text, ts}] }

io.on('connection', (socket) => {
  console.log('connected:', socket.id);

  socket.on('joinRoom', ({ roomId, name }) => {
    if (!roomId || !name) return;

    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = { players: {}, messages: [] };
    }
    rooms[roomId].players[socket.id] = { name };

    // send full state to the new user
    socket.emit('roomState', rooms[roomId]);

    // notify everyone about new player
    io.to(roomId).emit('playersUpdate', Object.values(rooms[roomId].players).map(p => p.name));
  });

  socket.on('sendMessage', ({ roomId, text }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players[socket.id];
    if (!player) return;

    const msg = { name: player.name, text, ts: Date.now() };
    room.messages.push(msg);
    io.to(roomId).emit('newMessage', msg);
  });

  socket.on('disconnecting', () => {
    const joinedRooms = [...socket.rooms].filter(r => r !== socket.id);
    joinedRooms.forEach(roomId => {
      const room = rooms[roomId];
      if (!room) return;
      delete room.players[socket.id];
      io.to(roomId).emit('playersUpdate', Object.values(room.players).map(p => p.name));
      // Optionally: clean up empty rooms
      if (Object.keys(room.players).length === 0) delete rooms[roomId];
    });
    console.log('disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on ' + PORT));
