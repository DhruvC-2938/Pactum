/**
 * Pactum Service Worker Mesh Indexer
 * Interconnects client workers into a decentralized P2P gossip mesh for Soroban events.
 */

const SW_VERSION = 'v1.0.0';
const MESH_CHANNEL_NAME = 'pactum-webrtc-mesh-signaling';

let meshBroadcastChannel = null;

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
  initMeshChannel();
});

function initMeshChannel() {
  if (typeof BroadcastChannel !== 'undefined' && !meshBroadcastChannel) {
    meshBroadcastChannel = new BroadcastChannel(MESH_CHANNEL_NAME);
    meshBroadcastChannel.onmessage = (event) => {
      // Forward mesh messages to all connected window clients
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({
            type: 'MESH_SIGNALING_EVENT',
            payload: event.data,
          });
        });
      });
    };
  }
}

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'PUBLISH_SOROBAN_EVENT') {
    if (meshBroadcastChannel) {
      meshBroadcastChannel.postMessage({
        type: 'SOROBAN_EVENT_DISSEMINATED',
        event: data.event,
      });
    }
  }
});
