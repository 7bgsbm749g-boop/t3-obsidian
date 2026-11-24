// The public stream carries only a version. Clients verify releases on GitHub.
import {createServer} from 'node:http';
import {createHmac, timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const repository = '7bgsbm749g-boop/t3-obsidian';
const route = '/t3-obsidian/releases';
function version(release) {
  if (release?.draft !== false || release.prerelease !== false) return null;
  const match = /^v?(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.exec(release.tag_name);
  return match && match.slice(1).join('.');
}

export function releaseRelay(secret, initial) {
  let latest = initial;
  const clients = new Set();
  const frame = () => 'data: ' + latest + '\n\n';
  function send(client, data) {
    if (!client.write(data)) client.destroy();
  }
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === route) {
      if (clients.size >= 4096) { res.writeHead(503).end(); return; }
      res.writeHead(200, {'Content-Type':'text/event-stream', 'Cache-Control':'no-store, no-transform', 'Access-Control-Allow-Origin':'*'});
      clients.add(res);
      res.on('close', () => clients.delete(res));
      send(res, frame());
      return;
    }
    if (req.method !== 'POST' || req.url !== route + '/hook') { res.writeHead(404).end(); return; }
    const signature = req.headers['x-hub-signature-256'];
    if (typeof signature !== 'string' || !/^sha256=[0-9a-f]{64}$/.test(signature)) { res.writeHead(403).end(); return; }
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 262144) { res.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const mac = createHmac('sha256', secret).update(body).digest();
      if (!timingSafeEqual(mac, Buffer.from(signature.slice(7), 'hex'))) { res.writeHead(403).end(); return; }
      const event = JSON.parse(body);
      if (req.headers['x-github-event'] === 'release' && event.action === 'published' && event.repository?.full_name === repository) {
        const next = version(event.release);
        if (next && next.localeCompare(latest, 'en', {numeric:true}) > 0) {
          latest = next;
          for (const client of clients) send(client, frame());
        }
      }
      res.writeHead(204).end();
    } catch { res.writeHead(400).end(); }
  });
  const heartbeat = setInterval(() => { for (const client of clients) send(client, ': keepalive\n\n'); }, 20000);
  heartbeat.unref();
  server.on('close', () => clearInterval(heartbeat));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const secret = (await readFile(process.env.WEBHOOK_SECRET_FILE, 'utf8')).trim();
  if (secret.length < 32) throw Error('Webhook secret is too short');
  const response = await fetch('https://api.github.com/repos/' + repository + '/releases/latest', {signal:AbortSignal.timeout(15000)});
  const initial = response.ok && version(await response.json());
  if (!initial) throw Error('Could not load the current GitHub release');
  releaseRelay(secret, initial).listen(8774, '127.0.0.1');
}
