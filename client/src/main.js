import { io } from "socket.io-client";
import { Renderer } from "./renderer.js";

const socket = io();
const renderer = new Renderer('game-canvas');

let players = {};
let myId = null;
let lastState = 'idle'; // Track state for emission

// Battle Zone Obstacles (matching renderer.js drawBattleZone)
const BATTLE_OBSTACLES = [
    { x: 200, y: 150, width: 80, height: 80 },  // Top-left
    { x: 520, y: 150, width: 80, height: 80 },  // Top-right
    { x: 200, y: 370, width: 80, height: 80 },  // Bottom-left
    { x: 520, y: 370, width: 80, height: 80 },  // Bottom-right
    { x: 260, y: 260, width: 80, height: 80 },  // Center-left
    { x: 460, y: 260, width: 80, height: 80 },  // Center-right
];

// Game State
let isLoggedIn = false;
let myUsername = "";
let myPassword = ""; // Store for auto-relogin
let myMoney = 0;
let houses = {};
let currentDistrict = "plaza";

// UI Elements (Early bind for auth)
const loginOverlay = document.getElementById('login-overlay');
const uiLayer = document.getElementById('ui-layer');
const authError = document.getElementById('auth-error');

// Input State
const keys = {
    w: false,
    a: false,
    s: false,
    d: false,
    ArrowUp: false,
    ArrowLeft: false,
    ArrowDown: false,
    ArrowRight: false,
    e: false,
    space: false
};

// Socket Events
socket.on('connect', () => {
    console.log('Connected to server');
    myId = socket.id;

    // Auto-relogin check
    if (isLoggedIn && myUsername && myPassword) {
        console.log("Attempting auto-relogin...");
        socket.emit('login', { username: myUsername, password: myPassword });
    }
});

socket.on('authError', (msg) => {
    authError.textContent = msg;
});

socket.on('loginSuccess', (data) => {
    isLoggedIn = true;
    myUsername = data.username;
    myId = data.playerId;
    players[myId] = data;

    // Fallback if server doesn't send money initially (it should)
    myMoney = data.money || 0;

    // Load items from server
    if (data.items && Array.isArray(data.items)) {
        SHOP_ITEMS.length = 0;
        SHOP_ITEMS.push(...data.items);
        console.log('Loaded items:', SHOP_ITEMS);
    }

    loginOverlay.style.display = 'none';
    uiLayer.style.display = 'block';
    console.log("Logged in as", data.username);

    // Initial Render of UI
    updateStatsUI();

    // Update local district to match server
    currentDistrict = data.district;
});

socket.on('updateMoney', (amount) => {
    myMoney = amount;
    updateStatsUI();
});

socket.on('houseData', (data) => {
    houses = data;
});

socket.on('houseUpdate', (house) => {
    houses[house.id] = house;
});

socket.on('currentPlayers', (serverPlayers) => {
    // Only process if logged in
    if (!isLoggedIn) return;

    // Convert array to object if needed, or handle as provided
    // Server now sends array for initial list
    players = {};
    if (Array.isArray(serverPlayers)) {
        serverPlayers.forEach(p => players[p.playerId] = p);
    } else {
        players = serverPlayers;
    }
});

// Helper to update player state without losing properties
function updatePlayer(playerData) {
    if (!playerData || !playerData.playerId) return;
    if (players[playerData.playerId]) {
        players[playerData.playerId] = { ...players[playerData.playerId], ...playerData };
    } else {
        players[playerData.playerId] = playerData;
    }
}

socket.on('newPlayer', (player) => {
    updatePlayer(player);
});

socket.on('playerMoved', (player) => {
    updatePlayer(player);
});

socket.on('playerUpdate', (updatedPlayer) => {
    updatePlayer(updatedPlayer);
});

socket.on('playerDisconnected', (id) => {
    delete players[id];
});

