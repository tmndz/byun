export class Renderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.offsetX = 0;
        this.offsetY = 0;
        this.resize();
        window.addEventListener('resize', () => this.resize());

        // Asset Loading (Placeholders for now)
        this.sprites = {
            player: new Image(),
            ground: new Image(),
            wall: new Image()
        };

        // Use absolute paths for assets in public folder
        const assetBase = '/sprites/';

        this.sprites.player.src = `${assetBase}player_sheet.png`;
        this.sprites.ground.src = `${assetBase}ground.png`;
        this.sprites.wall.src = `${assetBase}wall.png`;

        // Animation State Tracker
        this.playerAnimationStates = {};

        // Debug loading
        Object.keys(this.sprites).forEach(key => {
            this.sprites[key].onload = () => console.log(`Loaded sprite: ${key}`);
            this.sprites[key].onerror = () => console.error(`Failed to load sprite: ${key}`);
        });
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;

        // Calculate centering offset for 800x600 game world
        this.offsetX = (this.canvas.width - 800) / 2;
        this.offsetY = (this.canvas.height - 600) / 2;
    }

    getOffset() {
        return { x: this.offsetX, y: this.offsetY };
    }

    clear() {
        // Clear entire screen
        this.ctx.fillStyle = '#1a1a1a'; // Dark background for outside game area
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw Game Area Background (The 800x600 box)
        this.ctx.fillStyle = '#222';
        this.ctx.fillRect(this.offsetX, this.offsetY, 800, 600);

        // Clip to game area to prevent drawing outside
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(this.offsetX, this.offsetY, 800, 600);
        this.ctx.clip();

        // Translate context so (0,0) is at top-left of game area
        this.ctx.translate(this.offsetX, this.offsetY);
    }

    drawPlayers(players) {
        const now = Date.now();

        Object.values(players).forEach(player => {
            // Animation State Management
            if (!this.playerAnimationStates[player.playerId]) {
                this.playerAnimationStates[player.playerId] = {
                    frame: 0,
                    direction: 0, // 0: Down, 1: Left, 2: Right, 3: Up
                    lastX: player.x,
                    lastY: player.y,
                    lastUpdate: now,
                    isMoving: false
                };
            }

            const animState = this.playerAnimationStates[player.playerId];

            // Calculate Movement Delta
            const dx = player.x - animState.lastX;
            const dy = player.y - animState.lastY;
            const moved = Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1;

            if (moved) {
                animState.isMoving = true;
                // Update Direction
                if (Math.abs(dx) > Math.abs(dy)) {
                    animState.direction = dx > 0 ? 2 : 1; // Right : Left
                } else {
                    animState.direction = dy > 0 ? 0 : 3; // Down : Up
                }

                // Update Frame
                if (now - animState.lastUpdate > 150) { // 150ms per frame
                    animState.frame = (animState.frame + 1) % 4;
                    animState.lastUpdate = now;
                }
            } else {
                animState.isMoving = false;
                animState.frame = 0; // Idle frame
            }

            // Update last position for next frame
            animState.lastX = player.x;
            animState.lastY = player.y;


            // Draw Player Sprite if loaded, else Circle
            if (this.sprites.player.complete && this.sprites.player.naturalHeight !== 0) {
                const sprite = this.sprites.player;
                const frameWidth = sprite.width / 4;
                const frameHeight = sprite.height / 3; // 3 rows now: Down, Side, Up

                // animState.direction mappings (from main.js): 0: Down, 1: Left, 2: Right, 3: Up
                // Sprite Sheet Row mappings: 0: Down, 1: Side, 2: Up
                let row = 0;
                let flipX = false;

                if (animState.direction === 1) { // Left
                    row = 1; // Use side row
                    flipX = true;
                } else if (animState.direction === 2) { // Right
                    row = 1; // Use side row
                } else if (animState.direction === 3) { // Up
                    row = 2;
                } else { // Down (0)
                    row = 0;
                }

                const col = animState.frame;

                this.ctx.save();

                if (flipX) {
                    // To flip, we move to the center of the character, scale, and draw relative
                    this.ctx.translate(player.x, player.y);
                    this.ctx.scale(-1, 1);
                    this.ctx.drawImage(
                        sprite,
                        col * frameWidth, row * frameHeight, frameWidth, frameHeight, // Source
                        -20, -30, 40, 40 // Destination (relative to flipped axis)
                    );
                } else {
                    this.ctx.drawImage(
                        sprite,
                        col * frameWidth, row * frameHeight, frameWidth, frameHeight, // Source
                        player.x - 20, player.y - 30, 40, 40 // Destination
                    );
                }

                this.ctx.restore();
            } else {
                // Fallback Circle
                let displayColor = player.color;
                if (player.team === 'red') displayColor = '#ff0000';
                if (player.team === 'blue') displayColor = '#0000ff';

                this.ctx.beginPath();
                this.ctx.arc(player.x, player.y, 15, 0, Math.PI * 2);
                this.ctx.fillStyle = displayColor;
                this.ctx.fill();
                this.ctx.closePath();
            }

            // Draw simple name/label
            this.ctx.fillStyle = 'white';
            this.ctx.font = '12px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(player.playerId.substr(0, 4), player.x, player.y - 35); // Moved label up slightly

            // Draw HP bar if in battle
            if (player.hp !== undefined) {
                const barWidth = 40;
                const barHeight = 4;
                const hpPercent = player.hp / (player.maxHp || 100);

                // Background
                this.ctx.fillStyle = '#333';
                this.ctx.fillRect(player.x - barWidth / 2, player.y - 45, barWidth, barHeight);

                // HP
                this.ctx.fillStyle = hpPercent > 0.5 ? '#00ff00' : hpPercent > 0.25 ? '#ffaa00' : '#ff0000';
                this.ctx.fillRect(player.x - barWidth / 2, player.y - 45, barWidth * hpPercent, barHeight);
            }
        });
    }

    drawSchool() {
        // Blackboard
        this.ctx.fillStyle = '#2d4d2d'; // Dark Green
        this.ctx.fillRect(350, 100, 100, 60);
        this.ctx.strokeStyle = '#8B4513';
        this.ctx.lineWidth = 4;
        this.ctx.strokeRect(350, 100, 100, 60);

        // Chalk text
        this.ctx.fillStyle = 'rgba(255,255,255,0.7)';
        this.ctx.font = '10px monospace';
        this.ctx.textAlign = 'center'; // Ensure center alignment
        this.ctx.fillText("MATH QUIZ", 400, 135); // Centered in 350+50
    }

    drawHouses(houses) {
        Object.values(houses).forEach(house => {
            this.ctx.fillStyle = '#444';
            if (house.owner) this.ctx.fillStyle = '#2a442a'; // Owned color

            // Draw plot
            this.ctx.fillRect(house.x - 40, house.y - 40, 80, 80);
            this.ctx.strokeStyle = '#666';
            this.ctx.strokeRect(house.x - 40, house.y - 40, 80, 80);

            // Label
            this.ctx.fillStyle = '#aaa';
            this.ctx.font = '10px Arial';
            this.ctx.textAlign = 'center';
            if (house.owner) {
                this.ctx.fillText(house.owner, house.x, house.y + 50);
            } else {
                this.ctx.fillText("For Sale", house.x, house.y + 50);
            }

            // Draw Furniture
            if (house.furniture && Array.isArray(house.furniture)) {
                house.furniture.forEach(item => {
                    this.ctx.fillStyle = item.color || '#885522';
                    this.ctx.fillRect(item.x - 10, item.y - 10, 20, 20); // Generic 20x20 box
                });
            }
        });
    }

    drawArena() {
        // Weapon Shop
        this.ctx.fillStyle = '#800000'; // Maroon
        this.ctx.fillRect(100, 100, 120, 80);
        this.ctx.strokeStyle = '#fff';
        this.ctx.strokeRect(100, 100, 120, 80);
        this.ctx.fillStyle = 'white';
        this.ctx.font = '14px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText("WEAPON STORE", 160, 145);

        // Battle Gate
        this.ctx.fillStyle = '#333';
        this.ctx.fillRect(600, 100, 100, 120);
        this.ctx.fillStyle = '#ff0000'; // Red portal center
        this.ctx.globalAlpha = 0.6;
        this.ctx.fillRect(610, 110, 80, 100);
        this.ctx.globalAlpha = 1.0;
        this.ctx.fillStyle = 'white';
        this.ctx.fillText("BATTLE GATE", 650, 90);
    }

    drawBattleZone() {
        // Draw obstacles with better visuals
        this.ctx.fillStyle = '#444';
        this.ctx.strokeStyle = '#777';
        this.ctx.lineWidth = 2;

        const drawWall = (x, y, w, h) => {
            if (this.sprites.wall.complete && this.sprites.wall.naturalHeight !== 0) {
                this.ctx.drawImage(this.sprites.wall, x, y, w, h);
            } else {
                this.ctx.fillRect(x, y, w, h);
                this.ctx.strokeRect(x, y, w, h);
            }
        };

        // Top-left
        drawWall(200, 150, 80, 80);
        // Top-right
        drawWall(520, 150, 80, 80);
        // Bottom-left
        drawWall(200, 370, 80, 80);
        // Bottom-right
        drawWall(520, 370, 80, 80);
        // Center obstacle (darker)
        this.ctx.fillStyle = '#333';
        drawWall(260, 260, 80, 80);
        drawWall(460, 260, 80, 80);

        // Border warning
        this.ctx.strokeStyle = '#ff0000';
        this.ctx.lineWidth = 3;
        this.ctx.strokeRect(0, 0, 800, 600);
    }

    drawGame(players, houses = {}, currentDistrict = 'plaza') {
        this.clear(); // This now sets up the transform and clip

        // Draw Ground Texture if available
        if (this.sprites.ground.complete && this.sprites.ground.naturalHeight !== 0) {
            // Draw tiled? For now just stretch or simple fill
            this.ctx.drawImage(this.sprites.ground, 0, 0, 800, 600);
        }

        if (currentDistrict === 'housing') {
            this.drawHouses(houses);
        } else if (currentDistrict === 'school') {
            this.drawSchool();
        } else if (currentDistrict === 'arena') {
            this.drawArena();
        } else if (currentDistrict === 'arena_battle') {
            this.drawBattleZone();
        }

        this.drawPlayers(players);

        // Restore context to remove clip/transform for next frame (though we clear next frame anyway)
        this.ctx.restore();
    }
}
