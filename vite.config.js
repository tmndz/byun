import { defineConfig } from 'vite';

export default defineConfig({
    root: 'client',
    server: {
        proxy: {
            '/socket.io': {
                target: 'http://localhost:3000',
                ws: true
            }
        }
    },
    build: {
        outDir: '../dist'
    }
});