socket.on('playerChangedDistrict', (newPlayersList) => {
    // Keep local player if in the list, or clear if totally new district
    const oldPlayers = { ...players };
    players = {};
    newPlayersList.forEach(p => {
        if (oldPlayers[p.playerId]) {
            players[p.playerId] = { ...oldPlayers[p.playerId], ...p };
        } else {
            players[p.playerId] = p;
        }
    });

    // We don't update districtSelect automatically for houses yet to keep it simple,
    // or we can detect it from context if the server sent the Room Name.
    // For now, let's assume `joinDistrict` updates the selector, but `enterHouse` doesn't change it visually yet.
});

socket.on('chatMessage', (data) => {
    addChatMessage(data);
});

socket.on('playerHit', ({ targetId, hp, attackerId }) => {
    if (players[targetId]) {
        players[targetId].hp = hp;
    }
});

socket.on('playerRespawned', () => {
    console.log('You respawned!');
});

// Auth Logic
const loginBtn = document.getElementById('login-btn');
const registerBtn = document.getElementById('register-btn');
const usernameInput = document.getElementById('username-input');
const passwordInput = document.getElementById('password-input');

loginBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();
    if (username && password) {
        myPassword = password; // Save for reconnect
        socket.emit('login', { username, password });
    }
});

registerBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();
    if (username && password) {
        myPassword = password; // Save for reconnect
        socket.emit('register', { username, password });
    }
});

// UI Logic
// UI Logic
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');

// Map UI Logic
const mapModal = document.getElementById('map-modal');
const openMapBtn = document.getElementById('open-map-btn');
const closeMapBtn = document.getElementById('close-map-btn');
const mapNodes = document.querySelectorAll('.map-node');

if (openMapBtn) {
    openMapBtn.addEventListener('click', () => {
        mapModal.style.display = 'flex';
        // Release keys when opening menu to prevent stuck movement
        Object.keys(keys).forEach(k => keys[k] = false);
    });
}

if (closeMapBtn) {
    closeMapBtn.addEventListener('click', () => {
        mapModal.style.display = 'none';
    });
}

mapNodes.forEach(node => {
    node.addEventListener('click', () => {
        const target = node.getAttribute('data-target');
        if (target) {
            socket.emit('joinDistrict', target);
            currentDistrict = target;
            mapModal.style.display = 'none';
            // Focus game canvas or blur button to ensure keyboard works
            document.activeElement.blur();
        }
    });
});

chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const text = chatInput.value.trim();
        if (text) {
            socket.emit('chatMessage', text);
            chatInput.value = '';
        }
    }
    e.stopPropagation(); // Prevent WASD form moving while typing
});

