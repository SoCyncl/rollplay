const socket = io(); // same origin (works locally and on Render)

const joinDiv = document.getElementById('join');
const gameDiv = document.getElementById('game');

const roomInput = document.getElementById('room');
const nameInput = document.getElementById('name');
const joinBtn = document.getElementById('joinBtn');

const playersEl = document.getElementById('players');
const textEl = document.getElementById('text');
const sendBtn = document.getElementById('sendBtn');
const messagesEl = document.getElementById('messages');

let currentRoom = null;

joinBtn.onclick = () => {
  const roomId = roomInput.value.trim();
  const name = nameInput.value.trim();
  if (!roomId || !name) {
    alert('Enter room + name');
    return;
  }
  currentRoom = roomId;
  socket.emit('joinRoom', { roomId, name });
};

sendBtn.onclick = () => {
  const text = textEl.value.trim();
  if (!text) return;
  socket.emit('sendMessage', { roomId: currentRoom, text });
  textEl.value = '';
};

socket.on('roomState', (room) => {
  // joined, show UI
  joinDiv.style.display = 'none';
  gameDiv.style.display = 'block';

  // show existing messages
  messagesEl.innerHTML = '';
  room.messages.forEach(addMessage);
});

socket.on('playersUpdate', (names) => {
  playersEl.textContent = `Players: ${names.join(', ')}`;
});

socket.on('newMessage', (msg) => {
  addMessage(msg);
});

function addMessage({ name, text }) {
  const div = document.createElement('div');
  div.innerHTML = `<strong>${escapeHtml(name)}:</strong> ${escapeHtml(text)}`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}
