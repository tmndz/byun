import { defineConfig } from 'vite';

export default defineConfig({
    root: 'client',
    server: {
        port: 5174,
        host: true,
        proxy: {
            '/socket.io': {
                target: 'http://localhost:3001',
                ws: true
            }
        }
    },
    publicDir: 'public',
    build: {
        outDir: '../dist',
        emptyOutDir: true
    }
});