function addChatMessage(data) {
    const div = document.createElement('div');
    div.className = 'message';
    div.style.borderLeft = `3px solid ${data.color}`;

    // Safety escape
    const safeText = document.createTextNode(data.text);

    const idSpan = document.createElement('span');
    idSpan.className = 'message-id';
    idSpan.textContent = data.id.substr(0, 4);

    div.appendChild(idSpan);
    div.appendChild(safeText);

    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Shop UI Logic
const shopModal = document.getElementById('shop-modal');
const shopItemsContainer = document.getElementById('shop-items');
const closeShopBtn = document.getElementById('close-shop-btn');

// Items will be loaded from server
let SHOP_ITEMS = [
    { id: 'sword', name: 'Iron Sword', price: 100, desc: "Melee Damage", range: 50 },
    { id: 'gun', name: 'Blaster', price: 250, desc: "Ranged Damage", range: 400 },
    { id: 'hp', name: 'Healer', price: 300, desc: "Heal Short Range", range: 25 }
];

function openShop() {
    shopModal.style.display = 'flex';
    shopItemsContainer.innerHTML = '';

    SHOP_ITEMS.forEach(item => {
        const div = document.createElement('div');
        div.className = 'shop-item';
        div.innerHTML = `
            <div>
                <strong>${item.name}</strong><br>
                <small>${item.desc}</small>
            </div>
            <div>
                <span>${item.price} Coins</span>
                <button onclick="buyItem('${item.id}')">Buy</button>
            </div>
        `;
        shopItemsContainer.appendChild(div);
    });
}

window.buyItem = function (itemId) {
    socket.emit('buyItem', itemId);
};

if (closeShopBtn) {
    closeShopBtn.addEventListener('click', () => {
        shopModal.style.display = 'none';
    });
}

socket.on('itemBought', (res) => {
    if (res.success) {
        alert("Bought " + res.item.name + "!");
        // Maybe close shop or stay open?
    } else {
        alert("Failed: " + res.message);
    }
});

// Battle Setup UI Logic
const battleModal = document.getElementById('battle-modal');
const enterBattleBtn = document.getElementById('enter-battle-btn');

const closeBattleBtn = document.getElementById('close-battle-btn');
const modeRadios = document.querySelectorAll('input[name="mode"]');

function openBattleSetup() {
    // Skip modal and enter Deathmatch directly
    socket.emit('joinBattle', { mode: 'solo', team: null });
}

if (closeBattleBtn) {
    closeBattleBtn.addEventListener('click', () => {
        battleModal.style.display = 'none';
    });
}


// Quiz UI Logic
const quizModal = document.getElementById('quiz-modal');
const quizInput = document.getElementById('quiz-input');
const submitQuizBtn = document.getElementById('submit-quiz-btn');
const closeQuizBtn = document.getElementById('close-quiz-btn');
const quizQuestion = document.getElementById('quiz-question');
const quizFeedback = document.getElementById('quiz-feedback');

let currentQuizAnswer = 0;

function startQuiz() {
    quizModal.style.display = 'flex';
    quizFeedback.textContent = '';
    quizInput.value = '';

    // Generate simple question
    const num1 = Math.floor(Math.random() * 10);
    const num2 = Math.floor(Math.random() * 10);
    currentQuizAnswer = num1 + num2;

    quizQuestion.textContent = `${num1} + ${num2} = ?`;

    // Store question parts if we send them to server for validation
    quizModal.setAttribute('data-q', JSON.stringify({ num1, num2 }));

    quizInput.focus();
}

if (submitQuizBtn) {
    submitQuizBtn.addEventListener('click', () => {
        const val = quizInput.value;
        if (val === '') return;

        const qData = JSON.parse(quizModal.getAttribute('data-q'));

        socket.emit('submitQuizAnswer', {
            questionId: 'local',
            answer: {
                num1: qData.num1,
                num2: qData.num2,
                answer: val
            }
        });
    });
}

if (closeQuizBtn) {
    closeQuizBtn.addEventListener('click', () => {
        quizModal.style.display = 'none';
    });
}

socket.on('quizResult', (result) => {
    if (result.success) {
        quizFeedback.textContent = `Correct! +${result.reward} Coins`;
        quizFeedback.style.color = '#00ff00';
        setTimeout(() => {
            quizModal.style.display = 'none';
        }, 1500);
    } else {
        quizFeedback.textContent = "Incorrect, try again.";
        quizFeedback.style.color = '#ff4444';
    }
});

// UI Helpers
function updateStatsUI() {
    // We'll create a stats div if it doesn't exist
    let statsDiv = document.getElementById('stats-display');
    if (!statsDiv) {
        statsDiv = document.createElement('div');
        statsDiv.id = 'stats-display';
        document.getElementById('ui-layer').appendChild(statsDiv);
    }
    statsDiv.innerHTML = `
        <div>You: ${myUsername}</div>
        <div>Coins: ${myMoney}</div>
    `;
}

// Interaction Logic (Game Loop Update)
function checkInteractions() {
    // Hide prompt by default each frame
    promptDiv.style.display = 'none';

    // 1. Housing Interactions
    if (currentDistrict === 'housing') {
        const me = players[myId];
        if (!me) return;

        Object.values(houses).forEach(house => {
            const dx = me.x - house.x;
            const dy = me.y - house.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < 50) {
                // Close enough to interact
                showInteractionPrompt(house);

                if (keys.e) {
                    keys.e = false; // Consume key press
                    handleHouseInteraction(house);
                }
            }
        });
    }

    // 2. School Interactions
    if (currentDistrict === 'school') {
        const me = players[myId];
        if (!me) return;

        // Blackboard Position (Hardcoded in Renderer as 350, 100 100x60)
        // Center approx 400, 130
        const bx = 400;
        const by = 130;
        const dist = Math.sqrt((me.x - bx) ** 2 + (me.y - by) ** 2);

        if (dist < 60) {
            promptDiv.style.display = 'block';
            promptDiv.style.left = bx + 'px';
            promptDiv.style.top = (by - 50) + 'px';
            promptDiv.textContent = "[E] Start Math Quiz";

            if (keys.e) {
                keys.e = false;
                startQuiz();
            }
        }
    }

    // 3. Arena Interactions
    if (currentDistrict === 'arena') {
        const me = players[myId];
        if (!me) return;

        // Weapon Shop (100, 100) 120x80 -> Center ~160, 140
        const sx = 160, sy = 140;
        const dShop = Math.sqrt((me.x - sx) ** 2 + (me.y - sy) ** 2);

        if (dShop < 70) {
            promptDiv.style.display = 'block';
            promptDiv.style.left = sx + 'px';
            promptDiv.style.top = (sy - 50) + 'px';
            promptDiv.textContent = "[E] Open Weapon Shop";

            if (keys.e) {
                keys.e = false;
                openShop();
            }
        }

        // Battle Gate (600, 100) 100x120 -> Center ~650, 160
        const gx = 650, gy = 160;
        const dGate = Math.sqrt((me.x - gx) ** 2 + (me.y - gy) ** 2);

        if (dGate < 80) {
            promptDiv.style.display = 'block';
            promptDiv.style.left = gx + 'px';
            promptDiv.style.top = (gy - 50) + 'px';
            promptDiv.textContent = "[E] Enter Battle";

            if (keys.e) {
                keys.e = false;
                openBattleSetup();
            }
        }
    }

    // 4. Brawl Stars District Interactions
    if (currentDistrict === 'brawl_stars') {
        const me = players[myId];
        if (!me) return;

        const cx = 400, cy = 300;
        const dist = Math.sqrt((me.x - cx) ** 2 + (me.y - cy) ** 2);

        if (dist < 100) {
            promptDiv.style.display = 'block';
            promptDiv.style.left = cx + 'px';
            promptDiv.style.top = (cy - 120) + 'px';
            promptDiv.textContent = "[E] ENTER BATTLE (DEATHMATCH)";

            if (keys.e) {
                keys.e = false;
                // Instead of broken redirect, join Deathmatch battle
                socket.emit('joinBattle', { mode: 'solo', team: null });
            }
        }
    }

}

