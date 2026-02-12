const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const fs = require('fs');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
// MIDDLEWARE: Serve static files from the 'dist' directory
app.use(express.static(path.join(__dirname, '../dist')));

// Persistence Setup
const DATA_FILE = path.join(__dirname, 'data', 'users.json');
const HOUSES_FILE = path.join(__dirname, 'data', 'houses.json');
const ITEMS_FILE = path.join(__dirname, 'data', 'items.json');

// Helper to load/save
function loadData(file) {
    if (!fs.existsSync(file)) return {};
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { console.error(`Error reading ${file}:`, e); return {}; }
}

function saveData(file, data) {
    try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
    catch (e) { console.error(`Error writing ${file}:`, e); }
}

// Load initial state
let persistentUsers = loadData(DATA_FILE);
let persistentHouses = loadData(HOUSES_FILE);
let items = loadData(ITEMS_FILE);

// items.json is an array, ensure it's loaded as one
if (!Array.isArray(items)) items = [];

// Initialize Houses if empty
if (Object.keys(persistentHouses).length === 0) {
    // Create 4 default plots
    for (let i = 1; i <= 4; i++) {
        persistentHouses[`plot_${i}`] = {
            id: `plot_${i}`,
            x: 200 + (i * 150), // Spaced out
            y: 200,
            price: 500,
            owner: null,
            furniture: []
        };
    }
    saveData(HOUSES_FILE, persistentHouses);
}

// Active Game State (In-Memory)
const players = {};
// Socket ID -> Username mapping for quick lookup
const socketUserMap = {};

