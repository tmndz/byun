import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static(path.join(__dirname, '../dist')));

// MongoDB Setup
const MONGO_URL = process.env.MONGODB_URL || 'mongodb://localhost:27017/world-of-districts';
const client = new MongoClient(MONGO_URL);
let db, usersCol, housesCol, itemsCol;

async function initDB() {
    try {
        await client.connect();
        console.log("Connected to MongoDB");
        db = client.db();
        usersCol = db.collection('users');
        housesCol = db.collection('houses');
        itemsCol = db.collection('items');

        // Initial Data Check & Migration
        const itemsCount = await itemsCol.countDocuments();
        if (itemsCount === 0) {
            console.log("Initializing items in MongoDB...");
            const initialItems = JSON.parse(fs.readFileSync(path.join(__dirname, 'initial_data', 'items.json'), 'utf8'));
            await itemsCol.insertMany(initialItems);
        }

        const housesCount = await housesCol.countDocuments();
        if (housesCount === 0) {
            console.log("Initializing houses in MongoDB...");
            const initialHousesObj = JSON.parse(fs.readFileSync(path.join(__dirname, 'initial_data', 'houses.json'), 'utf8'));
            const initialHousesArr = Object.values(initialHousesObj);
            await housesCol.insertMany(initialHousesArr);
        }

        // We don't necessarily need to pre-populate users, but we could migrate existing ones
        // if they existed in initial_data/users.json and were not in DB yet.
    } catch (err) {
        console.error("MongoDB Connection Error:", err);
    }
}

// Global variables for active state (Syncing from DB)
const players = {};
const socketUserMap = {};
const DISTRICTS = ['plaza', 'housing', 'arena', 'school', 'arena_battle'];