// Battle Zone Attack Logic
function handleAttack() {
    if (currentDistrict !== 'arena_battle') return;

    const me = players[myId];
    if (!me || !me.equipment) return;

    if (keys.space) {
        keys.space = false; // Consume

        // Get weapon range from SHOP_ITEMS
        const weapon = SHOP_ITEMS.find(i => i.id === me.equipment);
        const range = weapon ? weapon.range : 50;

        // Simple attack - check nearby players
        Object.values(players).forEach(target => {
            if (target.playerId === myId) return;

            const dx = target.x - me.x;
            const dy = target.y - me.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < range) {
                socket.emit('playerAttack', { targetId: target.playerId });
            }

        });
    }
}


// Update local district tracking
socket.on('setDistrict', (districtName) => {
    currentDistrict = districtName;
    console.log("Joined district:", districtName);

    // Play Music
    playDistrictMusic(districtName);

    // Reset all movement keys to prevent sticking
    Object.keys(keys).forEach(k => keys[k] = false);

    // Map UI might want to highlight current district but for now we just close map on join.
    if (mapModal) mapModal.style.display = 'none';
});

// Editor State
let isEditing = false;
let selectedItemType = 0;
const editorItems = [
    { type: 'crate', color: '#8B4513' },
    { type: 'table', color: '#DEB887' },
    { type: 'plant', color: '#228B22' }
];

