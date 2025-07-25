const socket = io(); // Only define once

// Common: Get URL params
const params = new URLSearchParams(window.location.search);
const name = params.get("name");
const room = params.get("room");

// ==== INDEX PAGE LOGIC ====
if (window.location.pathname.endsWith("index.html") || window.location.pathname === "/") {
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
    const userName = nameInput.value.trim();
    if (!roomId || !userName) {
      alert('Enter room + name');
      return;
    }
    currentRoom = roomId;
    socket.emit('joinRoom', { roomId, name: userName });
  };

  sendBtn.onclick = () => {
    const text = textEl.value.trim();
    if (!text || !currentRoom) return;
    socket.emit('sendMessage', { roomId: currentRoom, text });
    textEl.value = '';
  };

  socket.on('roomState', (room) => {
    joinDiv.style.display = 'none';
    gameDiv.style.display = 'block';
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
    return str.replace(/[&<>"']/g, m => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[m]));
  }

  socket.on("startGame", () => {
    if (name && currentRoom) {
      window.location.href = `game.html?name=${name}&room=${currentRoom}`;
    }
  });
}

// ==== GAME PAGE LOGIC ====
if (window.location.pathname.includes("game.html")) {
  socket.emit("joinRoom", { name, room }); // Join again on reload or direct link

  document.getElementById("room-code").textContent = `Room: ${room}`;

  document.getElementById("submitBtn").addEventListener("click", () => {
    const race = document.getElementById("race").value;
    const cls = document.getElementById("class").value;
    const flair = document.getElementById("flair").value;
    const cname = document.getElementById("name").value;

    socket.emit("characterSubmitted", {
      name,
      room,
      answers: { race, class: cls, flair, cname }
    });

    document.getElementById("form-area").style.display = "none";
    document.getElementById("waiting").style.display = "block";
  });

  socket.on("allSubmitted", () => {
    alert("Everyone submitted! Moving to the reveal...");
    // window.location.href = "reveal.html"; // Uncomment when you build it
  });

  socket.on("traitAssignment", ({ result, chooseOwn, playerNames }) => {
    const finalResult = { ...result };

    const chooseFields = Object.entries(chooseOwn)
      .filter(([_, v]) => v)
      .map(([key]) => key);

    if (chooseFields.length === 0) {
      // No "CHOOSE" fields, proceed immediately
      renderAssignedTraits(finalResult);
      return;
    }

    let chooseIndex = 0;

    function nextChoose() {
      const field = chooseFields[chooseIndex];
      const displayName = {
        race: "Race & Subrace",
        class: "Class & Subclass",
        flair: "Flair / Weapon",
        cname: "Name & Background"
      }[field];

      const chooseContainer = document.getElementById("choose-container");
      chooseContainer.innerHTML = `<h2>Choose a ${displayName} from another player:</h2>`;

      playerNames.forEach(p => {
        const value = p.values[field];
        const button = document.createElement("button");
        button.textContent = `${p.name}: ${value}`;
        button.onclick = () => {
          finalResult[field] = value;
          chooseIndex++;
          if (chooseIndex < chooseFields.length) {
            nextChoose();
          } else {
            chooseContainer.innerHTML = ""; // Clear UI
            renderAssignedTraits(finalResult);
            socket.emit("traitsFinalized", finalResult);
          }
        };
        chooseContainer.appendChild(button);
      });
    }

    nextChoose();
  });

function renderAssignedTraits(traits) {
  const container = document.getElementById("reveal-container");
  container.innerHTML = `
    <h2>Your Assigned Character</h2>
    <ul>
      <li><strong>Race & Subrace:</strong> ${traits.race}</li>
      <li><strong>Class & Subclass:</strong> ${traits.class}</li>
      <li><strong>Flair / Weapon:</strong> ${traits.flair}</li>
      <li><strong>Name & Background:</strong> ${traits.cname}</li>
    </ul>
    <button id="confirm-traits">Start Writing</button>
  `;
  container.style.display = "block";

  document.getElementById("confirm-traits").onclick = () => {
    container.style.display = "none";
    socket.emit("confirmTraitsReady");
  };
}

  
}