initDB().then(() => {
    io.on('connection', (socket) => {
        console.log('Client connected:', socket.id);

        socket.on('register', async ({ username, password }) => {
            const existing = await usersCol.findOne({ username });
            if (existing) {
                socket.emit('authError', 'Username already taken');
                return;
            }

            const newUser = {
                username,
                password, // Hash in real app!
                x: 400,
                y: 300,
                district: 'plaza',
                color: `hsl(${Math.random() * 360}, 70%, 50%)`,
                money: 1000,
                equipment: null
            };

            await usersCol.insertOne(newUser);
            loginUser(socket, username);
        });

        socket.on('login', async ({ username, password }) => {
            const user = await usersCol.findOne({ username });
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

        async function loginUser(socket, username) {
            const userData = await usersCol.findOne({ username });
            socketUserMap[socket.id] = username;
            players[socket.id] = {
                ...userData,
                playerId: socket.id,
                hp: 100,
                maxHp: 100
            };

            const district = players[socket.id].district;
            socket.join(district);

            const items = await itemsCol.find().toArray();
            const persistentHousesArr = await housesCol.find().toArray();
            const persistentHouses = {};
            persistentHousesArr.forEach(h => persistentHouses[h.id] = h);

            socket.emit('loginSuccess', {
                ...players[socket.id],
                playerId: socket.id,
                items: items
            });

            socket.emit('houseData', persistentHouses);

            const playersInDistrict = Object.values(players).filter(p => p.district === district);
            socket.emit('currentPlayers', playersInDistrict);
            socket.to(district).emit('newPlayer', players[socket.id]);
        }

        socket.on('disconnect', async () => {
            const username = socketUserMap[socket.id];
            if (username && players[socket.id]) {
                const p = players[socket.id];
                await usersCol.updateOne(
                    { username },
                    { $set: { x: p.x, y: p.y, district: p.district, money: p.money, equipment: p.equipment || null } }
                );

                const district = p.district;
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
            if (!DISTRICTS.includes(newDistrict)) {
                // Check if it's a house
                if (!newDistrict.startsWith('house_')) return;
            }
            handleDistrictChange(socket, newDistrict, spawnPos);
        });

        socket.on('buyHouse', async (plotId) => {
            const player = players[socket.id];
            if (!player) return;

            const house = await housesCol.findOne({ id: plotId });
            if (house && !house.owner && player.money >= house.price) {
                player.money -= house.price;
                await housesCol.updateOne({ id: plotId }, { $set: { owner: player.username } });
                await usersCol.updateOne({ username: player.username }, { $set: { money: player.money } });

                const updatedHouse = await housesCol.findOne({ id: plotId });
                io.emit('houseUpdate', updatedHouse);
                socket.emit('updateMoney', player.money);

                io.to('housing').emit('chatMessage', {
                    id: 'SYSTEM',
                    text: `${player.username} bought ${plotId}!`,
                    color: '#ffff00'
                });
            }
        });

        socket.on('enterHouse', (plotId) => {
            const houseRoom = `house_${plotId}`;
            handleDistrictChange(socket, houseRoom);
        });

        socket.on('leaveHouse', () => {
            handleDistrictChange(socket, 'housing');
        });

        socket.on('placeFurniture', async ({ houseId, item }) => {
            const house = await housesCol.findOne({ id: houseId });
            const player = players[socket.id];
            if (house && player && house.owner === player.username) {
                await housesCol.updateOne(
                    { id: houseId },
                    { $push: { furniture: item } }
                );
                const updatedHouse = await housesCol.findOne({ id: houseId });
                io.emit('houseUpdate', updatedHouse);
            }
        });

        socket.on('submitQuizAnswer', async ({ answer }) => {
            const player = players[socket.id];
            if (!player) return;

            const { num1, num2, answer: playerAnswer } = answer;
            const correctAnswer = num1 + num2;

            if (parseInt(playerAnswer) === correctAnswer) {
                player.money += 10;
                await usersCol.updateOne({ username: player.username }, { $set: { money: player.money } });
                socket.emit('updateMoney', player.money);
                socket.emit('quizResult', { success: true, reward: 10, newTotal: player.money });
            } else {
                socket.emit('quizResult', { success: false });
            }
        });

        socket.on('buyItem', async (itemId) => {
            const player = players[socket.id];
            if (!player) return;

            const item = await itemsCol.findOne({ id: itemId });
            if (item && player.money >= item.price) {
                player.money -= item.price;
                player.equipment = itemId;

                await usersCol.updateOne(
                    { username: player.username },
                    { $set: { money: player.money, equipment: itemId } }
                );

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
        });

        socket.on('joinBattle', ({ mode, team }) => {
            const player = players[socket.id];
            if (!player) return;

            player.hp = 100;
            player.maxHp = 100;
            player.mode = mode;
            player.team = team;

            handleDistrictChange(socket, 'arena_battle', { x: 400, y: 300 });

            io.to('arena_battle').emit('playerUpdate', player);
        });

        socket.on('playerAttack', async ({ targetId }) => {
            const attacker = players[socket.id];
            const target = players[targetId];

            if (!attacker || !target || attacker.district !== 'arena_battle' || target.district !== 'arena_battle') return;

            const items = await itemsCol.find().toArray();
            const weapon = items.find(i => i.id === attacker.equipment);
            const damage = weapon ? weapon.damage : 5;

            target.hp -= damage;
            io.to('arena_battle').emit('playerHit', { targetId, hp: target.hp, attackerId: socket.id });

            if (target.hp <= 0) {
                attacker.money += 50;
                await usersCol.updateOne({ username: attacker.username }, { $set: { money: attacker.money } });

                target.hp = 100;
                target.x = 400;
                target.y = 300;

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
                    id: player.username,
                    text: msg,
                    color: player.color
                });
            }
        });

        async function handleDistrictChange(socket, newRoom, spawnPos) {
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
                player.x = 400;
                player.y = 300;
            }

            if (DISTRICTS.includes(newRoom)) {
                await usersCol.updateOne({ username: player.username }, { $set: { district: newRoom, x: player.x, y: player.y } });
            }

            socket.join(newRoom);
            const roomPlayers = Object.values(players).filter(p => p.district === newRoom);
            socket.emit('playerChangedDistrict', roomPlayers);
            socket.to(newRoom).emit('newPlayer', player);
            socket.emit('setDistrict', newRoom);

            if (newRoom === 'housing') {
                const persistentHousesArr = await housesCol.find().toArray();
                const persistentHouses = {};
                persistentHousesArr.forEach(h => persistentHouses[h.id] = h);
                socket.emit('houseData', persistentHouses);
            }
        }
    });

    const PORT = process.env.PORT || 3000;
    httpServer.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
});