// Input Handlers
window.addEventListener('keydown', (e) => {
    // If typing in chat, ignore game controls
    if (document.activeElement === chatInput) return;

    const key = e.key.toLowerCase();

    // Movement Keys (WASD + Arrows)
    if (key === 'w' || e.key === 'ArrowUp') keys.w = keys.ArrowUp = true;
    if (key === 'a' || e.key === 'ArrowLeft') keys.a = keys.ArrowLeft = true;
    if (key === 's' || e.key === 'ArrowDown') keys.s = keys.ArrowDown = true;
    if (key === 'd' || e.key === 'ArrowRight') keys.d = keys.ArrowRight = true;

    // Actions
    if (key === 'e') keys.e = true;
    if (e.key === ' ') keys.space = true;

    // Toggle Editor 'b'
    if (key === 'b') toggleEditor();

    // Opening/Closing Map (M)
    if (key === 'm') {
        const mapModal = document.getElementById('map-modal');
        if (mapModal) {
            mapModal.style.display = mapModal.style.display === 'block' ? 'none' : 'block';
        }
    }
});

function toggleEditor() {
    isEditing = !isEditing;
    const toolbar = document.getElementById('editor-toolbar');
    if (toolbar) toolbar.style.display = isEditing ? 'flex' : 'none';

    if (isEditing) updateEditorUI();
}

// UI for Editor
const editorToolbar = document.createElement('div');
editorToolbar.id = 'editor-toolbar';
document.getElementById('ui-layer').appendChild(editorToolbar);

function updateEditorUI() {
    editorToolbar.innerHTML = '';
    editorItems.forEach((item, idx) => {
        const div = document.createElement('div');
        div.className = `editor-item ${idx === selectedItemType ? 'selected' : ''}`;
        div.style.backgroundColor = item.color;
        div.onclick = () => {
            selectedItemType = idx;
            updateEditorUI();
        };
        editorToolbar.appendChild(div);
    });
}

// Mouse Click for Placement
renderer.canvas.addEventListener('mousedown', (e) => {
    if (!isEditing) return;

    const rect = renderer.canvas.getBoundingClientRect();
    const offset = renderer.getOffset();

    // Adjust mouse coordinates by removing the centering offset
    const x = e.clientX - rect.left - offset.x;
    const y = e.clientY - rect.top - offset.y;

    // Find house containing our Player (Simplification: Check mouse pos vs House pos)
    let targetHouseId = null;
    Object.values(houses).forEach(h => {
        if (x >= h.x - 40 && x <= h.x + 40 &&
            y >= h.y - 40 && y <= h.y + 40) {
            targetHouseId = h.id;
        }
    });

    if (targetHouseId) {
        // Validation: Must be OUR house
        if (houses[targetHouseId].owner === myUsername) {
            const itemDef = editorItems[selectedItemType];
            socket.emit('placeFurniture', {
                houseId: targetHouseId,
                item: {
                    type: itemDef.type,
                    color: itemDef.color,
                    x: x,
                    y: y
                }
            });
        }
    }
});

// Key release listeners
window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();

    if (key === 'w' || e.key === 'ArrowUp') keys.w = keys.ArrowUp = false;
    if (key === 'a' || e.key === 'ArrowLeft') keys.a = keys.ArrowLeft = false;
    if (key === 's' || e.key === 'ArrowDown') keys.s = keys.ArrowDown = false;
    if (key === 'd' || e.key === 'ArrowRight') keys.d = keys.ArrowRight = false;

    if (key === 'e') keys.e = false;
    if (e.key === ' ') keys.space = false;
});

// Reset keys when window loses focus to prevent sticking
window.addEventListener('blur', () => {
    Object.keys(keys).forEach(k => keys[k] = false);
});
function handleHouseInteraction(house) {
    if (!house.owner) {
        // Buy?
        if (myMoney >= house.price) {
            socket.emit('buyHouse', house.id);
        } else {
            alert("Not enough money!");
        }
    } else {
        // Enter?
        socket.emit('enterHouse', house.id);
    }
}

