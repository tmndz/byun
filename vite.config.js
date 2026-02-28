import { defineConfig } from 'vite';

export default defineConfig({
    root: 'client',
    server: {
        host: true,
        proxy: {
            '/socket.io': {
                target: 'http://localhost:3000',
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