const DISTRICTS = ['plaza', 'housing', 'arena', 'school', 'arena_battle'];

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // NOTE: We no longer auto-spawn players. They must log in first.

    socket.on('register', ({ username, password }) => {
        if (persistentUsers[username]) {
            socket.emit('authError', 'Username already taken');
            return;
        }

        // Create new user
        persistentUsers[username] = {
            password, // In a real app, hash this!
            username,
            x: 400,
            y: 300,
            district: 'plaza',
            color: `hsl(${Math.random() * 360}, 70%, 50%)`,
            money: 1000 // Start with 1000 coins
        };
        saveData(DATA_FILE, persistentUsers);

        // Auto login after register
        loginUser(socket, username);
    });

    socket.on('login', ({ username, password }) => {
        const user = persistentUsers[username];
        if (!user || user.password !== password) {
            socket.emit('authError', 'Invalid username or password');
            return;
        }
        if (Object.values(socketUserMap).includes(username)) {
            socket.emit('authError', 'User already logged in');
            return;
        }

        loginUser(socket, username);
    });

    function loginUser(socket, username) {
        const userData = persistentUsers[username];

        // Map socket to user
        socketUserMap[socket.id] = username;

        // Add to active players
        players[socket.id] = {
            ...userData,
            playerId: socket.id, // Associate current socket ID
            hp: 100,             // Default HP
            maxHp: 100           // Default Max HP
        };

        // Join District
        const district = players[socket.id].district;
        socket.join(district);

        // Notify success
        socket.emit('loginSuccess', {
            ...players[socket.id],
            playerId: socket.id,
            items: items // Send items list
        });

        // Send House Data if relevant (simplified: send always for now)
        socket.emit('houseData', persistentHouses);

        // Standard Join Logic
        const playersInDistrict = Object.values(players).filter(p => p.district === district);
        socket.emit('currentPlayers', playersInDistrict);
        socket.to(district).emit('newPlayer', players[socket.id]);
    }

    socket.on('disconnect', () => {
        const username = socketUserMap[socket.id];
        if (username && players[socket.id]) {
            console.log('Player disconnected:', username);

            // Save latest state
            const p = players[socket.id];
            persistentUsers[username].x = p.x;
            persistentUsers[username].y = p.y;
            persistentUsers[username].district = p.district;
            // Money and equipment might have changed
            persistentUsers[username].money = p.money;
            persistentUsers[username].equipment = p.equipment || null;

            saveData(DATA_FILE, persistentUsers); // Persist to disk

            const district = p.district;

            // Cleanup active state
            delete players[socket.id];
            delete socketUserMap[socket.id];

            if (district) {
                io.to(district).emit('playerDisconnected', socket.id);
            }
        }
    });

    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            socket.to(players[socket.id].district).emit('playerMoved', players[socket.id]);
        }
    });

    socket.on('joinDistrict', (newDistrict, spawnPos) => {
        if (!DISTRICTS.includes(newDistrict)) return;
        handleDistrictChange(socket, newDistrict, spawnPos);
    });

    socket.on('buyHouse', (plotId) => {
        const dbHouse = persistentHouses[plotId];
        const player = players[socket.id];

        if (dbHouse && player && !dbHouse.owner && player.money >= dbHouse.price) {
            // Transaction
            player.money -= dbHouse.price;
            dbHouse.owner = player.username;

            // Persist
            saveData(HOUSES_FILE, persistentHouses);
            persistentUsers[player.username].money = player.money;
            saveData(DATA_FILE, persistentUsers);

            // Notify
            io.emit('houseUpdate', dbHouse); // Broadcast ownership change
            socket.emit('updateMoney', player.money);

            // System Message
            io.to('housing').emit('chatMessage', {
                id: 'SYSTEM',
                text: `${player.username} bought ${plotId}!`,
                color: '#ffff00'
            });
        }
    });

    socket.on('enterHouse', (plotId) => {
        // "Entering a house" is functionally just changing to a dynamic district room
        const houseRoom = `house_${plotId}`;
        handleDistrictChange(socket, houseRoom);
    });

    socket.on('placeFurniture', ({ houseId, item }) => {
        const dbHouse = persistentHouses[houseId];
        const player = players[socket.id];

        // Validate: House exists, Player exists, Player OWNS house
        if (dbHouse && player && dbHouse.owner === player.username) {
            // Add item
            dbHouse.furniture.push(item);
            saveData(HOUSES_FILE, persistentHouses);

            // Broadcast to everyone (or just people in housing/house)
            io.emit('houseUpdate', dbHouse);
        }
    });

    socket.on('leaveHouse', () => {
        handleDistrictChange(socket, 'housing');
    });

    socket.on('submitQuizAnswer', ({ questionId, answer }) => {
        const player = players[socket.id];
        if (!player) return;

        // Simple validation: Client sends "X + Y", Server validates result
        // For prototype: we blindly trust the math or re-calculate.
        // Let's implement stateless validation: client sends "5+3", answer 8.
        // Better: Server generates question? 
        // Plan said: "Let's do Server-side Validation".
        // IMPLEMENTATION: 
        // 1. Client requests 'getQuizQuestion'. Server sends {id: 1, text: "5 + 3", answer: 8} (stored in session?) 
        // or simpler: Client sends "5+3" and "8". Server Evals. (Insecure but fast for prototype).
        // Let's go with: Client generates local question, but Server validates simple math string.

        // Actually, simplest robust way for this step:
        // Client sends: { num1: 5, num2: 3, operation: '+', answer: 8 }
        // Server checks: 5 + 3 == 8.

        const { num1, num2, answer: playerAnswer } = answer;
        const correctAnswer = num1 + num2; // Only doing addition for now

        if (parseInt(playerAnswer) === correctAnswer) {
            player.money += 10;

            // Sync to persistent store
            if (persistentUsers[player.username]) {
                persistentUsers[player.username].money = player.money;
            }

            saveData(DATA_FILE, persistentUsers); // Persistence!

            socket.emit('updateMoney', player.money);
            socket.emit('quizResult', { success: true, reward: 10, newTotal: player.money });
        } else {
            socket.emit('quizResult', { success: false });
        }
    });

    socket.on('buyItem', (itemId) => {
        const player = players[socket.id];
        const item = items.find(i => i.id === itemId);

        if (player && item) {
            if (player.money >= item.price) {
                // Check if already owns? For weapons, maybe allow duplicates or unique?
                // Let's assume unique unique slot for now or simple inventory array.
                // Simple: "equipment" field string (only 1 weapon).

                player.money -= item.price;
                player.equipment = itemId; // Equip it

                // Persist
                if (persistentUsers[player.username]) {
                    persistentUsers[player.username].money = player.money;
                    persistentUsers[player.username].equipment = itemId;
                }
                saveData(DATA_FILE, persistentUsers);

                socket.emit('updateMoney', player.money);
                socket.emit('itemBought', { item: item, success: true });
                io.to(player.district).emit('chatMessage', {
                    id: 'SYSTEM',
                    text: `${player.username} bought a ${item.name}!`,
                    color: '#ffff00'
                });
            } else {
                socket.emit('itemBought', { success: false, message: "Not enough money" });
            }
        }
    });

    socket.on('joinBattle', ({ mode, team }) => {
        const player = players[socket.id];
        if (!player) return;

        // Set player combat stats
        player.hp = 100;
        player.maxHp = 100;
        player.mode = mode;
        player.team = team; // 'red', 'blue', or null for solo

        // Teleport to battle zone
        handleDistrictChange(socket, 'arena_battle', { x: 400, y: 300 });

        // Broadcast updated player to all clients
        io.emit('playerUpdate', player);
        socket.emit('battleJoined', { mode, team });
        io.to('arena_battle').emit('chatMessage', {
            id: 'SYSTEM',
            text: `${player.username} entered the arena!`,
            color: '#ff4444'
        });
    });

    socket.on('playerAttack', ({ targetId }) => {
        const attacker = players[socket.id];
        const target = Object.values(players).find(p => p.playerId === targetId);

        if (!attacker || !target) return;
        if (attacker.district !== 'arena_battle' || target.district !== 'arena_battle') return;

        // Check friendly fire
        if (attacker.mode === 'team' && attacker.team === target.team) return;

        // Get weapon damage
        const weapon = items.find(i => i.id === attacker.equipment);
        const damage = weapon ? weapon.damage : 10;

        // Apply damage
        target.hp = Math.max(0, target.hp - damage);

        // Broadcast updated target to all clients
        io.emit('playerUpdate', target);

        // Broadcast HP update
        io.to('arena_battle').emit('playerHit', {
            targetId: target.playerId,
            hp: target.hp,
            attackerId: attacker.playerId
        });

        // Check death
        if (target.hp <= 0) {
            // Award kill
            attacker.money += 50;
            if (persistentUsers[attacker.username]) {
                persistentUsers[attacker.username].money = attacker.money;
                saveData(DATA_FILE, persistentUsers);
            }

            // Respawn target
            target.hp = 100;
            target.x = 400;
            target.y = 300;

            // Broadcast respawned player
            io.emit('playerUpdate', target);

            io.to('arena_battle').emit('chatMessage', {
                id: 'SYSTEM',
                text: `${attacker.username} eliminated ${target.username}! +50 Coins`,
                color: '#ffaa00'
            });

            io.to(target.socketId).emit('playerRespawned');
            socket.emit('updateMoney', attacker.money);
        }
    });

    socket.on('chatMessage', (msg) => {
        const player = players[socket.id];
        if (player) {
            io.to(player.district).emit('chatMessage', {
                id: player.username, // Use username instead of socket ID now
                text: msg,
                color: player.color
            });
        }
    });

    function handleDistrictChange(socket, newRoom, spawnPos) {
        if (!players[socket.id]) return;
        const player = players[socket.id];
        const oldRoom = player.district;

        socket.leave(oldRoom);
        socket.to(oldRoom).emit('playerDisconnected', socket.id);

        player.district = newRoom;

        if (spawnPos) {
            player.x = spawnPos.x;
            player.y = spawnPos.y;
        } else if (oldRoom !== newRoom) {
            player.x = 400; // Default spawn
            player.y = 300;
        }

        // Persist district change only if it's a main district (not an interior)
        if (DISTRICTS.includes(newRoom)) {
            if (socketUserMap[socket.id]) {
                persistentUsers[socketUserMap[socket.id]].district = newRoom;
                saveData(DATA_FILE, persistentUsers);
            }
        }

        socket.join(newRoom);

        const roomPlayers = Object.values(players).filter(p => p.district === newRoom);
        socket.emit('playerChangedDistrict', roomPlayers);
        socket.to(newRoom).emit('newPlayer', player);

        // Tell the user they have changed districts/rooms
        socket.emit('setDistrict', newRoom);

        // If entering housing district, ensure they get house data
        if (newRoom === 'housing') {
            socket.emit('houseData', persistentHouses);
        }
    }
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
