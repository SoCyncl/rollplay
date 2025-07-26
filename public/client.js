// ==== GAME PAGE LOGIC ====
if (window.location.pathname.includes("game.html")) {
  socket.emit("joinRoom", { name, room });

  document.getElementById("room-code").textContent = `Room: ${room}`;

  // Hide phases initially
  document.getElementById("waiting").style.display = "none";
  document.getElementById("character-display").style.display = "none";
  document.getElementById("backstory-area").style.display = "none";
  document.getElementById("choose-container").style.display = "none";

  document.getElementById("submitBtn").addEventListener("click", () => {
    const race = document.getElementById("race").value;
    const cls = document.getElementById("class").value;
    const flair = document.getElementById("flair").value;
    const cname = document.getElementById("name").value;

    if (!race || !cls || !flair || !cname) {
      alert("Please fill in all fields!");
      return;
    }

    socket.emit("characterSubmitted", {
      room,
      answers: { race, class: cls, flair, cname }
    });

    document.getElementById("form-area").style.display = "none";
    document.getElementById("waiting").style.display = "block";
  });

  socket.on("traitAssignment", ({ result, chooseOwn, playerNames }) => {
    document.getElementById("waiting").style.display = "none";
    
    const finalResult = { ...result };
    const chooseFields = Object.entries(chooseOwn).filter(([_, v]) => v).map(([key]) => key);

    if (chooseFields.length === 0) {
      renderAssignedTraits(finalResult);
      return;
    }

    let chooseIndex = 0;
    const chooseContainer = document.getElementById("choose-container");
    chooseContainer.style.display = "block";

    function nextChoose() {
      const field = chooseFields[chooseIndex];
      const displayName = {
        race: "Race & Subrace",
        class: "Class & Subclass",
        flair: "Flair / Weapon",
        cname: "Name & Background"
      }[field];

      chooseContainer.innerHTML = `
        <h2>Choose a ${displayName}:</h2>
        <div class="character-card">
          <h3>Your Original:</h3>
          <p>${result[field]}</p>
        </div>
      `;

      playerNames.forEach(p => {
        if (p.id === socket.id) return; // Skip own options
        
        const card = document.createElement("div");
        card.className = "character-card";
        card.innerHTML = `
          <h3>From ${p.name}:</h3>
          <p>${p.values[field]}</p>
          <button class="choose-btn" data-value="${p.values[field]}">Select</button>
        `;
        chooseContainer.appendChild(card);
      });

      // Add event listeners to all choose buttons
      document.querySelectorAll(".choose-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          finalResult[field] = btn.dataset.value;
          chooseIndex++;
          if (chooseIndex < chooseFields.length) {
            nextChoose();
          } else {
            chooseContainer.style.display = "none";
            renderAssignedTraits(finalResult);
            socket.emit("traitsFinalized", finalResult);
          }
        });
      });
    }

    nextChoose();
  });

  function renderAssignedTraits(traits) {
    const container = document.getElementById("character-display");
    container.querySelector("#reveal-list").innerHTML = `
      <li><strong>Race & Subrace:</strong> ${traits.race}</li>
      <li><strong>Class & Subclass:</strong> ${traits.class}</li>
      <li><strong>Flair / Weapon:</strong> ${traits.flair}</li>
      <li><strong>Name & Background:</strong> ${traits.cname}</li>
    `;
    container.style.display = "block";

    document.getElementById("confirm-traits").addEventListener("click", () => {
      container.style.display = "none";
      socket.emit("confirmTraitsReady");
    });
  }

  // Backstory Writing Phase
  let countdownInterval;

  socket.on("beginBackstory", ({ traits }) => {
    document.getElementById("backstory-area").style.display = "block";
    document.getElementById("yourTraits").innerHTML = `
      <h3>Your Character Traits</h3>
      <ul>
        <li><strong>Race & Subrace:</strong> ${traits.race}</li>
        <li><strong>Class & Subclass:</strong> ${traits.class}</li>
        <li><strong>Flair / Weapon:</strong> ${traits.flair}</li>
        <li><strong>Name & Background:</strong> ${traits.cname}</li>
      </ul>
    `;

    // Start 15-minute timer
    let timeLeft = 15 * 60; // 15 minutes in seconds
    updateTimerDisplay(timeLeft);
    
    countdownInterval = setInterval(() => {
      timeLeft--;
      updateTimerDisplay(timeLeft);
      
      if (timeLeft <= 0) {
        clearInterval(countdownInterval);
        autoSubmitBackstory();
      }
    }, 1000);
  });

  function updateTimerDisplay(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const timer = document.getElementById("timer");
    timer.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;
    
    if (seconds <= 60) {
      timer.classList.add("timer-critical");
    } else if (seconds <= 180) {
      timer.classList.add("timer-warning");
    }
  }

  function submitBackstory() {
    const backstory = document.getElementById("backstoryText").value;
    if (!backstory.trim()) {
      alert("Please write a backstory before submitting!");
      return;
    }
    socket.emit("submitBackstory", { room, backstory });
    disableUI();
  }

  function disableUI() {
    document.getElementById("backstoryText").readOnly = true;
    document.getElementById("submit-backstory-btn").disabled = true;
    document.getElementById("status-message").textContent = "Submitted! Waiting for others...";
  }

  function autoSubmitBackstory() {
    const backstory = document.getElementById("backstoryText").value || "No backstory provided";
    socket.emit("submitBackstory", { room, backstory });
    disableUI();
  }

  document.getElementById("submit-backstory-btn").addEventListener("click", submitBackstory);

  socket.on("playerSubmitted", ({ count }) => {
    const totalPlayers = rooms[room]?.length || 0;
    document.getElementById("status-message").textContent = 
      `${count}/${totalPlayers} players have submitted their backstories`;
  });

  socket.on("allSubmitted", () => {
    clearInterval(countdownInterval);
    document.getElementById("status-message").textContent = 
      "All backstories submitted! Moving to presentation phase...";
    // window.location.href = `presentation.html?name=${name}&room=${room}`;
  });
}