// Display Feedback
const promptDiv = document.createElement('div');
promptDiv.id = 'interaction-prompt';
promptDiv.style.position = 'absolute';
promptDiv.style.display = 'none';
promptDiv.style.background = 'rgba(0,0,0,0.8)';
promptDiv.style.color = 'white';
promptDiv.style.padding = '5px 10px';
promptDiv.style.borderRadius = '4px';
promptDiv.style.transform = 'translate(-50%, -100%)';
promptDiv.style.zIndex = '100'; // Ensure it's above other UI
document.getElementById('ui-layer').appendChild(promptDiv);

function showInteractionPrompt(house) {
    promptDiv.style.display = 'block';
    // Position above house
    // Translate game coords to screen coords (Need to add offset back!)
    const offset = renderer.getOffset();

    promptDiv.style.left = (house.x + offset.x) + 'px';
    promptDiv.style.top = (house.y - 20 + offset.y) + 'px';

    if (!house.owner) {
        promptDiv.textContent = `[E] Buy ${house.id} (${house.price} coins)`;
    } else {
        promptDiv.textContent = `[E] Enter ${house.owner}'s House`;
    }
}

// Collision Detection Helper
function checkCollision(x, y, radius = 15) {
    // Check battle zone obstacles
    if (currentDistrict === 'arena_battle') {
        for (const obstacle of BATTLE_OBSTACLES) {
            // Check if circle (player) intersects with rectangle (obstacle)
            const closestX = Math.max(obstacle.x, Math.min(x, obstacle.x + obstacle.width));
            const closestY = Math.max(obstacle.y, Math.min(y, obstacle.y + obstacle.height));

            const distanceX = x - closestX;
            const distanceY = y - closestY;
            const distanceSquared = (distanceX * distanceX) + (distanceY * distanceY);

            if (distanceSquared < (radius * radius)) {
                return true; // Collision detected
            }
        }
    }
    return false; // No collision
}

// Game Loop
const SPEED = 5;

function update() {
    if (!myId || !players[myId]) return;

    // Reset prompt (it's re-shown in checkInteractions if close)
    promptDiv.style.display = 'none';

    // Handle Interactions
    checkInteractions();
    handleAttack();

    let moved = false;
    const player = players[myId];

    // Prevent movement if quiz is open
    if (quizModal && quizModal.style.display === 'flex') return;

    // Calculate new position
    let newX = player.x;
    let newY = player.y;

    if (keys.w || keys.ArrowUp) newY -= SPEED;
    if (keys.s || keys.ArrowDown) newY += SPEED;
    if (keys.a || keys.ArrowLeft) newX -= SPEED;
    if (keys.d || keys.ArrowRight) newX += SPEED;

    // Check if new position would collide with obstacles
    const wouldCollide = checkCollision(newX, newY);

    if (!wouldCollide) {
        // Only update position if no collision
        if (newX !== player.x || newY !== player.y) {
            player.x = newX;
            player.y = newY;
            moved = true;
        }
    } else {
        // Try moving only on one axis if diagonal movement is blocked (sliding)
        if (!checkCollision(newX, player.y)) {
            player.x = newX;
            moved = true;
        } else if (!checkCollision(player.x, newY)) {
            player.y = newY;
            moved = true;
        }
    }

    const newState = moved ? 'walking' : 'idle';
    player.state = newState;

    if (moved || newState !== lastState) {
        // Throttle updates to ~30ms to avoid flooding socket
        const now = Date.now();
        if (!player.lastMoveTime || now - player.lastMoveTime > 30 || newState !== lastState) {
            socket.emit('playerMovement', {
                x: player.x,
                y: player.y,
                state: newState
            });
            player.lastMoveTime = now;
            lastState = newState;
        }

        // Boundary Checks for Inter-District Travel
        if (moved) checkDistrictBoundaries(player);
    }
}

