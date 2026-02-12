export class Renderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    clear() {
        this.ctx.fillStyle = '#222';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    drawPlayers(players) {
        Object.values(players).forEach(player => {
            // Override color for team mode
            let displayColor = player.color;
            if (player.team === 'red') displayColor = '#ff0000';
            if (player.team === 'blue') displayColor = '#0000ff';

            this.ctx.beginPath();
            this.ctx.arc(player.x, player.y, 15, 0, Math.PI * 2);
            this.ctx.fillStyle = displayColor;
            this.ctx.fill();
            this.ctx.closePath();

            // Draw simple name/label
            this.ctx.fillStyle = 'white';
            this.ctx.font = '12px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(player.playerId.substr(0, 4), player.x, player.y - 20);

            // Draw HP bar if in battle
            if (player.hp !== undefined) {
                const barWidth = 40;
                const barHeight = 4;
                const hpPercent = player.hp / (player.maxHp || 100);

                // Background
                this.ctx.fillStyle = '#333';
                this.ctx.fillRect(player.x - barWidth / 2, player.y - 35, barWidth, barHeight);

                // HP
                this.ctx.fillStyle = hpPercent > 0.5 ? '#00ff00' : hpPercent > 0.25 ? '#ffaa00' : '#ff0000';
                this.ctx.fillRect(player.x - barWidth / 2, player.y - 35, barWidth * hpPercent, barHeight);
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

        // Top-left
        this.ctx.fillRect(200, 150, 80, 80);
        this.ctx.strokeRect(200, 150, 80, 80);

        // Top-right
        this.ctx.fillRect(520, 150, 80, 80);
        this.ctx.strokeRect(520, 150, 80, 80);

        // Bottom-left
        this.ctx.fillRect(200, 370, 80, 80);
        this.ctx.strokeRect(200, 370, 80, 80);

        // Bottom-right
        this.ctx.fillRect(520, 370, 80, 80);
        this.ctx.strokeRect(520, 370, 80, 80);

        // Center obstacle (darker)
        this.ctx.fillStyle = '#333';
        this.ctx.fillRect(260, 260, 80, 80);
        this.ctx.strokeRect(260, 260, 80, 80);

        // Center obstacle (darker)
        this.ctx.fillStyle = '#333';
        this.ctx.fillRect(460, 260, 80, 80);
        this.ctx.strokeRect(460, 260, 80, 80);

        // Border warning
        this.ctx.strokeStyle = '#ff0000';
        this.ctx.lineWidth = 3;
        this.ctx.strokeRect(0, 0, 800, 600);
    }

    drawGame(players, houses = {}, currentDistrict = 'plaza') {
        this.clear();

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
    }
}
