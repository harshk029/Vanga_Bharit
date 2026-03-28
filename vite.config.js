import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/video_feed': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
      '/logs': 'http://localhost:8000',
      '/plate_detections': 'http://localhost:8000',
      '/plate_recent': 'http://localhost:8000',
      '/video_feed_4': 'http://localhost:8000',
      '/weapon_alerts': 'http://localhost:8000',
      '/sound_analysis': 'http://localhost:8000',
      '/sound_file': 'http://localhost:8000',
      '/plate_audio': 'http://localhost:8000',
      '/reset_cam1': 'http://localhost:8000',
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
    },
  },
})