// --- AUDIO SYSTEM ---
const AUDIO_FILES = {
    'plaza': '/audio/Plaza.mp3',
    'housing': '/audio/Housing.mp3',
    'arena': '/audio/Arena.mp3',
    'school': '/audio/School.mp3'
};
const audioElements = {};
let currentAudio = null;

// Preload audio objects
Object.keys(AUDIO_FILES).forEach(key => {
    const audio = new Audio(AUDIO_FILES[key]);
    audio.loop = true;
    audio.volume = 0.5;
    audioElements[key] = audio;
});

function playDistrictMusic(districtName) {
    // Stop current
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
    }

    // Play new
    // Note: Browsers block autoplay. This might fail until user interacts.
    // We swallow errors to prevent console spam.
    const newAudio = audioElements[districtName];
    if (newAudio) {
        currentAudio = newAudio;
        newAudio.play().catch(e => console.log("Audio autoplay blocked, waiting for interaction"));
    }
}

// Ensure audio starts on first click if blocked
window.addEventListener('click', () => {
    if (currentAudio && currentAudio.paused) {
        currentAudio.play().catch(e => { });
    }
}, { once: true });


// --- TRANSITION LOGIC ---
let isTransitioning = false;
let transitionTimer = null;

// Map Topology: [Current] -> [Direction] -> [Target]
const DISTRICT_MAP = {
    'plaza': { left: 'housing', right: 'arena', top: 'school' },
    'housing': { right: 'plaza' },
    'arena': { left: 'plaza' },
    'school': { bottom: 'plaza' }
};

function checkDistrictBoundaries(player) {
    if (isTransitioning) return; // Block checks during transition cooldown

    const W = 800; // World Width
    const H = 600; // World Height
    const OFFSET = 75; // Safe spawn offset (increased from 50 to prevent immediate re-trigger)

    let target = null;
    let spawn = null;

    if (player.x < 0) {
        target = DISTRICT_MAP[currentDistrict]?.left;
        spawn = { x: W - OFFSET, y: player.y };
    } else if (player.x > W) {
        target = DISTRICT_MAP[currentDistrict]?.right;
        spawn = { x: OFFSET, y: player.y };
    } else if (player.y < 0) {
        target = DISTRICT_MAP[currentDistrict]?.top;
        spawn = { x: player.x, y: H - OFFSET };
    } else if (player.y > H) {
        target = DISTRICT_MAP[currentDistrict]?.bottom;
        spawn = { x: player.x, y: OFFSET };
    }

    if (target) {
        // Stop movement to prevent bouncing
        keys.w = keys.a = keys.s = keys.d = false;

        // Set Transition Flag
        isTransitioning = true;

        // IMMEDIATE CLIENT-SIDE SNAP: Move player to safe spawn to prevent double-trigger
        // after the cooldown expires.
        player.x = spawn.x;
        player.y = spawn.y;

        socket.emit('joinDistrict', target, spawn);
        currentDistrict = target;
        console.log(`Traveling to ${target} at`, spawn);

        // Play Music
        playDistrictMusic(target);

        // Clear Transition Flag after cooldown (500ms)
        if (transitionTimer) clearTimeout(transitionTimer);
        transitionTimer = setTimeout(() => {
            isTransitioning = false;
        }, 500);

    } else {
        // Limit to bounds if no exit
        if (player.x < 0) player.x = 0;
        if (player.x > W) player.x = W;
        if (player.y < 0) player.y = 0;
        if (player.y > H) player.y = H;
    }
}

function loop() {
    try {
        update();
        // Pass houses for rendering
        // we pass currentDistrict to let renderer know what to draw
        const renderHouses = (currentDistrict === 'housing') ? houses : {};
        renderer.drawGame(players, renderHouses, currentDistrict);
    } catch (e) {
        console.error("Game Loop Error:", e);
    }
    requestAnimationFrame(loop);
}

loop();
